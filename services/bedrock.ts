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

// Helper: Sanitize inputs
const sanitize = (val: string | undefined): string => {
  if (!val) return '';
  return val.trim();
};

// Helper: Parse credentials from a single string (API Key field)
// Supports:
// 1. Base64 encoded "key:secret" or "key:secret:sessionToken"
// 2. Raw "key:secret" or "key:secret:sessionToken"
// 3. JSON object { accessKeyId, secretAccessKey, sessionToken }
const parseCredentialsFromApiKey = (apiKey: string) => {
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

  // 2. Try Base64 decoding
  let decoded = clean;
  let isBase64 = false;
  try {
    // Check if it looks like base64 (alphanumeric + +/=)
    if (/^[a-zA-Z0-9+/=]+$/.test(clean)) {
        const d = atob(clean);
        // Valid credential string usually contains a colon
        if (d.includes(':')) {
            decoded = d;
            isBase64 = true;
        }
    }
  } catch (e) { /* Not Base64 */ }

  // 3. Parse "key:secret[:token]"
  if (decoded.includes(':')) {
    const parts = decoded.split(':');
    const accessKeyId = parts[0].trim();
    const secretAccessKey = parts[1].trim();
    const sessionToken = parts.length > 2 ? parts.slice(2).join(':').trim() : undefined;

    // Basic validation: AWS Access Keys (AKIA/ASIA) are usually 20 chars
    if (accessKeyId.length >= 16 && secretAccessKey.length > 10) {
        return { accessKeyId, secretAccessKey, sessionToken };
    }
  }

  return null;
};

// Helper: Call Bedrock using Standard IAM Credentials via AWS SDK
const invokeBedrockWithIam = async (
  prompt: string,
  config: AwsConfig,
  overrides?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
): Promise<string> => {
  const accessKeyId = overrides?.accessKeyId || sanitize(config.accessKeyId);
  const secretAccessKey = overrides?.secretAccessKey || sanitize(config.secretAccessKey);
  const sessionToken = overrides?.sessionToken || sanitize(config.sessionToken);
  const region = config.region?.trim() || 'us-east-1';
  const modelId = config.modelId?.trim() || "us.anthropic.claude-3-haiku-20240307-v1:0";

  if (!accessKeyId || !secretAccessKey) {
     throw new Error("AWS Credentials missing. Please check your configuration.");
  }

  const client = new BedrockRuntimeClient({
    region,
    credentials: { 
        accessKeyId, 
        secretAccessKey,
        sessionToken: sessionToken || undefined
    }
  });

  // Native Anthropic Payload for InvokeModel
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
        throw new Error(`Authentication Failed (${err.name}). 1) Check your Access Key/Secret. 2) Check if your Region (${region}) matches your key. 3) If using temporary keys, ensure Session Token is provided and not expired.`);
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

  try {
    if (config.authType === 'apikey' && config.apiKey) {
      // Parse the "API Key" field into actual AWS Credentials
      const creds = parseCredentialsFromApiKey(config.apiKey);
      
      if (creds) {
        jsonString = await invokeBedrockWithIam(prompt, config, creds);
      } else {
        // Fallback or Error: We do NOT support Bearer token fetch against AWS Bedrock directly 
        // because it requires SigV4. If parsing fails, the key is invalid for this app.
        throw new Error("Invalid API Key format. Expected 'AccessKey:SecretKey' (Raw or Base64) or a JSON credential object.");
      }
    } else {
      // Standard IAM Inputs
      jsonString = await invokeBedrockWithIam(prompt, config);
    }

    // Clean up potential markdown blocks if the model adds them
    if (!jsonString) throw new Error("Empty response from Bedrock model");
    
    const cleanJson = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(cleanJson);

    return {
      url,
      ...result
    };

  } catch (error) {
    console.error("AWS Bedrock Classification Error:", error);
    
    // Pass through readable errors
    if (error instanceof Error) {
        throw error;
    }
    throw new Error("Unknown Bedrock Error");
  }
};