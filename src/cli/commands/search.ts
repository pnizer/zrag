import { Command } from 'commander';
import { DatabaseService } from '../../services/database.js';
import { EmbeddingService } from '../../services/embedding.js';
import { SearchService } from '../../services/search.js';
import { OpenAIProvider } from '../../providers/openai.js';
import { ConfigManager } from '../../utils/config.js';
import { ProgressIndicator } from '../utils/progress.js';
import { ChunkContentResolver } from '../../utils/chunk-content-resolver.js';

export function createSearchCommand(): Command {
  const command = new Command('search');
  
  command
    .description('Search through indexed documents using semantic similarity')
    .argument('<query>', 'Search query text')
    .option('-l, --limit <number>', 'Maximum number of results to return', (value) => parseInt(value, 10), 10)
    .option('-t, --threshold <number>', 'Similarity threshold (0-1)', (value) => parseFloat(value), 0.7)
    .option('--config-path <path>', 'Path to configuration file')
    .option('--no-context', 'Hide contextual information in results')
    .option('--format <format>', 'Output format (table|json|detailed)', 'table')
    .option('--document-id <id>', 'Search within specific document', (value) => parseInt(value, 10))
    .option('--verbose', 'Show detailed embedding generation logs')
    .action(async (query: string, options) => {
      let progress: ProgressIndicator | undefined;
      
      try {
        // Load configuration
        const configManager = new ConfigManager(options.configPath);
        const config = await configManager.load();
        
        // Initialize services
        const db = new DatabaseService(config.database.path);
        await db.initialize();
        
        const openaiProvider = new OpenAIProvider(
          config.providers.openai?.apiKey || ''
        );
        
        const embeddingService = new EmbeddingService(openaiProvider, db, {
          verbose: options.verbose || false,
        });
        const searchService = new SearchService(db, embeddingService, openaiProvider);
        
        console.log(`\n🔍 zrag Search\n`);
        console.log(`📝 Query: "${query}"`);
        console.log(`🎯 Limit: ${options.limit}`);
        console.log(`📊 Threshold: ${options.threshold}`);
        if (options.documentId) {
          console.log(`📄 Document ID: ${options.documentId}`);
        }
        console.log();
        
        // Show search progress
        progress = new ProgressIndicator('Searching documents...');
        progress.start();
        
        try {
          let searchResponse;
          
          if (options.documentId) {
            searchResponse = await searchService.searchInDocument(
              query,
              options.documentId,
              {
                limit: options.limit,
                match_threshold: options.threshold,
                includeMetadata: true,
                verbose: options.verbose || false,
              }
            );
          } else {
            searchResponse = await searchService.search(query, {
              limit: options.limit,
              match_threshold: options.threshold,
              includeMetadata: true,
              verbose: options.verbose || false,
            });
          }
          
          progress.stop();
          
          // Display results
          if (searchResponse.results.length === 0) {
            console.log('❌ No results found matching your query.');
            console.log('\n💡 Try:');
            console.log('  • Using different keywords');
            console.log('  • Lowering the similarity threshold (--threshold)');
            console.log('  • Increasing the result limit (--limit)');
            
            // Show search stats
            const stats = await searchService.getSearchStats();
            console.log(`\n📊 Database Stats:`);
            console.log(`  • Documents: ${stats.totalDocuments}`);
            console.log(`  • Chunks: ${stats.totalChunks}`);
            console.log(`  • Embedded chunks: ${stats.embeddedChunks}`);
            
            if (stats.embeddedChunks === 0) {
              console.log('\n⚠️  No embeddings found. Make sure you have added documents with "zrag add <file>"');
            }
            
            return;
          }
          
          // Format and display results
          console.log(`✅ Found ${searchResponse.results.length} results in ${searchResponse.executionTime}ms\n`);
          
          const contentResolver = new ChunkContentResolver();
          
          switch (options.format) {
            case 'json':
              console.log(JSON.stringify(searchResponse, null, 2));
              break;
              
            case 'detailed':
              await displayDetailedResults(searchResponse, options.context, contentResolver);
              break;
              
            case 'table':
            default:
              await displayTableResults(searchResponse, options.context, contentResolver);
              break;
          }
          
        } catch (searchError) {
          progress.stop();
          
          if (searchError instanceof Error) {
            if (searchError.message.includes('API key')) {
              console.log('❌ OpenAI API error. Please check your API key configuration.');
              console.log('💡 Run "zrag init" to reconfigure your API settings.');
            } else if (searchError.message.includes('rate limit')) {
              console.log('❌ Rate limit exceeded. Please wait a moment and try again.');
            } else {
              console.log(`❌ Search failed: ${searchError.message}`);
            }
          } else {
            console.log(`❌ Search failed: ${String(searchError)}`);
          }
          
          process.exit(1);
        }
        
      } catch (error) {
        if (progress) progress.stop();
        
        if (error instanceof Error) {
          if (error.message.includes('Configuration not found')) {
            console.log('❌ Configuration not found. Run "zrag init" first.');
          } else if (error.message.includes('Database not found')) {
            console.log('❌ Database not found. Run "zrag db-init" first.');
          } else {
            console.log(`❌ Error: ${error.message}`);
          }
        } else {
          console.log(`❌ Unexpected error: ${String(error)}`);
        }
        
        process.exit(1);
      }
    });
  
  return command;
}

