import { OpenAIProvider } from '../providers/openai.js';
import { DatabaseService } from './database.js';
import { Document, Chunk } from '../types/document.js';
import { ValidationError } from '../utils/errors.js';
import { ChunkContentResolver } from '../utils/chunk-content-resolver.js';

export interface EmbeddingOptions {
  provider: 'openai';
  model?: string;
  batchSize?: number;
  maxRetries?: number;
}

export interface EmbeddingResult {
  chunkId: number;
  embedding: number[];
  success: boolean;
  error?: string;
  tokensUsed?: number;
}

export interface BatchEmbeddingResult {
  results: EmbeddingResult[];
  totalTokensUsed: number;
  successCount: number;
  failureCount: number;
}

export class EmbeddingService {
  private openaiProvider: OpenAIProvider;
  private db: DatabaseService;
  private defaultOptions: EmbeddingOptions;
  private chunkResolver: ChunkContentResolver;

  constructor(openaiProvider: OpenAIProvider, db: DatabaseService, options?: Partial<EmbeddingOptions>) {
    this.openaiProvider = openaiProvider;
    this.db = db;
    this.chunkResolver = new ChunkContentResolver();
    this.defaultOptions = {
      provider: 'openai',
      model: 'text-embedding-3-small',
      batchSize: 100, // OpenAI allows up to 2048 inputs per batch
      maxRetries: 3,
      ...options,
    };
  }

