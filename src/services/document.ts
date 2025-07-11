import { promises as fs } from 'fs';
import path from 'path';
import { DatabaseService } from './database.js';
import { TextChunker, ChunkingOptions } from '../utils/chunking.js';
import { TextProcessor } from '../utils/text-processing.js';
import { Document, Chunk } from '../types/document.js';
import { FileError, ValidationError } from '../utils/errors.js';

export interface DocumentProcessingOptions {
  chunking: ChunkingOptions;
  validateContent?: boolean;
  extractMetadata?: boolean;
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
}

export class DocumentService {
  private db: DatabaseService;
  private defaultOptions: DocumentProcessingOptions;

  constructor(db: DatabaseService, options?: Partial<DocumentProcessingOptions>) {
    this.db = db;
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

      // Generate content hash for deduplication
      const contentHash = TextProcessor.generateContentHash(extractedText);

      // Check if document already exists
      const existingDoc = this.db.getDocumentByHash(contentHash);
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

      // Validate chunking options
      TextChunker.validateOptions(processingOptions.chunking);

      // Create chunker and split text
      const chunker = new TextChunker(processingOptions.chunking);
      const textChunks = chunker.chunk(extractedText);

      // Create document record
      const document = this.db.insertDocument({
        filename,
        filepath,
        content: extractedText,
        content_hash: contentHash,
        total_chunks: textChunks.length,
        processed_chunks: 0,
        status: 'pending',
      });

      // Create chunk records
      const chunks: Chunk[] = [];
      for (const textChunk of textChunks) {
        const chunk = this.db.insertChunk({
          document_id: document.id,
          chunk_index: textChunk.index,
          original_text: textChunk.text,
          start_position: textChunk.startPosition,
          end_position: textChunk.endPosition,
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

    return {
      document,
      chunks,
      metadata: TextProcessor.extractMetadata(document.content),
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

    return {
      document,
      chunks,
      metadata: TextProcessor.extractMetadata(document.content),
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
   */
  async setChunkContext(chunkId: number, contextualizedText: string): Promise<Chunk | null> {
    return this.db.updateChunk(chunkId, {
      contextualized_text: contextualizedText,
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
}