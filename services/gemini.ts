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

export const classifyPageContent = async (
  url: string,
  pageText: string
): Promise<ClassifiedPage> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key is missing.");

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `
    Analyze the following website content from URL: ${url}.
    
    Your task is to classify this content for Encephalitis International based on the specific taxonomy provided in the schema.
    
    Content Preview:
    ${pageText.substring(0, 20000)}
  `;

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
  } catch (error) {
    console.error("Gemini Classification Error:", error);
    throw error;
  }
};