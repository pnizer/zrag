import { ContextService } from './context.js';
import { EmbeddingService } from './embedding.js';
import { DatabaseService } from './database.js';
import { Document, Chunk } from '../types/document.js';

export interface ChunkProcessingOptions {
  maxParallelChunks: number;
  enableLinearProcessing: boolean;
  verbose?: boolean;
  skipContext?: boolean;
  skipEmbedding?: boolean;
}

export interface ChunkProcessingResult {
  chunkId: number;
  success: boolean;
  error?: string;
  contextGenerated: boolean;
  embeddingGenerated: boolean;
  contextTokens?: number;
  embeddingTokens?: number;
}

export interface BatchChunkProcessingResult {
  results: ChunkProcessingResult[];
  totalTokensUsed: number;
  successCount: number;
  failureCount: number;
  contextSuccessCount: number;
  embeddingSuccessCount: number;
  totalProcessingTime: number;
}

export class ChunkProcessingService {
  private contextService: ContextService;
  private embeddingService: EmbeddingService;
  private db: DatabaseService;

  constructor(
    contextService: ContextService,
    embeddingService: EmbeddingService,
    db: DatabaseService
  ) {
    this.contextService = contextService;
    this.embeddingService = embeddingService;
    this.db = db;
  }

  /**
   * Process multiple chunks with linear pipeline and configurable parallelism
   */
  async processChunks(
    document: Document,
    chunks: Chunk[],
    options: ChunkProcessingOptions
  ): Promise<BatchChunkProcessingResult> {
    const startTime = Date.now();

    if (options.verbose) {
      console.log(`\n🔄 [VERBOSE] Starting linear chunk processing:`);
      console.log(`  📄 Document: ${document.filename}`);
      console.log(`  📝 Total chunks: ${chunks.length}`);
      console.log(`  🔀 Max parallel: ${options.maxParallelChunks}`);
      console.log(`  📋 Pipeline: Read → Context → Embedding → Store`);
      console.log(`  ⏭️  Skip context: ${options.skipContext || false}`);
      console.log(`  ⏭️  Skip embedding: ${options.skipEmbedding || false}`);
    }

    // Filter chunks that need processing
    const pendingChunks = chunks.filter(chunk => {
      if (options.skipContext && options.skipEmbedding) {
        return false; // Nothing to process
      }
      if (options.skipContext) {
        // Only check if embedding is needed
        return !this.db.getEmbeddingByChunkId(chunk.id);
      }
      if (options.skipEmbedding) {
        // Only check if context is needed
        return chunk.status !== 'contextualized' && chunk.status !== 'complete';
      }
      // Both context and embedding needed - check if chunk is incomplete
      return chunk.status !== 'complete';
    });

    if (options.verbose) {
      console.log(`  ⏳ Chunks needing processing: ${pendingChunks.length}`);
    }

    if (pendingChunks.length === 0) {
      if (options.verbose) {
        console.log(`  ✅ All chunks already processed`);
      }
      return {
        results: [],
        totalTokensUsed: 0,
        successCount: 0,
        failureCount: 0,
        contextSuccessCount: 0,
        embeddingSuccessCount: 0,
        totalProcessingTime: Date.now() - startTime,
      };
    }

    const results: ChunkProcessingResult[] = [];
    let totalTokensUsed = 0;
    let successCount = 0;
    let failureCount = 0;
    let contextSuccessCount = 0;
    let embeddingSuccessCount = 0;

    // Process chunks in batches with controlled parallelism
    const semaphore = new Semaphore(options.maxParallelChunks);
    const promises = pendingChunks.map((chunk, index) => 
      semaphore.acquire().then(async (release) => {
        try {
          if (options.verbose) {
            console.log(`\n🚀 [VERBOSE] Starting pipeline for chunk ${chunk.chunk_index + 1} (${index + 1}/${pendingChunks.length})`);
          }
          
          const result = await this.processChunkLinear(document, chunk, options);
          results.push(result);
          
          if (result.success) {
            successCount++;
            if (result.contextGenerated) contextSuccessCount++;
            if (result.embeddingGenerated) embeddingSuccessCount++;
            if (result.contextTokens) totalTokensUsed += result.contextTokens;
            if (result.embeddingTokens) totalTokensUsed += result.embeddingTokens;
          } else {
            failureCount++;
          }

          if (options.verbose) {
            console.log(`  ✅ Pipeline complete for chunk ${chunk.chunk_index + 1} - Success: ${result.success}`);
          }
          
          return result;
        } finally {
          release();
        }
      })
    );

    // Wait for all processing to complete
    await Promise.all(promises);

    const totalProcessingTime = Date.now() - startTime;

    if (options.verbose) {
      console.log(`\n📊 [VERBOSE] Linear Processing Summary:`);
      console.log(`  ⏱️  Total time: ${totalProcessingTime}ms`);
      console.log(`  ✅ Successful pipelines: ${successCount}/${pendingChunks.length}`);
      console.log(`  ❌ Failed pipelines: ${failureCount}/${pendingChunks.length}`);
      console.log(`  🧠 Context generations: ${contextSuccessCount}`);
      console.log(`  🔢 Embedding generations: ${embeddingSuccessCount}`);
      console.log(`  💰 Total tokens used: ${totalTokensUsed}`);
    }

    return {
      results,
      totalTokensUsed,
      successCount,
      failureCount,
      contextSuccessCount,
      embeddingSuccessCount,
      totalProcessingTime,
    };
  }

