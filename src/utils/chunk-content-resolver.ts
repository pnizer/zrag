import { promises as fs } from 'fs';
import { Document, Chunk } from '../types/document.js';
import { TextProcessor } from './text-processing.js';
import { FileError } from './errors.js';

export interface ChunkContent {
  text: string;
  document: Document;
  chunk: Chunk;
}

export interface ResolvedChunk extends Chunk {
  text: string;
}

/**
 * Utility class for resolving chunk content from original files
 * using stored position indices
 */
export class ChunkContentResolver {
  private fileContentCache = new Map<string, { content: string; lastModified: number; hash: string }>();
  private maxCacheSize = 10; // Keep max 10 files in memory

  /**
   * Extract text content for a single chunk from its original file
   */
  async resolveChunkContent(document: Document, chunk: Chunk): Promise<ChunkContent> {
    try {
      const fileContent = await this.getFileContent(document);
      const text = this.extractChunkText(fileContent, chunk);
      
      return {
        text,
        document,
        chunk
      };
    } catch (error) {
      throw new FileError(`Failed to resolve chunk content: ${String(error)}`);
    }
  }

  /**
   * Extract text content for multiple chunks from the same document
   * Optimized for batch operations on the same file
   */
  async resolveMultipleChunks(document: Document, chunks: Chunk[]): Promise<ChunkContent[]> {
    try {
      const fileContent = await this.getFileContent(document);
      
      return chunks.map(chunk => ({
        text: this.extractChunkText(fileContent, chunk),
        document,
        chunk
      }));
    } catch (error) {
      throw new FileError(`Failed to resolve multiple chunks: ${String(error)}`);
    }
  }

  /**
   * Get text content for a chunk as a simple string
   */
  async getChunkText(document: Document, chunk: Chunk): Promise<string> {
    const fileContent = await this.getFileContent(document);
    return this.extractChunkText(fileContent, chunk);
  }

  /**
   * Get full document content from file
   */
  async getDocumentContent(document: Document): Promise<string> {
    return await this.getFileContent(document);
  }

  /**
   * Validate that a file hasn't changed since it was indexed
   */
  async validateFileIntegrity(document: Document): Promise<{ valid: boolean; reason?: string }> {
    try {
      const stats = await fs.stat(document.filepath);
      
      // Check if file exists
      if (!stats.isFile()) {
        return { valid: false, reason: 'File no longer exists or is not a file' };
      }

      // Check file size
      if (stats.size !== document.file_size) {
        return { valid: false, reason: 'File size has changed' };
      }

      // Check modification time if available
      if (document.file_modified) {
        const documentModified = new Date(document.file_modified).getTime();
        const currentModified = stats.mtime.getTime();
        
        if (currentModified !== documentModified) {
          return { valid: false, reason: 'File has been modified' };
        }
      }

      // For more robust checking, we could verify the hash
      // but that requires reading the entire file
      return { valid: true };
      
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        return { valid: false, reason: 'File not found' };
      }
      
      if ((error as { code?: string }).code === 'EACCES') {
        return { valid: false, reason: 'Permission denied' };
      }
      
      return { valid: false, reason: `File access error: ${String(error)}` };
    }
  }

  /**
   * Clear the file content cache
   */
  clearCache(): void {
    this.fileContentCache.clear();
  }

  /**
   * Remove a specific file from cache
   */
  invalidateFile(filepath: string): void {
    this.fileContentCache.delete(filepath);
  }

  /**
   * Get cached file content or read from disk
   */
  private async getFileContent(document: Document): Promise<string> {
    const cacheKey = document.filepath;
    const cached = this.fileContentCache.get(cacheKey);
    
    // Check if we have valid cached content
    if (cached && cached.hash === document.file_hash) {
      return cached.content;
    }

    // Validate file integrity before reading
    const integrity = await this.validateFileIntegrity(document);
    if (!integrity.valid) {
      throw new FileError(`File integrity check failed: ${integrity.reason}`);
    }

    try {
      // Read file content
      const rawContent = await fs.readFile(document.filepath, 'utf-8');
      
      // Extract text based on file format
      const fileExtension = document.filepath.toLowerCase().split('.').pop() || '';
      const format = this.getTextFormat(fileExtension);
      const extractedText = TextProcessor.extractText(rawContent, format);
      
      // Cache the content
      this.cacheFileContent(document.filepath, extractedText, document.file_hash);
      
      return extractedText;
      
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        throw new FileError('File not found');
      }
      
      if ((error as { code?: string }).code === 'EACCES') {
        throw new FileError('Permission denied');
      }
      
      throw new FileError(`Failed to read file: ${String(error)}`);
    }
  }

  /**
   * Extract chunk text from file content using stored positions
   */
  private extractChunkText(fileContent: string, chunk: Chunk): string {
    if (chunk.start_position < 0 || chunk.end_position > fileContent.length) {
      throw new FileError('Chunk positions are out of bounds for file content');
    }

    if (chunk.start_position >= chunk.end_position) {
      throw new FileError('Invalid chunk positions: start >= end');
    }

    const text = fileContent.substring(chunk.start_position, chunk.end_position);
    
    // Validate chunk length if specified
    if (chunk.chunk_length && text.length !== chunk.chunk_length) {
      console.warn(`Chunk length mismatch: expected ${chunk.chunk_length}, got ${text.length}`);
    }

    return text;
  }

  /**
   * Cache file content with LRU eviction
   */
  private cacheFileContent(filepath: string, content: string, hash: string): void {
    // Evict oldest entries if cache is full
    if (this.fileContentCache.size >= this.maxCacheSize) {
      const firstKey = this.fileContentCache.keys().next().value;
      if (firstKey) {
        this.fileContentCache.delete(firstKey);
      }
    }

    this.fileContentCache.set(filepath, {
      content,
      lastModified: Date.now(),
      hash
    });
  }

  /**
   * Determine text format from file extension
   */
  private getTextFormat(extension: string): 'txt' | 'md' {
    switch (extension) {
      case 'md':
      case 'markdown':
        return 'md';
      case 'txt':
      default:
        return 'txt';
    }
  }
}

// Singleton instance for global use
export const chunkContentResolver = new ChunkContentResolver();