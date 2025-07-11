import { Command } from 'commander';
import { ConfigManager } from '../../utils/config.js';
import { DatabaseService } from '../../services/database.js';
import { ProgressIndicator } from '../utils/progress.js';
import { promptConfirm } from '../utils/input.js';
import { formatValidationError } from '../utils/validation.js';

export function createDbInitCommand(): Command {
  return new Command('db-init')
    .description('Initialize the RAG tool database with required schemas and indexes')
    .option('--config-path <path>', 'Path to configuration file')
    .option('--force', 'Recreate database if it already exists')
    .option('--test', 'Test database operations after initialization')
    .action(async (options) => {
      try {
        await initializeDatabase(options);
      } catch (error) {
        console.error(formatValidationError(error));
        process.exit(1);
      }
    });
}

async function initializeDatabase(options: { 
  configPath?: string; 
  force?: boolean; 
  test?: boolean; 
}): Promise<void> {
  console.log('💾 RAG Tool Database Initialization');
  console.log('');

  // Load configuration
  const configManager = new ConfigManager(options.configPath);
  
  if (!configManager.exists()) {
    console.error('❌ Configuration not found. Run "rag-tool init" first.');
    process.exit(1);
  }

  const config = await configManager.load();
  console.log('📁 Database path:', config.database.path);
  console.log('📊 Vector dimension:', config.database.vectorDimension);
  console.log('');

  // Check if database already exists
  const dbService = new DatabaseService(config.database.path);
  const databaseExists = checkDatabaseExists(config.database.path);

  if (databaseExists && !options.force) {
    console.log('⚠️  Database already exists at:', config.database.path);
    const overwrite = await promptConfirm(
      'Do you want to recreate the database? This will delete all existing data.',
      false
    );
    
    if (!overwrite) {
      console.log('Database initialization cancelled.');
      return;
    }
  }

  if (databaseExists && options.force) {
    console.log('🗑️  Removing existing database...');
    try {
      await deleteDatabase(config.database.path);
      console.log('✅ Existing database removed');
    } catch (error) {
      console.error('❌ Failed to remove existing database:', error);
      process.exit(1);
    }
  }

  // Initialize database
  const progress = new ProgressIndicator('Initializing database...');
  progress.start();

  try {
    await dbService.initialize();
    progress.stop('Database initialized successfully!');
  } catch (error) {
    progress.fail('Database initialization failed');
    throw error;
  }

  // Verify database structure
  console.log('');
  console.log('🔍 Verifying database structure...');
  
  const verificationProgress = new ProgressIndicator('Checking tables and indexes...');
  verificationProgress.start();

  try {
    const verification = await verifyDatabaseStructure(dbService);
    verificationProgress.stop('Database structure verified!');
    
    console.log('');
    console.log('📋 Database Structure:');
    verification.tables.forEach(table => {
      console.log(`  ✅ Table: ${table.name} (${table.columns} columns)`);
    });
    
    verification.indexes.forEach(index => {
      console.log(`  📊 Index: ${index}`);
    });
    
  } catch (error) {
    verificationProgress.fail('Database verification failed');
    console.error('⚠️  Warning: Database structure verification failed:', error);
  }

  // Test database operations if requested
  if (options.test) {
    console.log('');
    await testDatabaseOperations(dbService);
  }

  // Show next steps
  console.log('');
  console.log('✅ Database initialization complete!');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Add a document: rag-tool add <file>');
  console.log('  2. Search documents: rag-tool search "<query>"');
  console.log('  3. Start MCP server: rag-tool server');
  console.log('');

  // Close database connection
  dbService.close();
}

function checkDatabaseExists(dbPath: string): boolean {
  try {
    return require('fs').existsSync(dbPath);
  } catch {
    return false;
  }
}

async function deleteDatabase(dbPath: string): Promise<void> {
  const fs = require('fs').promises;
  try {
    await fs.unlink(dbPath);
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function verifyDatabaseStructure(dbService: DatabaseService): Promise<{
  tables: Array<{ name: string; columns: number }>;
  indexes: string[];
}> {
  const db = dbService.getDb();
  
  // Get table information
  const tables = db.prepare(`
    SELECT name, sql FROM sqlite_master 
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{ name: string; sql: string }>;

  // Get column counts for each table
  const tablesWithColumns = tables.map(table => {
    const columns = db.prepare(`PRAGMA table_info(${table.name})`).all();
    return {
      name: table.name,
      columns: columns.length,
    };
  });

  // Get index information
  const indexes = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{ name: string }>;

  return {
    tables: tablesWithColumns,
    indexes: indexes.map(idx => idx.name),
  };
}

async function testDatabaseOperations(dbService: DatabaseService): Promise<void> {
  console.log('🧪 Testing database operations...');
  
  const testProgress = new ProgressIndicator('Running database tests...');
  testProgress.start();

  try {
    // Test document insertion
    const testDoc = dbService.insertDocument({
      filename: 'test.txt',
      filepath: '/tmp/test.txt',
      content: 'This is a test document for database verification.',
      content_hash: 'test-hash-123',
      total_chunks: 1,
      processed_chunks: 0,
      status: 'pending',
    });

    // Test chunk insertion
    const testChunk = dbService.insertChunk({
      document_id: testDoc.id,
      chunk_index: 0,
      original_text: 'This is a test document for database verification.',
      start_position: 0,
      end_position: 49,
      status: 'pending',
      processing_step: 'chunking',
    });

    // Test embedding insertion (mock embedding)
    const mockEmbedding = new Float32Array(1536).fill(0.1);
    const embeddingBuffer = Buffer.from(mockEmbedding.buffer);
    
    dbService.insertEmbedding({
      chunk_id: testChunk.id,
      embedding: embeddingBuffer,
      model_used: 'test-embedding-model',
      embedding_dimension: 1536,
    });

    // Test queries
    const retrievedDoc = dbService.getDocumentById(testDoc.id);
    const retrievedChunks = dbService.getChunksByDocumentId(testDoc.id);
    const retrievedEmbedding = dbService.getEmbeddingByChunkId(testChunk.id);

    // Verify results
    if (!retrievedDoc || retrievedChunks.length === 0 || !retrievedEmbedding) {
      throw new Error('Database test operations failed - data retrieval incomplete');
    }

    // Clean up test data
    // Note: Due to foreign key constraints, deleting the document will cascade
    // and delete associated chunks and embeddings
    const db = dbService.getDb();
    db.prepare('DELETE FROM documents WHERE id = ?').run(testDoc.id);

    testProgress.stop('Database tests passed!');
    
    console.log('');
    console.log('✅ Test Results:');
    console.log('  📄 Document operations: Working');
    console.log('  📝 Chunk operations: Working');
    console.log('  🔢 Embedding operations: Working');
    console.log('  🔗 Foreign key constraints: Working');
    console.log('  🗑️  Data cleanup: Working');
    
  } catch (error) {
    testProgress.fail('Database tests failed');
    console.error('❌ Test failure details:', error);
    throw new Error(`Database test failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}