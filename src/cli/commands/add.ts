import { Command } from 'commander';
import path from 'path';
import { ConfigManager } from '../../utils/config.js';
import { DatabaseService } from '../../services/database.js';
import { DocumentService } from '../../services/document.js';
import { ContextService } from '../../services/context.js';
import { EmbeddingService } from '../../services/embedding.js';
import { ChunkProcessingService } from '../../services/chunk-processing.js';
import { OpenAIProvider } from '../../providers/openai.js';
import { ProgressIndicator, ProgressBar, formatDuration, formatFileSize } from '../utils/progress.js';
import { validateFilePath, formatValidationError } from '../utils/validation.js';
import { promptConfirm } from '../utils/input.js';

export function createAddCommand(): Command {
  return new Command('add')
    .description('Add a document to the knowledge base with full processing pipeline')
    .argument('<file>', 'Path to the document file to add')
    .option('--config-path <path>', 'Path to configuration file')
    .option('--skip-context', 'Skip context generation step')
    .option('--skip-embedding', 'Skip embedding generation step')
    .option('--force', 'Overwrite existing document with same content hash')
    .option('--dry-run', 'Show what would be done without actually processing')
    .option('--verbose', 'Show detailed logs including chunking details and API requests/responses')
    .option('--max-parallel <number>', 'Maximum number of chunks to process in parallel (default: 5)', '5')
    .option('--rebuild-vector-index', 'Rebuild the vector index from existing embeddings (fixes corrupted vector data)')
    .action(async (file, options) => {
      try {
        await addDocument(file, options);
      } catch (error) {
        console.error(formatValidationError(error));
        process.exit(1);
      }
    });
}

