import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { DatabaseError } from '../utils/errors.js';
import { Document, Chunk, Embedding } from '../types/document.js';

export class DatabaseService {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || this.getDefaultDbPath();
  }

  private getDefaultDbPath(): string {
    const homeDir = os.homedir();
    return path.join(homeDir, '.rag-tool', 'database.db');
  }

  /**
   * Initialize database connection and schema
   */
  async initialize(): Promise<void> {
    try {
      this.db = new Database(this.dbPath);
      
      // Enable WAL mode for better concurrency
      this.db.pragma('journal_mode = WAL');
      
      // Set up foreign key constraints
      this.db.pragma('foreign_keys = ON');
      
      // Create tables
      await this.createTables();
      
      // TODO: Load sqlite-vss extension when binaries are bundled
      await this.loadVectorExtension();
      
    } catch (error) {
      throw new DatabaseError(`Failed to initialize database: ${String(error)}`);
    }
  }

  /**
   * Create database tables
   */
  private async createTables(): Promise<void> {
    if (!this.db) throw new DatabaseError('Database not initialized');

    try {
      // Documents table with processing status tracking
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT NOT NULL,
          filepath TEXT NOT NULL,
          content TEXT NOT NULL,
          content_hash TEXT NOT NULL UNIQUE,
          total_chunks INTEGER NOT NULL DEFAULT 0,
          processed_chunks INTEGER DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending',
          last_error TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Chunks table with detailed processing status
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS chunks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          document_id INTEGER NOT NULL,
          chunk_index INTEGER NOT NULL,
          original_text TEXT NOT NULL,
          contextualized_text TEXT,
          start_position INTEGER NOT NULL,
          end_position INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          error_message TEXT,
          processing_step TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        )
      `);

      // Embeddings table with vector support
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS embeddings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chunk_id INTEGER NOT NULL,
          embedding BLOB NOT NULL,
          model_used TEXT NOT NULL,
          embedding_dimension INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
        )
      `);

      // Create indexes for performance
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
        CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash);
        CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_status ON chunks(status);
        CREATE INDEX IF NOT EXISTS idx_embeddings_chunk ON embeddings(chunk_id);
      `);

    } catch (error) {
      throw new DatabaseError(`Failed to create tables: ${String(error)}`);
    }
  }

  /**
   * Load vector extension using sqlite-vss npm package
   */
  private async loadVectorExtension(): Promise<void> {
    if (!this.db) throw new DatabaseError('Database not initialized');

    try {
      // Dynamically import sqlite-vss (ES module)
      const sqlite_vss = await import('sqlite-vss');
      
      // Load sqlite-vss extension using the convenience method
      sqlite_vss.load(this.db);
      
      // Verify the extension loaded correctly
      const version = this.db.prepare('SELECT vss_version()').pluck().get();
      console.log(`sqlite-vss loaded successfully, version: ${version}`);
      
      // Create virtual vector table
      await this.createVectorTable();
      
    } catch (error) {
      throw new DatabaseError(`Failed to load vector extension: ${String(error)}`);
    }
  }

  /**
   * Create vector search virtual table
   */
  private async createVectorTable(): Promise<void> {
    if (!this.db) throw new DatabaseError('Database not initialized');

    try {
      // Create virtual table for vector search (1536 dimensions for OpenAI text-embedding-3-small)
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vector_index USING vss0(
          embedding(1536)
        )
      `);
      
      console.log('Vector table created successfully');
    } catch (error) {
      throw new DatabaseError(`Failed to create vector table: ${String(error)}`);
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Get database instance
   */
  getDb(): Database.Database {
    if (!this.db) {
      throw new DatabaseError('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Execute in transaction
   */
  transaction<T>(fn: () => T): T {
    const db = this.getDb();
    const transaction = db.transaction(fn);
    return transaction();
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.db !== null;
  }

  // Document CRUD operations
  
  /**
   * Insert a new document
   */
  insertDocument(doc: Omit<Document, 'id' | 'created_at' | 'updated_at'>): Document {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare(`
        INSERT INTO documents (filename, filepath, content, content_hash, total_chunks, processed_chunks, status, last_error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        doc.filename,
        doc.filepath,
        doc.content,
        doc.content_hash,
        doc.total_chunks,
        doc.processed_chunks,
        doc.status,
        doc.last_error
      );
      
      return this.getDocumentById(result.lastInsertRowid as number)!;
    } catch (error) {
      throw new DatabaseError(`Failed to insert document: ${String(error)}`);
    }
  }

  /**
   * Get document by ID
   */
  getDocumentById(id: number): Document | null {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare('SELECT * FROM documents WHERE id = ?');
      const result = stmt.get(id) as Document | undefined;
      return result || null;
    } catch (error) {
      throw new DatabaseError(`Failed to get document: ${String(error)}`);
    }
  }

  /**
   * Get document by content hash
   */
  getDocumentByHash(contentHash: string): Document | null {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare('SELECT * FROM documents WHERE content_hash = ?');
      const result = stmt.get(contentHash) as Document | undefined;
      return result || null;
    } catch (error) {
      throw new DatabaseError(`Failed to get document by hash: ${String(error)}`);
    }
  }

  /**
   * Update document
   */
  updateDocument(id: number, updates: Partial<Document>): Document | null {
    const db = this.getDb();
    
    try {
      const fields = Object.keys(updates).filter(key => key !== 'id').map(key => `${key} = ?`).join(', ');
      const values = Object.values(updates).filter((_, index) => Object.keys(updates)[index] !== 'id');
      
      if (fields.length === 0) return this.getDocumentById(id);
      
      const stmt = db.prepare(`UPDATE documents SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
      stmt.run(...values, id);
      
      return this.getDocumentById(id);
    } catch (error) {
      throw new DatabaseError(`Failed to update document: ${String(error)}`);
    }
  }

  /**
   * List documents with pagination
   */
  listDocuments(limit: number = 50, offset: number = 0): Document[] {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare('SELECT * FROM documents ORDER BY created_at DESC LIMIT ? OFFSET ?');
      return stmt.all(limit, offset) as Document[];
    } catch (error) {
      throw new DatabaseError(`Failed to list documents: ${String(error)}`);
    }
  }

  // Chunk CRUD operations

  /**
   * Insert a new chunk
   */
  insertChunk(chunk: Omit<Chunk, 'id' | 'created_at'>): Chunk {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare(`
        INSERT INTO chunks (document_id, chunk_index, original_text, contextualized_text, start_position, end_position, status, error_message, processing_step)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        chunk.document_id,
        chunk.chunk_index,
        chunk.original_text,
        chunk.contextualized_text,
        chunk.start_position,
        chunk.end_position,
        chunk.status,
        chunk.error_message,
        chunk.processing_step
      );
      
      return this.getChunkById(result.lastInsertRowid as number)!;
    } catch (error) {
      throw new DatabaseError(`Failed to insert chunk: ${String(error)}`);
    }
  }

  /**
   * Get chunk by ID
   */
  getChunkById(id: number): Chunk | null {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare('SELECT * FROM chunks WHERE id = ?');
      const result = stmt.get(id) as Chunk | undefined;
      return result || null;
    } catch (error) {
      throw new DatabaseError(`Failed to get chunk: ${String(error)}`);
    }
  }

  /**
   * Get chunks by document ID
   */
  getChunksByDocumentId(documentId: number): Chunk[] {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare('SELECT * FROM chunks WHERE document_id = ? ORDER BY chunk_index');
      return stmt.all(documentId) as Chunk[];
    } catch (error) {
      throw new DatabaseError(`Failed to get chunks: ${String(error)}`);
    }
  }

  /**
   * Update chunk
   */
  updateChunk(id: number, updates: Partial<Chunk>): Chunk | null {
    const db = this.getDb();
    
    try {
      const fields = Object.keys(updates).filter(key => key !== 'id').map(key => `${key} = ?`).join(', ');
      const values = Object.values(updates).filter((_, index) => Object.keys(updates)[index] !== 'id');
      
      if (fields.length === 0) return this.getChunkById(id);
      
      const stmt = db.prepare(`UPDATE chunks SET ${fields} WHERE id = ?`);
      stmt.run(...values, id);
      
      return this.getChunkById(id);
    } catch (error) {
      throw new DatabaseError(`Failed to update chunk: ${String(error)}`);
    }
  }

  // Embedding operations

  /**
   * Insert embedding
   */
  insertEmbedding(embedding: Omit<Embedding, 'id' | 'created_at'>): Embedding {
    const db = this.getDb();
    
    try {
      return this.transaction(() => {
        // Insert into embeddings table
        const stmt = db.prepare(`
          INSERT INTO embeddings (chunk_id, embedding, model_used, embedding_dimension)
          VALUES (?, ?, ?, ?)
        `);
        
        const result = stmt.run(
          embedding.chunk_id,
          embedding.embedding,
          embedding.model_used,
          embedding.embedding_dimension
        );
        
        const embeddingId = result.lastInsertRowid as number;
        
        // Convert BLOB back to array for vector index
        const embeddingArray = Array.from(new Float32Array(embedding.embedding as ArrayBuffer));
        
        // Insert into vector index
        this.insertEmbeddingIntoVectorIndex(embeddingId, embeddingArray);
        
        return this.getEmbeddingById(embeddingId)!;
      });
    } catch (error) {
      throw new DatabaseError(`Failed to insert embedding: ${String(error)}`);
    }
  }

  /**
   * Get embedding by ID
   */
  getEmbeddingById(id: number): Embedding | null {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare('SELECT * FROM embeddings WHERE id = ?');
      const result = stmt.get(id) as Embedding | undefined;
      return result || null;
    } catch (error) {
      throw new DatabaseError(`Failed to get embedding: ${String(error)}`);
    }
  }

  /**
   * Get embedding by chunk ID
   */
  getEmbeddingByChunkId(chunkId: number): Embedding | null {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare('SELECT * FROM embeddings WHERE chunk_id = ?');
      const result = stmt.get(chunkId) as Embedding | undefined;
      return result || null;
    } catch (error) {
      throw new DatabaseError(`Failed to get embedding by chunk: ${String(error)}`);
    }
  }

  /**
   * Vector similarity search using sqlite-vss
   */
  searchSimilarChunks(queryEmbedding: number[], limit: number = 10, threshold: number = 0.7): Array<{
    chunk: Chunk;
    document: Document;
    similarity_score: number;
  }> {
    const db = this.getDb();
    
    try {
      // Convert embedding to the format expected by sqlite-vss
      const embeddingBlob = Buffer.from(new Float32Array(queryEmbedding).buffer);
      
      const stmt = db.prepare(`
        SELECT 
          c.*,
          d.filename,
          d.filepath,
          d.content as document_content,
          d.content_hash,
          d.last_error,
          d.created_at as document_created_at,
          v.distance
        FROM vector_index v
        JOIN embeddings e ON e.rowid = v.rowid
        JOIN chunks c ON c.id = e.chunk_id
        JOIN documents d ON d.id = c.document_id
        WHERE v.embedding MATCH ?
          AND v.distance <= ?
        ORDER BY v.distance
        LIMIT ?
      `);
      
      const results = stmt.all(embeddingBlob, 1 - threshold, limit) as any[];
      
      return results.map(row => ({
        chunk: {
          id: row.id,
          document_id: row.document_id,
          chunk_index: row.chunk_index,
          original_text: row.original_text,
          contextualized_text: row.contextualized_text,
          start_position: row.start_position,
          end_position: row.end_position,
          status: row.status,
          error_message: row.error_message,
          processing_step: row.processing_step,
          created_at: row.created_at
        },
        document: {
          id: row.document_id,
          filename: row.filename,
          filepath: row.filepath,
          content: row.document_content,
          content_hash: row.content_hash,
          total_chunks: 0, // Will be filled by calling code if needed
          processed_chunks: 0, // Will be filled by calling code if needed
          status: 'complete', // Assume complete since we're searching
          last_error: row.last_error || null,
          created_at: row.document_created_at,
          updated_at: row.document_created_at
        } as Document,
        similarity_score: 1 - row.distance // Convert distance to similarity
      }));
    } catch (error) {
      throw new DatabaseError(`Failed to search similar chunks: ${String(error)}`);
    }
  }

  /**
   * Insert embedding into vector index
   */
  insertEmbeddingIntoVectorIndex(embeddingId: number, embedding: number[]): void {
    const db = this.getDb();
    
    try {
      // Convert embedding to the format expected by sqlite-vss
      const embeddingBlob = Buffer.from(new Float32Array(embedding).buffer);
      
      const stmt = db.prepare(`
        INSERT INTO vector_index (rowid, embedding)
        VALUES (?, ?)
      `);
      
      stmt.run(embeddingId, embeddingBlob);
    } catch (error) {
      throw new DatabaseError(`Failed to insert embedding into vector index: ${String(error)}`);
    }
  }
}