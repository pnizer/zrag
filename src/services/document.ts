import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseService } from './database.js';
import { TextChunker, ChunkingOptions } from '../utils/chunking.js';
import { TextProcessor } from '../utils/text-processing.js';
import { Document, Chunk } from '../types/document.js';
import { FileError, ValidationError } from '../utils/errors.js';
import { ChunkContentResolver } from '../utils/chunk-content-resolver.js';

export interface DocumentProcessingOptions {
  chunking: ChunkingOptions;
  validateContent?: boolean;
  extractMetadata?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

export interface DocumentProcessingResult {
  document: Document;
  chunks: Chunk[];
  metadata: {
    wordCount: number;
    characterCount: number;
    estimatedTokens: number;
    language?: string;
    hasStructure: boolean;
  } | undefined;
  dryRun?: boolean;
  analysis?: {
    avgChunkSize: number;
    minChunkSize: number;
    maxChunkSize: number;
    totalOverlap: number;
  };
}

export class DocumentService {
  private db: DatabaseService;
  private defaultOptions: DocumentProcessingOptions;
  private chunkResolver: ChunkContentResolver;

  constructor(db: DatabaseService, options?: Partial<DocumentProcessingOptions>) {
    this.db = db;
    this.chunkResolver = new ChunkContentResolver();
    this.defaultOptions = {
      chunking: {
        strategy: 'sentence',
        chunkSize: 1000,
        overlap: 200,
      },
      validateContent: true,
      extractMetadata: true,
      ...options,
    };
  }

  /**
   * Load and process a document from file
   */
  async processDocumentFromFile(
    filePath: string,
    options?: Partial<DocumentProcessingOptions>
  ): Promise<DocumentProcessingResult> {
    try {
      // Validate file path
      const absolutePath = path.resolve(filePath);
      await this.validateFilePath(absolutePath);

      // Read file content
      const content = await fs.readFile(absolutePath, 'utf-8');
      const filename = path.basename(absolutePath);

      return await this.processDocument(filename, absolutePath, content, options);
    } catch (error) {
      if (error instanceof FileError || error instanceof ValidationError) {
        throw error;
      }
      throw new FileError(`Failed to process document from file: ${String(error)}`);
    }
  }

