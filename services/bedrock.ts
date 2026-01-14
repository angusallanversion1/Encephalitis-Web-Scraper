import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { ClassifiedPage } from "../types";

export interface AwsConfig {
  authType: 'standard' | 'apikey';
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  apiKey?: string;
  region: string;
  modelId?: string;
}

// Cache for exchanged credentials to avoid hitting the pre-signed URL repeatedly for every page
let cachedCreds: {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: number;
} | null = null;

// Helper: Sanitize inputs
const sanitize = (val: string | undefined): string => {
  if (!val) return '';
  return val.trim();
};

/**
 * Exchanges the "bedrock-api-key-" formatted string for temporary AWS credentials.
 * The key is essentially a base64 encoded pre-signed URL that returns credentials when fetched.
 * Uses CORS proxies to bypass browser restrictions on fetching AWS endpoints directly.
 */
const exchangeHackathonKey = async (apiKey: string) => {
  // Return cached creds if valid (buffer of 5 mins)
  if (cachedCreds && cachedCreds.expiration > Date.now() + 5 * 60 * 1000) {
    return cachedCreds;
  }

  const cleanKey = sanitize(apiKey);
  const prefix = "bedrock-api-key-";
  
  if (!cleanKey.startsWith(prefix)) {
    throw new Error("Invalid Hackathon Key format. Expected start with 'bedrock-api-key-'");
  }

  const base64Part = cleanKey.slice(prefix.length);
  let decodedUrl = "";
  try {
    decodedUrl = atob(base64Part);
  } catch (e) {
    throw new Error("Failed to decode Hackathon Key (Base64 invalid).");
  }

  // Ensure it has protocol
  if (!decodedUrl.startsWith("http")) {
    decodedUrl = `https://${decodedUrl}`;
  }

  // Define strategies to fetch the credentials URL (Proxy vs Direct)
  const strategies = [
    // Primary: CorsProxy.io (Handling the AWS URL query params correctly)
    async (target: string) => {
       const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(target)}`);
       if (!res.ok) throw new Error(`Proxy 1 HTTP ${res.status}`);
       return res.json();
    },
    // Fallback: AllOrigins
    async (target: string) => {
       const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`);
       if (!res.ok) throw new Error(`Proxy 2 HTTP ${res.status}`);
       return res.json();
    },
    // Fallback: Direct (Likely fails CORS, but here for completeness)
    async (target: string) => {
       const res = await fetch(target);
       if (!res.ok) throw new Error(`Direct HTTP ${res.status}`);
       return res.json();
    }
  ];

  let data = null;
  let lastError = "";

  for (const strategy of strategies) {
    try {
      data = await strategy(decodedUrl);
      if (data) break;
    } catch (e: any) {
      console.warn("Key Exchange Strategy failed:", e.message);
      lastError = e.message;
    }
  }

  if (!data) {
    throw new Error(`Key Exchange Failed. Unable to fetch credentials via proxies. Last error: ${lastError}`);
  }

  try {
    // Validate response structure (AWS usually returns capitalized keys, but we check both)
    const accessKeyId = data.AccessKeyId || data.accessKeyId;
    const secretAccessKey = data.SecretAccessKey || data.secretAccessKey;
    const sessionToken = data.SessionToken || data.sessionToken;
    const expirationStr = data.Expiration || data.expiration;

    if (!accessKeyId || !secretAccessKey || !sessionToken) {
      throw new Error("Invalid response from Key Exchange: Missing credentials fields.");
    }

    const expiration = expirationStr ? new Date(expirationStr).getTime() : Date.now() + 3600 * 1000; // Default 1h

    const credentials = {
      accessKeyId,
      secretAccessKey,
      sessionToken,
      expiration
    };

    cachedCreds = credentials;
    return credentials;

  } catch (err: any) {
    console.error("Hackathon Key Parsing Error:", err);
    throw new Error(`Failed to parse credentials from key exchange: ${err.message}`);
  }
};

// Helper: Parse credentials from a single string (Standard/Legacy formats)
const parseStandardCredentials = (apiKey: string) => {
  const clean = sanitize(apiKey);
  if (!clean) return null;

  // 1. Try JSON
  if (clean.startsWith('{')) {
    try {
      const json = JSON.parse(clean);
      if (json.accessKeyId && json.secretAccessKey) {
        return {
          accessKeyId: json.accessKeyId,
          secretAccessKey: json.secretAccessKey,
          sessionToken: json.sessionToken
        };
      }
    } catch (e) { /* Not JSON */ }
  }

  // 2. Try Base64 decoding (legacy user:pass)
  let decoded = clean;
  try {
    if (/^[a-zA-Z0-9+/=]+$/.test(clean) && !clean.includes(' ')) {
        const d = atob(clean);
        if (d.includes(':')) decoded = d;
    }
  } catch (e) { /* Not Base64 */ }

  // 3. Parse "key:secret[:token]"
  if (decoded.includes(':')) {
    const parts = decoded.split(':');
    const accessKeyId = parts[0].trim();
    const secretAccessKey = parts[1].trim();
    const sessionToken = parts.length > 2 ? parts.slice(2).join(':').trim() : undefined;

    if (accessKeyId.length >= 16 && secretAccessKey.length > 10) {
        return { accessKeyId, secretAccessKey, sessionToken };
    }
  }

  return null;
};