  /**
   * Process a single chunk through the linear pipeline
   */
  private async processChunkLinear(
    document: Document,
    chunk: Chunk,
    options: ChunkProcessingOptions
  ): Promise<ChunkProcessingResult> {
    let contextGenerated = false;
    let embeddingGenerated = false;
    let contextTokens = 0;
    let embeddingTokens = 0;
    let lastError: string | undefined;

    try {
      if (options.verbose) {
        console.log(`  📋 Processing chunk ${chunk.chunk_index + 1}:`);
        console.log(`    📍 Position: ${chunk.start_position}-${chunk.end_position}`);
        console.log(`    📏 Length: ${chunk.chunk_length} chars`);
        console.log(`    🎯 Current status: ${chunk.status}`);
      }

      // Step 1: Generate context (if not skipped and not already done)
      if (!options.skipContext && chunk.status !== 'contextualized' && chunk.status !== 'complete') {
        if (options.verbose) {
          console.log(`    🧠 Step 1: Generating context...`);
        }

        const contextResult = await this.contextService.generateContext(document, chunk, {
          verbose: options.verbose || false,
        });

        if (contextResult.success) {
          contextGenerated = true;
          contextTokens = contextResult.tokensUsed || 0;
          
          // Update chunk status
          this.db.updateChunk(chunk.id, {
            status: 'contextualized',
            processing_step: 'context_generation',
          });

          if (options.verbose) {
            console.log(`    ✅ Context generated (${contextTokens} tokens)`);
          }
        } else {
          lastError = contextResult.error;
          if (options.verbose) {
            console.log(`    ❌ Context generation failed: ${contextResult.error}`);
          }
        }
      } else if (options.verbose) {
        console.log(`    ⏭️  Skipping context generation`);
      }

      // Step 2: Generate embedding (if not skipped and not already done)
      if (!options.skipEmbedding && !this.db.getEmbeddingByChunkId(chunk.id)) {
        if (options.verbose) {
          console.log(`    🔢 Step 2: Generating embedding...`);
        }

        const embeddingResult = await this.embeddingService.generateEmbedding(document, chunk, {
          verbose: options.verbose || false,
        });

        if (embeddingResult.success) {
          embeddingGenerated = true;
          embeddingTokens = embeddingResult.tokensUsed || 0;

          // Store embedding in database
          const embeddingBuffer = Buffer.from(new Float32Array(embeddingResult.embedding).buffer);
          this.db.insertEmbedding({
            chunk_id: chunk.id,
            embedding: embeddingBuffer,
            model_used: 'text-embedding-3-small', // TODO: Get from config
            embedding_dimension: embeddingResult.embedding.length,
          });

          // Update chunk status to embedded or complete
          const finalStatus = (!options.skipContext && contextGenerated) || chunk.status === 'contextualized' 
            ? 'complete' 
            : 'embedded';
          
          this.db.updateChunk(chunk.id, {
            status: finalStatus,
            processing_step: 'embedding',
          });

          if (options.verbose) {
            console.log(`    ✅ Embedding generated (${embeddingTokens} tokens)`);
            console.log(`    📊 Final status: ${finalStatus}`);
          }
        } else {
          lastError = embeddingResult.error;
          if (options.verbose) {
            console.log(`    ❌ Embedding generation failed: ${embeddingResult.error}`);
          }
        }
      } else if (options.verbose) {
        console.log(`    ⏭️  Skipping embedding generation`);
      }

      // Determine overall success
      const expectedContext = !options.skipContext && chunk.status !== 'contextualized' && chunk.status !== 'complete';
      const expectedEmbedding = !options.skipEmbedding && !this.db.getEmbeddingByChunkId(chunk.id);
      
      const success = (!expectedContext || contextGenerated) && (!expectedEmbedding || embeddingGenerated);

      const result: ChunkProcessingResult = {
        chunkId: chunk.id,
        success,
        contextGenerated,
        embeddingGenerated,
      };
      
      if (lastError) {
        result.error = lastError;
      }
      if (contextTokens > 0) {
        result.contextTokens = contextTokens;
      }
      if (embeddingTokens > 0) {
        result.embeddingTokens = embeddingTokens;
      }
      
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (options.verbose) {
        console.log(`    ❌ Pipeline failed: ${errorMessage}`);
      }

      const result: ChunkProcessingResult = {
        chunkId: chunk.id,
        success: false,
        error: errorMessage,
        contextGenerated,
        embeddingGenerated,
      };
      
      if (contextTokens > 0) {
        result.contextTokens = contextTokens;
      }
      if (embeddingTokens > 0) {
        result.embeddingTokens = embeddingTokens;
      }
      
      return result;
    }
  }