  /**
   * Generate embedding for a single chunk
   */
  async generateEmbedding(
    document: Document,
    chunk: Chunk,
    options?: Partial<EmbeddingOptions>
  ): Promise<EmbeddingResult> {
    const opts = { ...this.defaultOptions, ...options };
    
    try {
      // Get chunk text from file
      const textToEmbed = await this.chunkResolver.getChunkText(document, chunk);
      
      if (!textToEmbed || textToEmbed.trim().length === 0) {
        throw new ValidationError('Chunk text is empty');
      }

      const embedding = await this.openaiProvider.generateEmbedding(textToEmbed, opts.model);

      return {
        chunkId: chunk.id,
        embedding,
        success: true,
        tokensUsed: this.estimateTokens(textToEmbed),
      };

    } catch (error) {
      return {
        chunkId: chunk.id,
        embedding: [],
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Generate embeddings for multiple chunks with batch processing
   */
  async generateEmbeddingsForChunks(
    document: Document,
    chunks: Chunk[],
    options?: Partial<EmbeddingOptions>
  ): Promise<BatchEmbeddingResult> {
    const opts = { ...this.defaultOptions, ...options };

    if (chunks.length === 0) {
      return {
        results: [],
        totalTokensUsed: 0,
        successCount: 0,
        failureCount: 0,
      };
    }

    // Filter chunks that need embeddings
    const pendingChunks = chunks.filter(chunk => 
      !this.db.getEmbeddingByChunkId(chunk.id)
    );

    if (pendingChunks.length === 0) {
      return {
        results: [],
        totalTokensUsed: 0,
        successCount: 0,
        failureCount: 0,
      };
    }

    const results: EmbeddingResult[] = [];
    let totalTokensUsed = 0;
    let successCount = 0;
    let failureCount = 0;

    // Process chunks in batches
    for (let i = 0; i < pendingChunks.length; i += opts.batchSize!) {
      const batch = pendingChunks.slice(i, i + opts.batchSize!);
      const batchResult = await this.processBatch(document, batch, opts);

      results.push(...batchResult.results);
      totalTokensUsed += batchResult.totalTokensUsed;
      successCount += batchResult.successCount;
      failureCount += batchResult.failureCount;

      // Store successful embeddings immediately
      for (const result of batchResult.results) {
        if (result.success) {
          await this.storeEmbedding(result, opts.model!);
        }
      }

      // Add small delay between batches to respect rate limits
      if (i + opts.batchSize! < pendingChunks.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return {
      results,
      totalTokensUsed,
      successCount,
      failureCount,
    };
  }

  /**
   * Generate embeddings for all chunks in a document
   */
  async generateEmbeddingsForDocument(
    documentId: number,
    options?: Partial<EmbeddingOptions>
  ): Promise<BatchEmbeddingResult> {
    const document = this.db.getDocumentById(documentId);
    if (!document) {
      throw new ValidationError(`Document with ID ${documentId} not found`);
    }
    
    const chunks = this.db.getChunksByDocumentId(documentId);
    return this.generateEmbeddingsForChunks(document, chunks, options);
  }

  /**
   * Process a batch of chunks
   */
  private async processBatch(
    document: Document,
    batch: Chunk[],
    options: EmbeddingOptions
  ): Promise<BatchEmbeddingResult> {
    try {
      // Get chunk texts from file
      const chunkContents = await this.chunkResolver.resolveMultipleChunks(document, batch);
      const texts = chunkContents.map(content => content.text);
      const validTexts = texts.filter(text => text && text.trim().length > 0);

      if (validTexts.length === 0) {
        return {
          results: batch.map(chunk => ({
            chunkId: chunk.id,
            embedding: [],
            success: false,
            error: 'No valid text to embed',
          })),
          totalTokensUsed: 0,
          successCount: 0,
          failureCount: batch.length,
        };
      }

      // Generate embeddings for the batch
      const embeddings = await this.retryOperation(
        () => this.openaiProvider.batchGenerateEmbeddings(validTexts, options.model),
        options.maxRetries!
      );

      // Map results back to chunks
      const results: EmbeddingResult[] = [];
      let successCount = 0;
      let failureCount = 0;
      let totalTokensUsed = 0;

      for (let i = 0; i < batch.length; i++) {
        const chunk = batch[i]!;
        const text = texts[i];

        if (!text || text.trim().length === 0) {
          results.push({
            chunkId: chunk.id,
            embedding: [],
            success: false,
            error: 'Empty text',
          });
          failureCount++;
        } else {
          const embeddingIndex = validTexts.indexOf(text);
          const embedding = embeddings[embeddingIndex];

          if (embedding && embedding.length > 0) {
            const tokensUsed = this.estimateTokens(text);
            results.push({
              chunkId: chunk.id,
              embedding,
              success: true,
              tokensUsed,
            });
            successCount++;
            totalTokensUsed += tokensUsed;
          } else {
            results.push({
              chunkId: chunk.id,
              embedding: [],
              success: false,
              error: 'No embedding returned',
            });
            failureCount++;
          }
        }
      }

      return {
        results,
        totalTokensUsed,
        successCount,
        failureCount,
      };

    } catch (error) {
      // If batch fails, return failure for all chunks
      return {
        results: batch.map(chunk => ({
          chunkId: chunk.id,
          embedding: [],
          success: false,
          error: String(error),
        })),
        totalTokensUsed: 0,
        successCount: 0,
        failureCount: batch.length,
      };
    }
  }

  /**
   * Store embedding in database
   */
  private async storeEmbedding(
    result: EmbeddingResult,
    model: string
  ): Promise<void> {
    if (!result.success || result.embedding.length === 0) {
      return;
    }

    try {
      // Convert number array to buffer for storage
      const embeddingBuffer = Buffer.from(new Float32Array(result.embedding).buffer);

      this.db.insertEmbedding({
        chunk_id: result.chunkId,
        embedding: embeddingBuffer,
        model_used: model,
        embedding_dimension: result.embedding.length,
      });

      // Update chunk status
      this.db.updateChunk(result.chunkId, {
        status: 'embedded',
        processing_step: 'embedding',
      });

    } catch (error) {
      console.error(`Failed to store embedding for chunk ${result.chunkId}:`, error);
    }
  }

  /**
   * Get embedding for a chunk
   */
  async getEmbedding(chunkId: number): Promise<number[] | null> {
    const embedding = this.db.getEmbeddingByChunkId(chunkId);
    
    if (!embedding) {
      return null;
    }

    // Convert buffer back to number array
    const float32Array = new Float32Array(embedding.embedding.buffer);
    return Array.from(float32Array);
  }

  /**
   * Get all embeddings for a document
   */
  async getDocumentEmbeddings(documentId: number): Promise<Array<{
    chunkId: number;
    embedding: number[];
    model: string;
    dimension: number;
  }>> {
    const chunks = this.db.getChunksByDocumentId(documentId);
    const results: Array<{
      chunkId: number;
      embedding: number[];
      model: string;
      dimension: number;
    }> = [];

    for (const chunk of chunks) {
      const embeddingRecord = this.db.getEmbeddingByChunkId(chunk.id);
      if (embeddingRecord) {
        const embedding = await this.getEmbedding(chunk.id);
        if (embedding) {
          results.push({
            chunkId: chunk.id,
            embedding,
            model: embeddingRecord.model_used,
            dimension: embeddingRecord.embedding_dimension,
          });
        }
      }
    }

    return results;
  }

  /**
   * Get embedding statistics for a document
   */
  async getEmbeddingStats(documentId: number): Promise<{
    totalChunks: number;
    embeddedChunks: number;
    pendingChunks: number;
    failedChunks: number;
    progressPercentage: number;
    models: string[];
  }> {
    const chunks = this.db.getChunksByDocumentId(documentId);
    const embeddedChunks = chunks.filter(chunk => {
      const embedding = this.db.getEmbeddingByChunkId(chunk.id);
      return embedding !== null;
    });

    const models = [...new Set(embeddedChunks.map(chunk => {
      const embedding = this.db.getEmbeddingByChunkId(chunk.id);
      return embedding?.model_used || '';
    }).filter(Boolean))];

    const stats = {
      totalChunks: chunks.length,
      embeddedChunks: embeddedChunks.length,
      pendingChunks: chunks.filter(c => c.status === 'pending' || c.status === 'contextualized').length,
      failedChunks: chunks.filter(c => c.status === 'failed').length,
      progressPercentage: 0,
      models,
    };

    if (stats.totalChunks > 0) {
      stats.progressPercentage = Math.round((stats.embeddedChunks / stats.totalChunks) * 100);
    }

    return stats;
  }

  /**
   * Resume embedding generation for incomplete documents
   */
  async resumeEmbeddingGeneration(documentId: number): Promise<BatchEmbeddingResult> {
    return this.generateEmbeddingsForDocument(documentId);
  }

  /**
   * Estimate token count for text (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
  }

  /**
   * Retry operation with exponential backoff
   */
  private async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // For rate limiting errors, use exponential backoff
        if (lastError.message.includes('rate limit') && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // 2^attempt seconds
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // For other errors, only retry if we have attempts left
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    throw lastError || new Error('Operation failed after retries');
  }

  /**
   * Validate embedding options
   */
  static validateOptions(options: Partial<EmbeddingOptions>): void {
    if (options.batchSize && (options.batchSize < 1 || options.batchSize > 2048)) {
      throw new ValidationError('batchSize must be between 1 and 2048');
    }

    if (options.maxRetries && (options.maxRetries < 1 || options.maxRetries > 10)) {
      throw new ValidationError('maxRetries must be between 1 and 10');
    }
  }
}