import { OpenAIProvider } from '../providers/openai.js';
import { DatabaseService } from './database.js';
import { Document, Chunk } from '../types/document.js';
import { ValidationError } from '../utils/errors.js';

export interface ContextGenerationOptions {
  provider: 'openai';
  model?: string;
  maxTokens?: number;
  temperature?: number;
  enableCaching?: boolean;
  batchSize?: number;
}

export interface ContextGenerationResult {
  chunkId: number;
  originalText: string;
  contextualizedText: string;
  success: boolean;
  error?: string;
  tokensUsed?: number;
  cached?: boolean;
}

export interface BatchContextResult {
  results: ContextGenerationResult[];
  totalTokensUsed: number;
  successCount: number;
  failureCount: number;
  cacheHitCount: number;
}

export class ContextService {
  private openaiProvider: OpenAIProvider;
  private db: DatabaseService;
  private defaultOptions: ContextGenerationOptions;

  constructor(openaiProvider: OpenAIProvider, db: DatabaseService, options?: Partial<ContextGenerationOptions>) {
    this.openaiProvider = openaiProvider;
    this.db = db;
    this.defaultOptions = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      maxTokens: 500,
      temperature: 0.1,
      enableCaching: true,
      batchSize: 10,
      ...options,
    };
  }

  /**
   * Anthropic's official contextual retrieval prompt template
   */
  private getContextPrompt(documentContent: string, chunkText: string): string {
    return `<document>
${documentContent}
</document>
Here is the chunk we want to situate within the whole document
<chunk>
${chunkText}
</chunk>
Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.`;
  }

  /**
   * Generate context for a single chunk
   */
  async generateContext(
    document: Document,
    chunk: Chunk,
    options?: Partial<ContextGenerationOptions>
  ): Promise<ContextGenerationResult> {
    const opts = { ...this.defaultOptions, ...options };

    try {
      const prompt = this.getContextPrompt(document.content, chunk.original_text);
      
      // Generate cache key for OpenAI prompt caching
      const cacheKey = opts.enableCaching ? `doc-${document.content_hash.substring(0, 8)}` : undefined;

      const options: {
        model?: string;
        maxTokens?: number;
        temperature?: number;
        user?: string;
      } = {};

      if (opts.model) options.model = opts.model;
      if (opts.maxTokens) options.maxTokens = opts.maxTokens;
      if (opts.temperature !== undefined) options.temperature = opts.temperature;
      if (cacheKey) options.user = cacheKey;

      const response = await this.openaiProvider.generateText(prompt, options);

      const contextualizedText = response.text.trim();

      const result: ContextGenerationResult = {
        chunkId: chunk.id,
        originalText: chunk.original_text,
        contextualizedText,
        success: true,
      };

      if (response.usage?.totalTokens) {
        result.tokensUsed = response.usage.totalTokens;
      }

      if (response.cached !== undefined) {
        result.cached = response.cached;
      }

      return result;

    } catch (error) {
      return {
        chunkId: chunk.id,
        originalText: chunk.original_text,
        contextualizedText: '',
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Generate contexts for multiple chunks from the same document with batch processing
   */
  async generateContextsForDocument(
    documentId: number,
    options?: Partial<ContextGenerationOptions>
  ): Promise<BatchContextResult> {
    const opts = { ...this.defaultOptions, ...options };

    // Get document and chunks
    const document = this.db.getDocumentById(documentId);
    if (!document) {
      throw new ValidationError(`Document with ID ${documentId} not found`);
    }

    const chunks = this.db.getChunksByDocumentId(documentId);
    if (chunks.length === 0) {
      throw new ValidationError(`No chunks found for document ${documentId}`);
    }

    // Filter chunks that need contextualization
    const pendingChunks = chunks.filter(chunk => 
      chunk.status === 'pending' || 
      (chunk.status !== 'complete' && !chunk.contextualized_text)
    );

    if (pendingChunks.length === 0) {
      return {
        results: [],
        totalTokensUsed: 0,
        successCount: 0,
        failureCount: 0,
        cacheHitCount: 0,
      };
    }

    // Process chunks in batches
    const results: ContextGenerationResult[] = [];
    let totalTokensUsed = 0;
    let successCount = 0;
    let failureCount = 0;
    let cacheHitCount = 0;

    for (let i = 0; i < pendingChunks.length; i += opts.batchSize!) {
      const batch = pendingChunks.slice(i, i + opts.batchSize!);
      
      // Process batch concurrently with retries
      const batchPromises = batch.map(chunk => 
        this.generateContextWithRetry(document, chunk, opts)
      );

      const batchResults = await Promise.allSettled(batchPromises);

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const contextResult = result.value;
          results.push(contextResult);

          if (contextResult.success) {
            successCount++;
            if (contextResult.tokensUsed) {
              totalTokensUsed += contextResult.tokensUsed;
            }
            if (contextResult.cached) {
              cacheHitCount++;
            }

            // Update chunk in database
            await this.updateChunkWithContext(contextResult);
          } else {
            failureCount++;
          }
        } else {
          failureCount++;
          // Add failed result
          results.push({
            chunkId: batch[results.length % batch.length]?.id || 0,
            originalText: '',
            contextualizedText: '',
            success: false,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
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
      cacheHitCount,
    };
  }

  /**
   * Generate context with retry logic
   */
  private async generateContextWithRetry(
    document: Document,
    chunk: Chunk,
    options: ContextGenerationOptions,
    maxRetries: number = 3
  ): Promise<ContextGenerationResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.generateContext(document, chunk, options);
        
        if (result.success) {
          return result;
        }

        // If not successful but no exception, treat as error
        lastError = new Error(result.error || 'Context generation failed');
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // For rate limiting errors, use exponential backoff
        if (lastError.message.includes('rate limit') && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // 2^attempt seconds
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }

      // For other errors, only retry if we have attempts left
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // All retries failed
    return {
      chunkId: chunk.id,
      originalText: chunk.original_text,
      contextualizedText: '',
      success: false,
      error: lastError?.message || 'Unknown error after retries',
    };
  }

  /**
   * Update chunk with generated context
   */
  private async updateChunkWithContext(result: ContextGenerationResult): Promise<void> {
    if (!result.success || !result.contextualizedText) {
      return;
    }

    this.db.updateChunk(result.chunkId, {
      contextualized_text: result.contextualizedText,
      status: 'contextualized',
      processing_step: 'context_generation',
    });
  }

  /**
   * Get context generation statistics for a document
   */
  async getContextStats(documentId: number): Promise<{
    totalChunks: number;
    contextualizedChunks: number;
    pendingChunks: number;
    failedChunks: number;
    progressPercentage: number;
  }> {
    const chunks = this.db.getChunksByDocumentId(documentId);
    
    const stats = {
      totalChunks: chunks.length,
      contextualizedChunks: chunks.filter(c => c.contextualized_text && c.status === 'contextualized').length,
      pendingChunks: chunks.filter(c => c.status === 'pending').length,
      failedChunks: chunks.filter(c => c.status === 'failed').length,
      progressPercentage: 0,
    };

    if (stats.totalChunks > 0) {
      stats.progressPercentage = Math.round((stats.contextualizedChunks / stats.totalChunks) * 100);
    }

    return stats;
  }

  /**
   * Resume context generation for incomplete documents
   */
  async resumeContextGeneration(documentId: number): Promise<BatchContextResult> {
    return this.generateContextsForDocument(documentId);
  }

  /**
   * Validate context generation options
   */
  static validateOptions(options: Partial<ContextGenerationOptions>): void {
    if (options.maxTokens && (options.maxTokens < 1 || options.maxTokens > 4096)) {
      throw new ValidationError('maxTokens must be between 1 and 4096');
    }

    if (options.temperature && (options.temperature < 0 || options.temperature > 2)) {
      throw new ValidationError('temperature must be between 0 and 2');
    }

    if (options.batchSize && (options.batchSize < 1 || options.batchSize > 50)) {
      throw new ValidationError('batchSize must be between 1 and 50');
    }
  }
}