  /**
   * Process document content directly
   */
  async processDocument(
    filename: string,
    filepath: string,
    content: string,
    options?: Partial<DocumentProcessingOptions>
  ): Promise<DocumentProcessingResult> {
    const processingOptions = { ...this.defaultOptions, ...options };

    try {
      // Extract and clean text based on file format
      const fileExtension = path.extname(filename).toLowerCase();
      const format = this.getTextFormat(fileExtension);
      const extractedText = TextProcessor.extractText(content, format);

      // Validate content if requested
      if (processingOptions.validateContent) {
        const validation = TextProcessor.validateText(extractedText);
        if (!validation.valid) {
          throw new ValidationError(`Invalid document content: ${validation.errors.join(', ')}`);
        }
      }

      // Get file statistics and generate hash
      const stats = await fs.stat(filepath);
      const fileContent = await fs.readFile(filepath);
      const fileHash = crypto.createHash('sha256').update(fileContent).digest('hex');

      // Check if document already exists by file hash (only in non-dry-run mode)
      if (!processingOptions.dryRun) {
        const existingDoc = this.db.getDocumentByHash(fileHash);
        if (existingDoc) {
          const chunks = this.db.getChunksByDocumentId(existingDoc.id);
          return {
            document: existingDoc,
            chunks,
            metadata: processingOptions.extractMetadata
              ? TextProcessor.extractMetadata(extractedText)
              : undefined,
          };
        }
      }

      // Validate chunking options
      TextChunker.validateOptions(processingOptions.chunking);

      // Create chunker and split text
      if (processingOptions.verbose) {
        console.log('\n🔍 [VERBOSE] Chunking Details:');
        console.log(`  📄 Input text length: ${extractedText.length} characters`);
        console.log(`  ⚙️  Strategy: ${processingOptions.chunking.strategy}`);
        console.log(`  📏 Chunk size: ${processingOptions.chunking.chunkSize}`);
        console.log(`  🔄 Overlap: ${processingOptions.chunking.overlap}`);
        console.log('  🔄 Starting chunking process...');
      }
      
      const chunker = new TextChunker(processingOptions.chunking);
      const textChunks = chunker.chunk(extractedText);
      
      if (processingOptions.verbose) {
        console.log(`  ✅ Chunking complete: ${textChunks.length} chunks created`);
        console.log('\n🔍 [VERBOSE] Chunk Details:');
        textChunks.slice(0, 3).forEach((chunk, index) => {
          console.log(`  📝 Chunk ${index + 1}:`);
          console.log(`    Position: ${chunk.startPosition}-${chunk.endPosition}`);
          console.log(`    Length: ${chunk.text.length} chars`);
          console.log(`    Preview: "${chunk.text.substring(0, 100)}${chunk.text.length > 100 ? '...' : ''}`);
        });
        if (textChunks.length > 3) {
          console.log(`   ... and ${textChunks.length - 3} more chunks`);
        }
      }

      // Calculate analysis statistics for both dry-run and normal mode
      const chunkSizes = textChunks.map(chunk => chunk.text.length);
      const avgChunkSize = chunkSizes.reduce((sum, size) => sum + size, 0) / chunkSizes.length;
      const minChunkSize = Math.min(...chunkSizes);
      const maxChunkSize = Math.max(...chunkSizes);
      const totalContentInChunks = chunkSizes.reduce((sum, size) => sum + size, 0);
      const totalOverlap = Math.max(0, totalContentInChunks - extractedText.length);

      const analysis = {
        avgChunkSize,
        minChunkSize,
        maxChunkSize,
        totalOverlap,
      };

      // In dry-run mode, create a mock document without database operations
      if (processingOptions.dryRun) {
        const mockDocument: Document = {
          id: 0, // Mock ID for dry run
          filename,
          filepath,
          file_hash: fileHash,
          file_size: stats.size,
          file_modified: stats.mtime.toISOString(),
          text_encoding: 'utf-8',
          total_chunks: textChunks.length,
          processed_chunks: 0,
          status: 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // Create mock chunks for dry run
        const mockChunks: Chunk[] = textChunks.map(textChunk => ({
          id: textChunk.index, // Mock ID
          document_id: 0, // Mock document ID
          chunk_index: textChunk.index,
          start_position: textChunk.startPosition,
          end_position: textChunk.endPosition,
          chunk_length: textChunk.text.length,
          status: 'pending',
          processing_step: 'chunking',
          created_at: new Date().toISOString(),
        }));

        return {
          document: mockDocument,
          chunks: mockChunks,
          metadata: processingOptions.extractMetadata
            ? TextProcessor.extractMetadata(extractedText)
            : undefined,
          dryRun: true,
          analysis,
        };
      }

      // Normal mode: create actual database records
      const document = this.db.insertDocument({
        filename,
        filepath,
        file_hash: fileHash,
        file_size: stats.size,
        file_modified: stats.mtime.toISOString(),
        text_encoding: 'utf-8',
        total_chunks: textChunks.length,
        processed_chunks: 0,
        status: 'pending',
      });

      // Create chunk records with position indices only
      const chunks: Chunk[] = [];
      for (const textChunk of textChunks) {
        const chunk = this.db.insertChunk({
          document_id: document.id,
          chunk_index: textChunk.index,
          start_position: textChunk.startPosition,
          end_position: textChunk.endPosition,
          chunk_length: textChunk.text.length,
          status: 'pending',
          processing_step: 'chunking' as 'chunking',
        });
        chunks.push(chunk);
      }

      // Update document to reflect chunking completion
      const updatedDocument = this.db.updateDocument(document.id, {
        status: 'processing',
        processed_chunks: textChunks.length,
      });

      return {
        document: updatedDocument!,
        chunks,
        metadata: processingOptions.extractMetadata
          ? TextProcessor.extractMetadata(extractedText)
          : undefined,
        analysis,
      };
    } catch (error) {
      if (error instanceof ValidationError || error instanceof FileError) {
        throw error;
      }
      throw new FileError(`Failed to process document: ${String(error)}`);
    }
  }

  /**
   * Resume processing for an incomplete document
   */
  async resumeDocumentProcessing(documentId: number): Promise<DocumentProcessingResult> {
    const document = this.db.getDocumentById(documentId);
    if (!document) {
      throw new ValidationError(`Document with ID ${documentId} not found`);
    }

    const chunks = this.db.getChunksByDocumentId(documentId);

    // Get document content from file for metadata extraction
    const documentContent = await this.chunkResolver.getDocumentContent(document);

    return {
      document,
      chunks,
      metadata: TextProcessor.extractMetadata(documentContent),
    };
  }

  /**
   * Get document by ID
   */
  async getDocument(documentId: number): Promise<DocumentProcessingResult | null> {
    const document = this.db.getDocumentById(documentId);
    if (!document) {
      return null;
    }

    const chunks = this.db.getChunksByDocumentId(documentId);

    // Get document content from file for metadata extraction
    const documentContent = await this.chunkResolver.getDocumentContent(document);

    return {
      document,
      chunks,
      metadata: TextProcessor.extractMetadata(documentContent),
    };
  }

  /**
   * List all documents with pagination
   */
  async listDocuments(limit: number = 50, offset: number = 0): Promise<Document[]> {
    return this.db.listDocuments(limit, offset);
  }

  /**
   * Update chunk processing status
   */
  async updateChunkStatus(
    chunkId: number,
    status: Chunk['status'],
    errorMessage?: string,
    processingStep?: Chunk['processing_step']
  ): Promise<Chunk | null> {
    const updates: Partial<Chunk> = { status };
    
    if (errorMessage) {
      updates.error_message = errorMessage;
    }
    
    if (processingStep) {
      updates.processing_step = processingStep;
    }

    return this.db.updateChunk(chunkId, updates);
  }

  /**
   * Update document processing status
   */
  async updateDocumentStatus(
    documentId: number,
    status: Document['status'],
    processedChunks?: number,
    errorMessage?: string
  ): Promise<Document | null> {
    const updates: Partial<Document> = { status };
    
    if (processedChunks !== undefined) {
      updates.processed_chunks = processedChunks;
    }
    
    if (errorMessage) {
      updates.last_error = errorMessage;
    }

    return this.db.updateDocument(documentId, updates);
  }

  /**
   * Get incomplete chunks for a document
   */
  async getIncompleteChunks(documentId: number): Promise<Chunk[]> {
    const allChunks = this.db.getChunksByDocumentId(documentId);
    return allChunks.filter(chunk => chunk.status !== 'complete');
  }

  /**
   * Get next chunk to process
   */
  async getNextChunkToProcess(documentId: number): Promise<Chunk | null> {
    const incompleteChunks = await this.getIncompleteChunks(documentId);
    
    // Return first chunk that's not in a failed state
    return incompleteChunks.find(chunk => chunk.status !== 'failed') || null;
  }

  /**
   * Mark chunk as contextualized
   * Note: In file-reference mode, we don't store contextualized text in the database
   */
  async setChunkContext(chunkId: number, _contextualizedText: string): Promise<Chunk | null> {
    return this.db.updateChunk(chunkId, {
      status: 'contextualized',
      processing_step: 'context_generation',
    });
  }

  /**
   * Check if document processing is complete
   */
  async isDocumentComplete(documentId: number): Promise<boolean> {
    const incompleteChunks = await this.getIncompleteChunks(documentId);
    return incompleteChunks.length === 0;
  }

  /**
   * Validate file path and check if file is supported
   */
  private async validateFilePath(filePath: string): Promise<void> {
    try {
      const stats = await fs.stat(filePath);
      
      if (!stats.isFile()) {
        throw new FileError('Path is not a file');
      }

      // Check file size (max 100MB)
      const maxSize = 100 * 1024 * 1024;
      if (stats.size > maxSize) {
        throw new FileError('File is too large (max 100MB)');
      }

      // Check file extension
      const extension = path.extname(filePath).toLowerCase();
      const supportedExtensions = ['.txt', '.md', '.markdown'];
      
      if (!supportedExtensions.includes(extension)) {
        throw new FileError(`Unsupported file type: ${extension}. Supported: ${supportedExtensions.join(', ')}`);
      }

    } catch (error) {
      if (error instanceof FileError) {
        throw error;
      }
      
      if ((error as { code?: string }).code === 'ENOENT') {
        throw new FileError('File not found');
      }
      
      if ((error as { code?: string }).code === 'EACCES') {
        throw new FileError('Permission denied');
      }
      
      throw new FileError(`File validation failed: ${String(error)}`);
    }
  }

  /**
   * Determine text format from file extension
   */
  private getTextFormat(extension: string): 'txt' | 'md' {
    switch (extension) {
      case '.md':
      case '.markdown':
        return 'md';
      case '.txt':
      default:
        return 'txt';
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
    completedChunks: number;
    failedChunks: number;
    progressPercentage: number;
  }> {
    const chunks = this.db.getChunksByDocumentId(documentId);
    
    const stats = {
      totalChunks: chunks.length,
      pendingChunks: chunks.filter(c => c.status === 'pending').length,
      contextualizedChunks: chunks.filter(c => c.status === 'contextualized').length,
      embeddedChunks: chunks.filter(c => c.status === 'embedded').length,
      completedChunks: chunks.filter(c => c.status === 'complete').length,
      failedChunks: chunks.filter(c => c.status === 'failed').length,
      progressPercentage: 0,
    };

    if (stats.totalChunks > 0) {
      stats.progressPercentage = Math.round((stats.completedChunks / stats.totalChunks) * 100);
    }

    return stats;
  }

  /**
   * Get text content for a specific chunk
   */
  async getChunkText(documentId: number, chunkId: number): Promise<string> {
    const document = this.db.getDocumentById(documentId);
    if (!document) {
      throw new ValidationError(`Document with ID ${documentId} not found`);
    }

    const chunk = this.db.getChunkById(chunkId);
    if (!chunk || chunk.document_id !== documentId) {
      throw new ValidationError(`Chunk with ID ${chunkId} not found in document ${documentId}`);
    }

    return await this.chunkResolver.getChunkText(document, chunk);
  }

  /**
   * Get text content for multiple chunks from the same document
   */
  async getMultipleChunkTexts(documentId: number, chunkIds: number[]): Promise<{ chunkId: number; text: string }[]> {
    const document = this.db.getDocumentById(documentId);
    if (!document) {
      throw new ValidationError(`Document with ID ${documentId} not found`);
    }

    const chunks = chunkIds.map(id => {
      const chunk = this.db.getChunkById(id);
      if (!chunk || chunk.document_id !== documentId) {
        throw new ValidationError(`Chunk with ID ${id} not found in document ${documentId}`);
      }
      return chunk;
    });

    const chunkContents = await this.chunkResolver.resolveMultipleChunks(document, chunks);
    
    return chunkContents.map(content => ({
      chunkId: content.chunk.id,
      text: content.text
    }));
  }

  /**
   * Get full document content from file
   */
  async getFullDocumentContent(documentId: number): Promise<string> {
    const document = this.db.getDocumentById(documentId);
    if (!document) {
      throw new ValidationError(`Document with ID ${documentId} not found`);
    }

    return await this.chunkResolver.getDocumentContent(document);
  }

  /**
   * Validate that a document's file is still accessible and unchanged
   */
  async validateDocumentFile(documentId: number): Promise<{ valid: boolean; reason?: string }> {
    const document = this.db.getDocumentById(documentId);
    if (!document) {
      throw new ValidationError(`Document with ID ${documentId} not found`);
    }

    return await this.chunkResolver.validateFileIntegrity(document);
  }
}