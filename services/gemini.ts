import { GoogleGenAI, Type, Schema } from "@google/genai";
import { ClassifiedPage } from "../types";

// Define the Taxonomy Schema for Gemini
const taxonomySchema: Schema = {
  type: Type.OBJECT,
  properties: {
    title: {
      type: Type.STRING,
      description: "The extracted title of the page.",
    },
    summary: {
      type: Type.STRING,
      description: "A one sentence summary of the content.",
    },
    tags: {
      type: Type.OBJECT,
      properties: {
        personas: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "List of personas: patient, caregiver, parent, professional, bereaved.",
        },
        types: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Medical types: autoimmune (NMDA, LGI1, etc.), infectious (HSV, TBE, etc.), post_infectious.",
        },
        stages: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Stages: pre_diagnosis, acute_hospital, early_recovery, long_term_management.",
        },
        topics: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Topics: memory, behaviour, legal, school, travel, research.",
        },
      },
      required: ["personas", "types", "stages", "topics"],
    },
  },
  required: ["title", "summary", "tags"],
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const classifyPageContent = async (
  url: string,
  pageText: string
): Promise<ClassifiedPage> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const prompt = `
    Analyze the following website content from URL: ${url}.
    
    Your task is to classify this content for Encephalitis International based on the specific taxonomy provided in the schema.
    
    Content Preview:
    ${pageText.substring(0, 20000)}
  `;

  const MAX_RETRIES = 5;
  let attempt = 0;
  let delay = 5000; // Start with 5 seconds for rate limit backoff

  while (true) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview", // Efficient for high volume classification
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: taxonomySchema,
          systemInstruction: `You are the AI Data Engineer for Encephalitis International. 
        You strictly follow the provided taxonomy.
        Prefix tags with their category name (e.g., 'persona:caregiver', 'stage:acute_hospital').
        If a category is not applicable, leave the array empty.
        Be precise.`,
        },
      });

      const text = response.text;
      if (!text) throw new Error("Empty response from Gemini");

      const result = JSON.parse(text);
      return {
        url,
        ...result,
      };
    } catch (error: any) {
      // Check for Rate Limit (429) or Resource Exhausted errors
      const isRateLimit = 
        error?.status === 429 || 
        error?.code === 429 || 
        (error?.message && (
          error.message.includes("429") || 
          error.message.includes("RESOURCE_EXHAUSTED") ||
          error.message.includes("quota")
        ));

      if (isRateLimit && attempt < MAX_RETRIES) {
        console.warn(`Rate limit hit for ${url}. Retrying in ${delay / 1000}s... (Attempt ${attempt + 1}/${MAX_RETRIES})`);
        await wait(delay);
        attempt++;
        delay *= 2; // Exponential backoff: 5s -> 10s -> 20s...
        continue;
      }

      console.error("Gemini Classification Error:", error);
      throw error;
    }
  }
};