async function addDocument(
  filePath: string, 
  options: { 
    configPath?: string; 
    skipContext?: boolean;
    skipEmbedding?: boolean;
    dryRun?: boolean;
    force?: boolean;
    verbose?: boolean;
    maxParallel?: string;
  }
): Promise<void> {
  const startTime = Date.now();
  
  console.log('📄 zrag Document Ingestion');
  console.log('');

  // Validate file path
  validateFilePath(filePath);

  const absolutePath = path.resolve(filePath);
  console.log('📁 File:', absolutePath);

  // Load configuration
  const configManager = new ConfigManager(options.configPath);
  
  if (!configManager.exists()) {
    console.error('❌ Configuration not found. Run "zrag init" first.');
    process.exit(1);
  }

  const config = await configManager.load();

  // Initialize services
  const dbService = new DatabaseService(config.database.path);
  
  if (!dbService.isInitialized()) {
    const progress = new ProgressIndicator('Initializing database connection...');
    progress.start();
    
    try {
      await dbService.initialize();
      progress.stop('Database connected');
    } catch (error) {
      progress.fail('Database connection failed');
      throw new Error('Database not initialized. Run "zrag db-init" first.');
    }
  }

  // Initialize AI providers
  let openaiProvider: OpenAIProvider | undefined;
  if (config.providers.openai) {
    openaiProvider = new OpenAIProvider(config.providers.openai.apiKey);
  }

  if (!openaiProvider) {
    throw new Error('OpenAI provider not configured. Check your configuration.');
  }

  const documentService = new DocumentService(dbService, {
    chunking: config.chunking,
    validateContent: true,
    extractMetadata: true,
  });

  const contextService = new ContextService(openaiProvider, dbService, {
    provider: 'openai',
    model: config.providers.openai?.contextModel || 'gpt-4o-mini',
    maxTokens: config.contextGeneration.maxContextTokens,
    enableCaching: true,
    verbose: options.verbose || false,
  });

  const embeddingService = new EmbeddingService(openaiProvider, dbService, {
    provider: 'openai',
    model: config.providers.openai?.embeddingModel || 'text-embedding-3-small',
    verbose: options.verbose || false,
  });

  const chunkProcessingService = new ChunkProcessingService(
    contextService,
    embeddingService,
    dbService
  );

  try {
    // Step 1: Process document and create chunks
    console.log('');
    console.log('📝 Step 1: Document Processing');
    
    if (options.dryRun) {
      console.log('🔍 Dry run mode - analyzing file...');
      const fileStats = await getFileStats(absolutePath);
      console.log(`  📊 File size: ${formatFileSize(fileStats.size)}`);
      console.log(`  ⚙️  Chunking strategy: ${config.chunking.strategy}`);
      console.log(`  📏 Chunk size: ${config.chunking.chunkSize} characters`);
      console.log(`  🔄 Overlap: ${config.chunking.overlap} characters`);
      console.log('');
    }

    // Use unified processing with dry-run flag
    const processingProgress = options.dryRun 
      ? null 
      : new ProgressIndicator('Processing document and creating chunks...');
    
    if (processingProgress) {
      processingProgress.start();
    } else {
      console.log('🧪 Performing document analysis...');
    }

    // Process document using the same DocumentService logic for both modes
    const processingResult = await documentService.processDocumentFromFile(
      absolutePath, 
      { 
        chunking: config.chunking,
        validateContent: true,
        extractMetadata: true,
        dryRun: options.dryRun || false,
        verbose: options.verbose || false
      }
    );
    
    if (processingProgress) {
      processingProgress.stop(`Document processed: ${processingResult.chunks.length} chunks created`);
    }

    // Display analysis results for dry-run mode
    if (options.dryRun && processingResult.analysis) {
      console.log('');
      console.log('📋 Chunking Analysis Results:');
      console.log(`  📝 Original content length: ${processingResult.metadata?.characterCount || 'N/A'} characters`);
      console.log(`  ✂️  Total chunks created: ${processingResult.chunks.length}`);
      console.log(`  📊 Average chunk size: ${Math.round(processingResult.analysis.avgChunkSize)} characters`);
      console.log(`  📏 Min chunk size: ${processingResult.analysis.minChunkSize} characters`);
      console.log(`  📐 Max chunk size: ${processingResult.analysis.maxChunkSize} characters`);
      console.log(`  🔄 Total overlap: ${processingResult.analysis.totalOverlap} characters`);
      
      console.log('');
      console.log('🎯 API Calls that would be made:');
      if (!options.skipContext) {
        const docLength = processingResult.metadata?.characterCount || 0;
        const avgChunkSize = processingResult.analysis.avgChunkSize;
        console.log(`  🧠 Context generation: ${processingResult.chunks.length} calls to ${config.providers.openai?.contextModel || 'gpt-4o-mini'}`);
        console.log(`    📊 Est. tokens per call: ~${Math.ceil((docLength + avgChunkSize) / 4)}`);
        console.log(`    💰 Est. total tokens: ~${Math.ceil((docLength + avgChunkSize) * processingResult.chunks.length / 4).toLocaleString()}`);
      }
      if (!options.skipEmbedding) {
        const avgChunkSize = processingResult.analysis.avgChunkSize;
        console.log(`  🔢 Embedding generation: ${processingResult.chunks.length} calls to ${config.providers.openai?.embeddingModel || 'text-embedding-3-small'}`);
        console.log(`    📊 Est. tokens per call: ~${Math.ceil(avgChunkSize / 4)}`);
        console.log(`    💰 Est. total tokens: ~${Math.ceil(avgChunkSize * processingResult.chunks.length / 4).toLocaleString()}`);
      }
      
      console.log('');
      console.log('👆 Use without --dry-run to actually process the document');
      return;
    }

    console.log('');
    console.log('📋 Document Processing Results:');
    console.log(`  📄 Document ID: ${processingResult.document.id}`);
    console.log(`  📝 Total chunks: ${processingResult.chunks.length}`);
    console.log(`  📊 Word count: ${processingResult.metadata?.wordCount || 'N/A'}`);
    console.log(`  🔤 Character count: ${processingResult.metadata?.characterCount || 'N/A'}`);
    console.log(`  🎯 Estimated tokens: ${processingResult.metadata?.estimatedTokens || 'N/A'}`);
    console.log(`  🏗️  Has structure: ${processingResult.metadata?.hasStructure ? 'Yes' : 'No'}`);

    // Check for existing document (only in non-dry-run mode)
    if (!options.dryRun && !options.force) {
      const existingDoc = dbService.getDocumentByHash(processingResult.document.file_hash);
      if (existingDoc && existingDoc.id !== processingResult.document.id) {
        console.log('');
        console.log('⚠️  Document with same content already exists.');
        const overwrite = await promptConfirm('Do you want to continue anyway?', false);
        if (!overwrite) {
          console.log('Document addition cancelled.');
          return;
        }
      }
    }

    // Step 2: Linear chunk processing (context + embeddings, skip in dry-run mode)
    if (!options.dryRun && (!options.skipContext || !options.skipEmbedding)) {
      console.log('');
      console.log('🔄 Step 2: Linear Chunk Processing (Context + Embeddings)');
      
      const processingProgress = new ProgressBar(
        processingResult.chunks.length,
        'Processing chunks through linear pipeline...'
      );

      const chunkResult = await chunkProcessingService.processChunks(
        processingResult.document,
        processingResult.chunks,
        {
          maxParallelChunks: parseInt(options.maxParallel || '5') || config.processing?.maxParallelChunks || 5,
          enableLinearProcessing: config.processing?.enableLinearProcessing ?? true,
          verbose: options.verbose || false,
          skipContext: options.skipContext || false,
          skipEmbedding: options.skipEmbedding || false,
        }
      );

      processingProgress.finish('Linear chunk processing complete');

      console.log('');
      console.log('📋 Linear Processing Results:');
      console.log(`  ✅ Successful pipelines: ${chunkResult.successCount}/${processingResult.chunks.length}`);
      console.log(`  ❌ Failed pipelines: ${chunkResult.failureCount}`);
      console.log(`  🧠 Context generations: ${chunkResult.contextSuccessCount}`);
      console.log(`  🔢 Embedding generations: ${chunkResult.embeddingSuccessCount}`);
      console.log(`  💰 Total tokens used: ${chunkResult.totalTokensUsed}`);
      console.log(`  ⏱️  Processing time: ${formatDuration(chunkResult.totalProcessingTime)}`);
      console.log(`  🔀 Max parallel chunks: ${parseInt(options.maxParallel || '5') || config.processing?.maxParallelChunks || 5}`);

      if (chunkResult.failureCount > 0) {
        console.log('');
        console.log('⚠️  Some chunks failed processing. The document is still searchable with successful chunks.');
        
        // Show failed chunk details if verbose
        if (options.verbose) {
          const failedResults = chunkResult.results.filter(r => !r.success);
          console.log('');
          console.log('❌ Failed chunk details:');
          failedResults.forEach(result => {
            console.log(`  Chunk ${result.chunkId}: ${result.error}`);
          });
        }
      }
    } else if (!options.dryRun) {
      console.log('');
      if (options.skipContext && options.skipEmbedding) {
        console.log('⏭️  Skipping all chunk processing (--skip-context --skip-embedding)');
      } else if (options.skipContext) {
        console.log('⏭️  Skipping context generation (--skip-context)');
      } else if (options.skipEmbedding) {
        console.log('⏭️  Skipping embedding generation (--skip-embedding)');
      }
    }

    // Final status update (only in non-dry-run mode)
    if (!options.dryRun) {
      const finalStatus: 'complete' | 'processing' = options.skipEmbedding ? 'processing' : 'complete';
      await documentService.updateDocumentStatus(
        processingResult.document.id,
        finalStatus,
        processingResult.chunks.length
      );
    }

    // Summary (only in non-dry-run mode)
    if (!options.dryRun) {
      const totalTime = Date.now() - startTime;
      const finalStatus: 'complete' | 'processing' = options.skipEmbedding ? 'processing' : 'complete';
      console.log('');
      console.log('✅ Document processing complete!');
      console.log('');
      console.log('📊 Summary:');
      console.log(`  ⏱️  Total time: ${formatDuration(totalTime)}`);
      console.log(`  📄 Document: ${path.basename(absolutePath)}`);
      console.log(`  🆔 Document ID: ${processingResult.document.id}`);
      console.log(`  📝 Chunks: ${processingResult.chunks.length}`);
      console.log(`  🔍 Status: ${finalStatus}`);
      console.log('');
      console.log('Next steps:');
      console.log(`  🔍 Search: zrag search "your query"`);
      console.log(`  📋 List: zrag list`);
      console.log('');
    }
  } finally {
    dbService.close();
  }
}

async function getFileStats(filePath: string): Promise<{ size: number }> {
  const fs = require('fs').promises;
  const stats = await fs.stat(filePath);
  return { size: stats.size };
}