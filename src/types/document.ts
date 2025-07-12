export interface Document {
  id: number;
  filename: string;
  filepath: string;
  file_hash: string;
  file_size: number;
  file_modified?: string;
  text_encoding?: string;
  total_chunks: number;
  processed_chunks: number;
  status: 'pending' | 'processing' | 'complete' | 'failed' | 'file_missing';
  last_error?: string;
  created_at: string;
  updated_at: string;
}

export interface Chunk {
  id: number;
  document_id: number;
  chunk_index: number;
  start_position: number;
  end_position: number;
  chunk_length: number;
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