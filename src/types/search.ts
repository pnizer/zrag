export interface SearchQuery {
  query: string;
  limit?: number;
  match_threshold?: number;
  filters?: SearchFilters;
}

export interface SearchFilters {
  documentIds?: number[];
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface SearchResult {
  chunk: {
    id: number;
    document_id: number;
    chunk_index: number;
    original_text: string;
    contextualized_text?: string;
    start_position: number;
    end_position: number;
  };
  document: {
    id: number;
    filename: string;
    filepath: string;
  };
  similarity_score: number;
  rank: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  total_found: number;
  processing_time_ms: number;
}