// Helper: Call Bedrock using IAM Credentials via AWS SDK
const invokeBedrockWithIam = async (
  prompt: string,
  config: AwsConfig,
  creds: { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
): Promise<string> => {
  const region = config.region?.trim() || 'us-west-2';
  const modelId = config.modelId?.trim() || "global.anthropic.claude-haiku-4-5-20251001-v1:0";

  const client = new BedrockRuntimeClient({
    region,
    credentials: { 
        accessKeyId: creds.accessKeyId, 
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken
    }
  });

  const payload = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: prompt
      }
    ]
  };

  const command = new InvokeModelCommand({
    modelId,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(payload)
  });

  try {
    const response = await client.send(command);
    const responseBody = new TextDecoder().decode(response.body);
    const parsedBody = JSON.parse(responseBody);
    return parsedBody.content[0].text;
  } catch (err: any) {
     const msg = err.message || err.toString();
     
     if (err.name === 'ValidationException' && msg.includes("on-demand throughput")) {
        throw new Error(`Model ID Error: ${msg}. Please select a 'us.' or 'global.' prefixed model in Settings.`);
     }
     if (err.name === 'UnrecognizedClientException' || err.name === 'AccessDeniedException' || msg.includes('403')) {
        throw new Error(`Authentication Failed (${err.name}). Check your Region (${region}) or Key validity.`);
     }
     throw err;
  }
};

export const classifyWithBedrock = async (
  url: string,
  pageText: string,
  config: AwsConfig
): Promise<ClassifiedPage> => {

  const prompt = `
    You are the AI Data Engineer for Encephalitis International.
    Analyze the following website content from URL: ${url}.
    
    Classify this content based on the following taxonomy.
    Return ONLY a valid JSON object matching the example structure. Do not output any other text or markdown formatting.

    Taxonomy Rules:
    - personas: [patient, caregiver, parent, professional, bereaved]
    - types: [autoimmune, infectious, post_infectious] (and specific subtypes if found like NMDA, HSV)
    - stages: [pre_diagnosis, acute_hospital, early_recovery, long_term_management]
    - topics: [memory, behaviour, legal, school, travel, research]

    Prefix tags with their category name (e.g., 'persona:caregiver', 'stage:acute_hospital').

    JSON Structure:
    {
      "title": "Page Title",
      "summary": "One sentence summary",
      "tags": {
        "personas": [],
        "types": [],
        "stages": [],
        "topics": []
      }
    }

    Content Preview:
    ${pageText.substring(0, 15000)}
  `;

  let jsonString = "";
  let credentials;

  try {
    if (config.authType === 'apikey' && config.apiKey) {
      const cleanApiKey = sanitize(config.apiKey);
      
      if (cleanApiKey.startsWith('bedrock-api-key-')) {
         // Hackathon 2026 Key Exchange Flow
         credentials = await exchangeHackathonKey(cleanApiKey);
      } else {
         // Standard Manual/Legacy Parse
         credentials = parseStandardCredentials(cleanApiKey);
         if (!credentials) {
            throw new Error("Invalid API Key format. For the Hackathon, ensure the key starts with 'bedrock-api-key-' and has no spaces. For manual keys, use 'AccessKey:SecretKey'.");
         }
      }
    } else {
      // Standard IAM Tab Inputs
      if (!config.accessKeyId || !config.secretAccessKey) {
        throw new Error("Missing AWS Credentials in Standard configuration.");
      }
      credentials = {
        accessKeyId: sanitize(config.accessKeyId),
        secretAccessKey: sanitize(config.secretAccessKey),
        sessionToken: sanitize(config.sessionToken) || undefined
      };
    }

    if (!credentials) throw new Error("Could not resolve AWS credentials.");

    jsonString = await invokeBedrockWithIam(prompt, config, credentials);

    if (!jsonString) throw new Error("Empty response from Bedrock model");
    
    const cleanJson = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(cleanJson);

    return {
      url,
      ...result
    };

  } catch (error) {
    console.error("AWS Bedrock Classification Error:", error);
    if (error instanceof Error) throw error;
    throw new Error("Unknown Bedrock Error");
  }
};