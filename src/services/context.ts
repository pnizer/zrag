import { OpenAIProvider } from '../providers/openai.js';
import { DatabaseService } from './database.js';
import { Document, Chunk } from '../types/document.js';
import { ValidationError } from '../utils/errors.js';
import { ChunkContentResolver } from '../utils/chunk-content-resolver.js';

export interface ContextGenerationOptions {
  provider: 'openai';
  model?: string;
  maxTokens?: number;
  temperature?: number;
  enableCaching?: boolean;
  batchSize?: number;
  verbose?: boolean;
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
  private chunkResolver: ChunkContentResolver;

  constructor(openaiProvider: OpenAIProvider, db: DatabaseService, options?: Partial<ContextGenerationOptions>) {
    this.openaiProvider = openaiProvider;
    this.db = db;
    this.chunkResolver = new ChunkContentResolver();
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
      // Get document content and chunk text from file
      const documentContent = await this.chunkResolver.getDocumentContent(document);
      const chunkText = await this.chunkResolver.getChunkText(document, chunk);
      
      if (opts.verbose) {
        console.log(`\n🔍 [VERBOSE] Context Generation for Chunk ${chunk.chunk_index + 1}:`);
        console.log(`  📄 Document: ${document.filename}`);
        console.log(`  📏 Document length: ${documentContent.length} chars`);
        console.log(`  📝 Chunk length: ${chunkText.length} chars`);
        console.log(`  📍 Chunk position: ${chunk.start_position}-${chunk.end_position}`);
        console.log(`  🎯 Model: ${opts.model}`);
        console.log(`  💰 Max tokens: ${opts.maxTokens}`);
        console.log(`  🔄 Caching: ${opts.enableCaching ? 'enabled' : 'disabled'}`);
      }
      
      const prompt = this.getContextPrompt(documentContent, chunkText);
      
      if (opts.verbose) {
        console.log(`  📨 Prompt length: ${prompt.length} chars`);
        console.log(`  📨 Prompt preview: "${prompt.substring(0, 200)}..."`);
      }
      
      // Generate cache key for OpenAI prompt caching
      const cacheKey = opts.enableCaching ? `doc-${document.file_hash.substring(0, 8)}` : undefined;

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

      if (opts.verbose) {
        console.log(`  📤 Sending request to OpenAI...`);
        console.log(`  📋 Request options:`, JSON.stringify(options, null, 2));
      }

      const response = await this.openaiProvider.generateText(prompt, options);

      if (opts.verbose) {
        console.log(`  📥 Response received:`);
        console.log(`  📝 Response text: "${response.text}"`);
        console.log(`  💰 Tokens used: ${response.usage?.totalTokens || 'N/A'}`);
        console.log(`  ⚡ Cached: ${response.cached ? 'Yes' : 'No'}`);
      }

      const contextualizedText = response.text.trim();

      const result: ContextGenerationResult = {
        chunkId: chunk.id,
        originalText: chunkText,
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
      // Get chunk text for error reporting if possible
      let originalText = '';
      try {
        originalText = await this.chunkResolver.getChunkText(document, chunk);
      } catch {
        // If we can't get chunk text, use empty string
      }
      
      return {
        chunkId: chunk.id,
        originalText,
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
      (chunk.status !== 'complete' && chunk.status !== 'contextualized')
    );

    if (opts.verbose) {
      console.log(`\n🔍 [VERBOSE] Batch Context Generation:`);
      console.log(`  📄 Document: ${document.filename}`);
      console.log(`  📝 Total chunks: ${chunks.length}`);
      console.log(`  ⏳ Pending chunks: ${pendingChunks.length}`);
      console.log(`  📦 Batch size: ${opts.batchSize}`);
      console.log(`  🎯 Model: ${opts.model}`);
      console.log(`  🔄 Caching enabled: ${opts.enableCaching}`);
    }

    if (pendingChunks.length === 0) {
      if (opts.verbose) {
        console.log(`  ✅ No chunks need contextualization`);
      }
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

    const totalBatches = Math.ceil(pendingChunks.length / opts.batchSize!);

    for (let i = 0; i < pendingChunks.length; i += opts.batchSize!) {
      const batch = pendingChunks.slice(i, i + opts.batchSize!);
      const batchNumber = Math.floor(i / opts.batchSize!) + 1;
      
      if (opts.verbose) {
        console.log(`\n🔍 [VERBOSE] Processing Batch ${batchNumber}/${totalBatches}:`);
        console.log(`  📦 Chunks ${i + 1}-${Math.min(i + opts.batchSize!, pendingChunks.length)} of ${pendingChunks.length}`);
        console.log(`  📝 Batch contains ${batch.length} chunks`);
      }
      
      // Process batch concurrently with retries
      const batchPromises = batch.map((chunk, batchIndex) => {
        if (opts.verbose) {
          console.log(`  🚀 Starting chunk ${i + batchIndex + 1} (ID: ${chunk.id})`);
        }
        return this.generateContextWithRetry(document, chunk, opts);
      });

      const batchResults = await Promise.allSettled(batchPromises);

      let batchSuccessCount = 0;
      let batchFailureCount = 0;
      let batchTokensUsed = 0;
      let batchCacheHits = 0;

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const contextResult = result.value;
          results.push(contextResult);

          if (contextResult.success) {
            successCount++;
            batchSuccessCount++;
            if (contextResult.tokensUsed) {
              totalTokensUsed += contextResult.tokensUsed;
              batchTokensUsed += contextResult.tokensUsed;
            }
            if (contextResult.cached) {
              cacheHitCount++;
              batchCacheHits++;
            }

            // Update chunk in database
            await this.updateChunkWithContext(contextResult);
          } else {
            failureCount++;
            batchFailureCount++;
            if (opts.verbose) {
              console.log(`  ❌ Chunk ${contextResult.chunkId} failed: ${contextResult.error}`);
            }
          }
        } else {
          failureCount++;
          batchFailureCount++;
          // Add failed result
          results.push({
            chunkId: batch[results.length % batch.length]?.id || 0,
            originalText: '',
            contextualizedText: '',
            success: false,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
          if (opts.verbose) {
            console.log(`  ❌ Batch processing failed: ${result.reason}`);
          }
        }
      }

      if (opts.verbose) {
        console.log(`  📊 Batch ${batchNumber} Results:`);
        console.log(`    ✅ Successful: ${batchSuccessCount}`);
        console.log(`    ❌ Failed: ${batchFailureCount}`);
        console.log(`    💰 Tokens used: ${batchTokensUsed}`);
        console.log(`    ⚡ Cache hits: ${batchCacheHits}`);
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

    if (options.verbose && maxRetries > 1) {
      console.log(`  🔄 Starting context generation with retry (max ${maxRetries} attempts) for chunk ${chunk.chunk_index + 1}`);
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (options.verbose && attempt > 1) {
          console.log(`  🔄 Retry attempt ${attempt}/${maxRetries} for chunk ${chunk.chunk_index + 1}`);
        }
        
        const result = await this.generateContext(document, chunk, options);
        
        if (result.success) {
          if (options.verbose && attempt > 1) {
            console.log(`  ✅ Retry succeeded on attempt ${attempt} for chunk ${chunk.chunk_index + 1}`);
          }
          return result;
        }

        // If not successful but no exception, treat as error
        lastError = new Error(result.error || 'Context generation failed');
        
        if (options.verbose) {
          console.log(`  ⚠️  Context generation returned failure for chunk ${chunk.chunk_index + 1}: ${result.error}`);
        }
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (options.verbose) {
          console.log(`  ⚠️  Attempt ${attempt} failed for chunk ${chunk.chunk_index + 1}: ${lastError.message}`);
          console.log(`  📋 Error details: ${lastError.stack || 'No stack trace available'}`);
        }
        
        // For rate limiting errors, use exponential backoff
        if (lastError.message.includes('rate limit') && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // 2^attempt seconds
          if (options.verbose) {
            console.log(`  ⏱️  Rate limit detected, using exponential backoff: ${delay}ms delay`);
            console.log(`  📊 Backoff calculation: 2^${attempt} * 1000 = ${delay}ms`);
          }
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }

      // For other errors, only retry if we have attempts left
      if (attempt < maxRetries) {
        const delay = 1000;
        if (options.verbose) {
          console.log(`  ⏱️  Standard retry delay: waiting ${delay}ms before attempt ${attempt + 1}...`);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        if (options.verbose) {
          console.log(`  ❌ All ${maxRetries} attempts exhausted for chunk ${chunk.chunk_index + 1}`);
        }
      }
    }

    // All retries failed - get chunk text for error reporting if possible
    let originalText = '';
    try {
      originalText = await this.chunkResolver.getChunkText(document, chunk);
    } catch {
      // If we can't get chunk text, use empty string
    }
    
    return {
      chunkId: chunk.id,
      originalText,
      contextualizedText: '',
      success: false,
      error: lastError?.message || 'Unknown error after retries',
    };
  }

  /**
   * Update chunk with generated context
   * Note: In file-reference mode, we don't store contextualized text in the database
   */
  private async updateChunkWithContext(result: ContextGenerationResult): Promise<void> {
    if (!result.success || !result.contextualizedText) {
      return;
    }

    this.db.updateChunk(result.chunkId, {
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
      contextualizedChunks: chunks.filter(c => c.status === 'contextualized').length,
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