  /**
   * Get processing statistics for a document
   */
  async getProcessingStats(documentId: number): Promise<{
    totalChunks: number;
    pendingChunks: number;
    contextualizedChunks: number;
    embeddedChunks: number;
    completeChunks: number;
    failedChunks: number;
    progressPercentage: number;
  }> {
    const chunks = this.db.getChunksByDocumentId(documentId);
    
    const stats = {
      totalChunks: chunks.length,
      pendingChunks: chunks.filter(c => c.status === 'pending').length,
      contextualizedChunks: chunks.filter(c => c.status === 'contextualized').length,
      embeddedChunks: chunks.filter(c => c.status === 'embedded').length,
      completeChunks: chunks.filter(c => c.status === 'complete').length,
      failedChunks: chunks.filter(c => c.status === 'failed').length,
      progressPercentage: 0,
    };

    if (stats.totalChunks > 0) {
      const processedChunks = stats.contextualizedChunks + stats.embeddedChunks + stats.completeChunks;
      stats.progressPercentage = Math.round((processedChunks / stats.totalChunks) * 100);
    }

    return stats;
  }
}

/**
 * Semaphore implementation for controlling concurrency
 */
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      if (this.permits > 0) {
        this.permits--;
        resolve(() => this.release());
      } else {
        this.waiting.push(() => {
          this.permits--;
          resolve(() => this.release());
        });
      }
    });
  }

  private release(): void {
    this.permits++;
    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      if (next) next();
    }
  }
}