import { Command } from 'commander';
import path from 'path';
import { ConfigManager } from '../../utils/config.js';
import { DatabaseService } from '../../services/database.js';
import { DocumentService } from '../../services/document.js';
import { ContextService } from '../../services/context.js';
import { EmbeddingService } from '../../services/embedding.js';
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
    force?: boolean;
    dryRun?: boolean;
  }
): Promise<void> {
  const startTime = Date.now();
  
  console.log('📄 RAG Tool Document Ingestion');
  console.log('');

  // Validate file path
  validateFilePath(filePath);

  const absolutePath = path.resolve(filePath);
  console.log('📁 File:', absolutePath);

  // Load configuration
  const configManager = new ConfigManager(options.configPath);
  
  if (!configManager.exists()) {
    console.error('❌ Configuration not found. Run "rag-tool init" first.');
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
      throw new Error('Database not initialized. Run "rag-tool db-init" first.');
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
  });

  const embeddingService = new EmbeddingService(openaiProvider, dbService, {
    provider: 'openai',
    model: config.providers.openai?.embeddingModel || 'text-embedding-3-small',
  });

  try {
    // Step 1: Process document and create chunks
    console.log('');
    console.log('📝 Step 1: Document Processing');
    
    if (options.dryRun) {
      console.log('🔍 Dry run mode - analyzing file...');
      const fileStats = await getFileStats(absolutePath);
      console.log(`  📊 File size: ${formatFileSize(fileStats.size)}`);
      console.log(`  📄 Estimated chunks: ~${Math.ceil(fileStats.size / config.chunking.chunkSize)}`);
      console.log(`  ⚙️  Chunking strategy: ${config.chunking.strategy}`);
      console.log(`  📏 Chunk size: ${config.chunking.chunkSize} characters`);
      console.log(`  🔄 Overlap: ${config.chunking.overlap} characters`);
      console.log('');
      console.log('👆 Use without --dry-run to actually process the document');
      return;
    }

    const docProgress = new ProgressIndicator('Processing document and creating chunks...');
    docProgress.start();

    const processingResult = await documentService.processDocumentFromFile(absolutePath);
    
    docProgress.stop(`Document processed: ${processingResult.chunks.length} chunks created`);

    console.log('');
    console.log('📋 Document Processing Results:');
    console.log(`  📄 Document ID: ${processingResult.document.id}`);
    console.log(`  📝 Total chunks: ${processingResult.chunks.length}`);
    console.log(`  📊 Word count: ${processingResult.metadata?.wordCount || 'N/A'}`);
    console.log(`  🔤 Character count: ${processingResult.metadata?.characterCount || 'N/A'}`);
    console.log(`  🎯 Estimated tokens: ${processingResult.metadata?.estimatedTokens || 'N/A'}`);
    console.log(`  🏗️  Has structure: ${processingResult.metadata?.hasStructure ? 'Yes' : 'No'}`);

    // Check for existing document
    if (!options.force) {
      const existingDoc = dbService.getDocumentByHash(processingResult.document.content_hash);
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

    // Step 2: Generate context for chunks (optional)
    if (!options.skipContext) {
      console.log('');
      console.log('🧠 Step 2: Context Generation');
      
      const contextProgress = new ProgressBar(
        processingResult.chunks.length,
        'Generating context for chunks...'
      );

      const contextResult = await contextService.generateContextsForDocument(
        processingResult.document.id
      );

      contextProgress.finish('Context generation complete');

      console.log('');
      console.log('📋 Context Generation Results:');
      console.log(`  ✅ Successful: ${contextResult.successCount}`);
      console.log(`  ❌ Failed: ${contextResult.failureCount}`);
      console.log(`  💰 Tokens used: ${contextResult.totalTokensUsed}`);
      console.log(`  ⚡ Cache hits: ${contextResult.cacheHitCount}`);

      if (contextResult.failureCount > 0) {
        console.log('');
        console.log('⚠️  Some chunks failed context generation. Check the errors above.');
        const continueProcessing = await promptConfirm('Continue with embedding generation?', true);
        if (!continueProcessing) {
          console.log('Processing stopped. You can resume later with the same command.');
          return;
        }
      }
    } else {
      console.log('');
      console.log('⏭️  Skipping context generation (--skip-context)');
    }

    // Step 3: Generate embeddings (optional)
    if (!options.skipEmbedding) {
      console.log('');
      console.log('🔢 Step 3: Embedding Generation');
      
      const embeddingProgress = new ProgressBar(
        processingResult.chunks.length,
        'Generating embeddings for chunks...'
      );

      const embeddingResult = await embeddingService.generateEmbeddingsForDocument(
        processingResult.document.id
      );

      embeddingProgress.finish('Embedding generation complete');

      console.log('');
      console.log('📋 Embedding Generation Results:');
      console.log(`  ✅ Successful: ${embeddingResult.successCount}`);
      console.log(`  ❌ Failed: ${embeddingResult.failureCount}`);
      console.log(`  💰 Tokens used: ${embeddingResult.totalTokensUsed}`);

      if (embeddingResult.failureCount > 0) {
        console.log('');
        console.log('⚠️  Some chunks failed embedding generation. The document is still searchable with successful chunks.');
      }
    } else {
      console.log('');
      console.log('⏭️  Skipping embedding generation (--skip-embedding)');
    }

    // Final status update
    const finalStatus: 'complete' | 'processing' = options.skipEmbedding ? 'processing' : 'complete';
    await documentService.updateDocumentStatus(
      processingResult.document.id,
      finalStatus,
      processingResult.chunks.length
    );

    // Summary
    const totalTime = Date.now() - startTime;
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
    console.log(`  🔍 Search: rag-tool search "your query"`);
    console.log(`  📋 List: rag-tool list`);
    console.log('');
  } finally {
    dbService.close();
  }
}

async function getFileStats(filePath: string): Promise<{ size: number }> {
  const fs = require('fs').promises;
  const stats = await fs.stat(filePath);
  return { size: stats.size };
}