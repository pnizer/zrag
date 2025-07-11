export interface Model {
  id: string;
  name: string;
  type: 'embedding' | 'chat' | 'completion';
  maxTokens?: number;
  costPer1kTokens?: number;
}

export interface AIProvider {
  name: string;
  
  // Model management
  listModels(): Promise<Model[]>;
  validateApiKey(apiKey: string): Promise<boolean>;
  
  // Embedding operations
  generateEmbedding(text: string, model?: string): Promise<number[]>;
  batchGenerateEmbeddings(texts: string[], model?: string): Promise<number[][]>;
  
  // Context generation (for providers that support it)
  generateContext?(document: string, chunk: string): Promise<string>;
  generateContextWithCache?(
    documentPrefix: string,
    chunk: string,
    userParam: string
  ): Promise<string>;
}

export interface EmbeddingResponse {
  embedding: number[];
  tokensUsed: number;
}

export interface ContextResponse {
  context: string;
  tokensUsed: number;
  cachedTokens?: number;
}