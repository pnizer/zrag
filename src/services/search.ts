import { DatabaseService } from './database.js';
import { EmbeddingService } from './embedding.js';
import { OpenAIProvider } from '../providers/openai.js';
import { Document, Chunk } from '../types/document.js';
import { ValidationError } from '../utils/errors.js';

export interface SearchOptions {
  limit?: number;
  threshold?: number;
  includeMetadata?: boolean;
}

export interface SearchResult {
  chunk: Chunk;
  document: Document;
  similarity_score: number;
  context?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  totalResults: number;
  executionTime: number;
  queryEmbedding?: number[];
}

export class SearchService {
  private db: DatabaseService;
  private embeddingService: EmbeddingService;
  private openaiProvider: OpenAIProvider;

  constructor(
    db: DatabaseService,
    embeddingService: EmbeddingService,
    openaiProvider: OpenAIProvider
  ) {
    this.db = db;
    this.embeddingService = embeddingService;
    this.openaiProvider = openaiProvider;
  }

  /**
   * Search for documents using semantic similarity
   */
  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResponse> {
    const startTime = Date.now();
    
    if (!query || query.trim().length === 0) {
      throw new ValidationError('Search query cannot be empty');
    }

    const opts = {
      limit: 10,
      threshold: 0.7,
      includeMetadata: true,
      ...options,
    };

    try {
      // Generate query embedding
      const queryEmbedding = await this.openaiProvider.generateEmbedding(query.trim());

      // For now, implement basic similarity search until vector extension is available
      // This is a placeholder implementation
      const results = this.db.searchSimilarChunks(queryEmbedding, opts.limit, opts.threshold);

      const executionTime = Date.now() - startTime;

      const response: SearchResponse = {
        results,
        query: query.trim(),
        totalResults: results.length,
        executionTime,
      };

      if (opts.includeMetadata) {
        response.queryEmbedding = queryEmbedding;
      }

      return response;

    } catch (error) {
      throw new Error(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get search statistics
   */
  async getSearchStats(): Promise<{
    totalDocuments: number;
    totalChunks: number;
    embeddedChunks: number;
    averageChunksPerDocument: number;
  }> {
    const documents = this.db.listDocuments(1000, 0); // Get all documents
    const totalDocuments = documents.length;

    let totalChunks = 0;
    let embeddedChunks = 0;

    for (const doc of documents) {
      const chunks = this.db.getChunksByDocumentId(doc.id);
      totalChunks += chunks.length;
      
      for (const chunk of chunks) {
        const embedding = this.db.getEmbeddingByChunkId(chunk.id);
        if (embedding) {
          embeddedChunks++;
        }
      }
    }

    return {
      totalDocuments,
      totalChunks,
      embeddedChunks,
      averageChunksPerDocument: totalDocuments > 0 ? totalChunks / totalDocuments : 0,
    };
  }

  /**
   * Find similar chunks to a given chunk
   */
  async findSimilarChunks(
    chunkId: number,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    const targetChunk = this.db.getChunkById(chunkId);
    if (!targetChunk) {
      throw new ValidationError(`Chunk with ID ${chunkId} not found`);
    }

    const embedding = await this.embeddingService.getEmbedding(chunkId);
    if (!embedding) {
      throw new ValidationError(`No embedding found for chunk ${chunkId}`);
    }

    const opts = {
      limit: 10,
      threshold: 0.7,
      ...options,
    };

    return this.db.searchSimilarChunks(embedding, opts.limit, opts.threshold);
  }

  /**
   * Search within a specific document
   */
  async searchInDocument(
    query: string,
    documentId: number,
    options: SearchOptions = {}
  ): Promise<SearchResponse> {
    const startTime = Date.now();
    
    const document = this.db.getDocumentById(documentId);
    if (!document) {
      throw new ValidationError(`Document with ID ${documentId} not found`);
    }

    const queryEmbedding = await this.openaiProvider.generateEmbedding(query.trim());
    const allResults = this.db.searchSimilarChunks(queryEmbedding, 1000, 0);
    
    // Filter results to only include chunks from the specified document
    const documentResults = allResults.filter(result => result.document.id === documentId);
    
    const opts = {
      limit: 10,
      threshold: 0.7,
      ...options,
    };

    const filteredResults = documentResults
      .filter(result => result.similarity_score >= opts.threshold!)
      .slice(0, opts.limit);

    const executionTime = Date.now() - startTime;

    const response: SearchResponse = {
      results: filteredResults,
      query: query.trim(),
      totalResults: filteredResults.length,
      executionTime,
    };

    if (options.includeMetadata) {
      response.queryEmbedding = queryEmbedding;
    }

    return response;
  }

  /**
   * Get recent searches (placeholder for future implementation)
   */
  async getRecentSearches(_limit: number = 10): Promise<Array<{
    query: string;
    timestamp: Date;
    resultCount: number;
  }>> {
    // This would be implemented with a search history table
    // For now, return empty array
    return [];
  }

  /**
   * Clear search cache (placeholder for future implementation)
   */
  async clearSearchCache(): Promise<void> {
    // This would be implemented with a search cache system
    // For now, no-op
  }
}