async function displayTableResults(searchResponse: any, showContext: boolean = true, contentResolver?: ChunkContentResolver): Promise<void> {
  console.log('📋 Search Results:\n');
  
  for (let i = 0; i < searchResponse.results.length; i++) {
    const result = searchResponse.results[i];
    const score = (result.similarity_score * 100).toFixed(1);
    
    console.log(`${i + 1}. 📄 ${result.document.filename} (${score}% match)`);
    console.log(`   📂 ${result.document.filepath}`);
    console.log(`   🔢 Chunk ${result.chunk.chunk_index + 1}`);
    
    if (showContext && result.chunk.contextualized_text) {
      console.log(`   📝 Context: ${truncateText(result.chunk.contextualized_text, 100)}`);
    }
    
    // Resolve chunk content
    if (contentResolver) {
      try {
        const chunkText = await contentResolver.getChunkText(result.document, result.chunk);
        console.log(`   📖 Content: ${chunkText}`);
      } catch (error) {
        console.log(`   📖 Content: [Content unavailable]`);
      }
    } else {
      console.log(`   📖 Content: [Content resolver not available]`);
    }
    
    console.log();
  }
  
  // Show search metadata
  console.log(`⏱️  Execution time: ${searchResponse.executionTime}ms`);
  console.log(`📊 Total results: ${searchResponse.totalResults}`);
}

async function displayDetailedResults(searchResponse: any, showContext: boolean = true, contentResolver?: ChunkContentResolver): Promise<void> {
  console.log('📋 Detailed Search Results:\n');
  
  for (let i = 0; i < searchResponse.results.length; i++) {
    const result = searchResponse.results[i];
    const score = (result.similarity_score * 100).toFixed(2);
    
    console.log(`═══ Result ${i + 1} ═══`);
    console.log(`📄 Document: ${result.document.filename}`);
    console.log(`📂 Path: ${result.document.filepath}`);
    console.log(`🔢 Chunk: ${result.chunk.chunk_index + 1} of ${result.document.total_chunks || 'unknown'}`);
    console.log(`🎯 Similarity: ${score}%`);
    console.log(`📅 Created: ${new Date(result.chunk.created_at).toLocaleString()}`);
    
    if (showContext && result.chunk.contextualized_text) {
      console.log(`\n📝 Context:`);
      console.log(wrapText(result.chunk.contextualized_text, 80, '   '));
    }
    
    console.log(`\n📖 Content:`);
    if (contentResolver) {
      try {
        const chunkText = await contentResolver.getChunkText(result.document, result.chunk);
        console.log(wrapText(chunkText, 80, '   '));
      } catch (error) {
        console.log('   [Content unavailable]');
      }
    } else {
      console.log('   [Content resolver not available]');
    }
    
    console.log(`\n🔗 Chunk Position: ${result.chunk.start_position}-${result.chunk.end_position}`);
    console.log(`✅ Status: ${result.chunk.status}`);
    console.log();
  }
  
  // Show search metadata
  console.log(`═══ Search Metadata ═══`);
  console.log(`🔍 Query: "${searchResponse.query}"`);
  console.log(`⏱️  Execution time: ${searchResponse.executionTime}ms`);
  console.log(`📊 Total results: ${searchResponse.totalResults}`);
  
  if (searchResponse.queryEmbedding) {
    console.log(`🧮 Query embedding dimensions: ${searchResponse.queryEmbedding.length}`);
  }
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}

function wrapText(text: string, width: number, prefix: string = ''): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  
  for (const word of words) {
    if ((currentLine + word).length > width) {
      if (currentLine) {
        lines.push(prefix + currentLine.trim());
        currentLine = word + ' ';
      } else {
        // Word is longer than width, just add it
        lines.push(prefix + word);
      }
    } else {
      currentLine += word + ' ';
    }
  }
  
  if (currentLine.trim()) {
    lines.push(prefix + currentLine.trim());
  }
  
  return lines.join('\n');
}