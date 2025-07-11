export interface Document {
  id: number;
  filename: string;
  filepath: string;
  content: string;
  content_hash: string;
  total_chunks: number;
  processed_chunks: number;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  last_error?: string;
  created_at: string;
  updated_at: string;
}

export interface Chunk {
  id: number;
  document_id: number;
  chunk_index: number;
  original_text: string;
  contextualized_text?: string;
  start_position: number;
  end_position: number;
  status: 'pending' | 'contextualized' | 'embedded' | 'complete' | 'failed';
  error_message?: string;
  processing_step?: 'chunking' | 'context_generation' | 'embedding' | 'storage';
  created_at: string;
}

export interface Embedding {
  id: number;
  chunk_id: number;
  embedding: Buffer;
  model_used: string;
  embedding_dimension: number;
  created_at: string;
}

export interface ChunkWithEmbedding extends Chunk {
  embedding?: Embedding;
}

export interface DocumentWithChunks extends Document {
  chunks: ChunkWithEmbedding[];
}