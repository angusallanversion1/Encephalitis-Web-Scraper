export interface TagSchema {
  personas: string[];
  types: string[];
  stages: string[];
  topics: string[];
}

export interface ClassifiedPage {
  url: string;
  title: string;
  summary: string;
  tags: TagSchema;
}

export interface ProcessingStatus {
  url: string;
  status: 'pending' | 'scraping' | 'classifying' | 'completed' | 'error';
  error?: string;
  data?: ClassifiedPage;
}

export enum AppState {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
}

// Stats for visualization
export interface StatData {
  name: string;
  value: number;
}
