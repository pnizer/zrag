import { promises as fs } from 'fs';
import crypto from 'crypto';
import { DatabaseService } from './database.js';
import { Document } from '../types/document.js';
import { FileError } from '../utils/errors.js';

export interface FileIntegrityResult {
  document: Document;
  valid: boolean;
  reason?: string;
  currentHash?: string;
  currentSize?: number;
  currentModified?: Date;
}

export interface FileIntegrityStats {
  totalDocuments: number;
  validDocuments: number;
  invalidDocuments: number;
  missingFiles: number;
  modifiedFiles: number;
  corruptedFiles: number;
}

/**
 * Service for monitoring and maintaining file integrity
 * for documents in the RAG database
 */
export class FileIntegrityService {
  private db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  /**
   * Check integrity of a single document
   */
  async checkDocumentIntegrity(document: Document): Promise<FileIntegrityResult> {
    try {
      // Check if file exists and get stats
      const stats = await fs.stat(document.filepath);
      
      if (!stats.isFile()) {
        return {
          document,
          valid: false,
          reason: 'Path is not a file'
        };
      }

      // Check file size
      if (stats.size !== document.file_size) {
        return {
          document,
          valid: false,
          reason: 'File size has changed',
          currentSize: stats.size
        };
      }

      // Check modification time if available
      if (document.file_modified) {
        const documentModified = new Date(document.file_modified).getTime();
        const currentModified = stats.mtime.getTime();
        
        if (currentModified !== documentModified) {
          return {
            document,
            valid: false,
            reason: 'File modification time has changed',
            currentModified: stats.mtime
          };
        }
      }

      // For thorough validation, check file hash
      const currentHash = await this.calculateFileHash(document.filepath);
      if (currentHash !== document.file_hash) {
        return {
          document,
          valid: false,
          reason: 'File content has changed (hash mismatch)',
          currentHash
        };
      }

      return {
        document,
        valid: true
      };

    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        return {
          document,
          valid: false,
          reason: 'File not found'
        };
      }
      
      if ((error as { code?: string }).code === 'EACCES') {
        return {
          document,
          valid: false,
          reason: 'Permission denied'
        };
      }
      
      return {
        document,
        valid: false,
        reason: `File access error: ${String(error)}`
      };
    }
  }

  /**
   * Check integrity of all documents in the database
   */
  async checkAllDocuments(): Promise<FileIntegrityResult[]> {
    const documents = this.db.listDocuments(1000, 0); // Get all documents
    const results: FileIntegrityResult[] = [];

    for (const document of documents) {
      const result = await this.checkDocumentIntegrity(document);
      results.push(result);
    }

    return results;
  }

  /**
   * Get integrity statistics for all documents
   */
  async getIntegrityStats(): Promise<FileIntegrityStats> {
    const results = await this.checkAllDocuments();
    
    const stats: FileIntegrityStats = {
      totalDocuments: results.length,
      validDocuments: 0,
      invalidDocuments: 0,
      missingFiles: 0,
      modifiedFiles: 0,
      corruptedFiles: 0
    };

    for (const result of results) {
      if (result.valid) {
        stats.validDocuments++;
      } else {
        stats.invalidDocuments++;
        
        if (result.reason === 'File not found') {
          stats.missingFiles++;
        } else if (result.reason?.includes('modified') || result.reason?.includes('size')) {
          stats.modifiedFiles++;
        } else if (result.reason?.includes('hash')) {
          stats.corruptedFiles++;
        }
      }
    }

    return stats;
  }

  /**
   * Update document status based on integrity check
   */
  async updateDocumentStatus(document: Document, integrityResult: FileIntegrityResult): Promise<void> {
    if (!integrityResult.valid) {
      // Mark document as having file issues
      await this.db.updateDocument(document.id, {
        status: 'file_missing',
        last_error: `File integrity issue: ${integrityResult.reason}`
      });
    } else if (document.status === 'file_missing') {
      // File is now available again, reset status
      await this.db.updateDocument(document.id, {
        status: 'complete'
      });
    }
  }

  /**
   * Repair or update a document with changed file
   */
  async repairDocument(document: Document): Promise<{ success: boolean; reason?: string }> {
    try {
      const integrityResult = await this.checkDocumentIntegrity(document);
      
      if (integrityResult.valid) {
        return { success: true };
      }

      // If file is missing, can't repair
      if (integrityResult.reason === 'File not found') {
        return { success: false, reason: 'Cannot repair: file not found' };
      }

      // If file exists but is modified, update document metadata
      if (integrityResult.reason?.includes('modified') || 
          integrityResult.reason?.includes('size') || 
          integrityResult.reason?.includes('hash')) {
        
        const stats = await fs.stat(document.filepath);
        const newHash = await this.calculateFileHash(document.filepath);
        
        // Update document with new file metadata
        await this.db.updateDocument(document.id, {
          file_hash: newHash,
          file_size: stats.size,
          file_modified: stats.mtime.toISOString(),
          status: 'pending', // Will need to be re-processed
          last_error: 'File was modified - requires re-processing'
        });

        return { success: true, reason: 'Document updated with new file metadata - re-processing required' };
      }

      return { success: false, reason: 'Unknown integrity issue' };

    } catch (error) {
      return { success: false, reason: `Repair failed: ${String(error)}` };
    }
  }

  /**
   * Clean up database entries for missing files
   */
  async cleanupMissingFiles(): Promise<{ removedCount: number; errors: string[] }> {
    const results = await this.checkAllDocuments();
    const missingFiles = results.filter(r => !r.valid && r.reason === 'File not found');
    
    let removedCount = 0;
    const errors: string[] = [];

    for (const result of missingFiles) {
      try {
        // This will cascade delete chunks and embeddings due to foreign key constraints
        await this.db.updateDocument(result.document.id, {
          status: 'file_missing',
          last_error: 'File not found - marked for cleanup'
        });
        removedCount++;
      } catch (error) {
        errors.push(`Failed to update document ${result.document.id}: ${String(error)}`);
      }
    }

    return { removedCount, errors };
  }

  /**
   * Calculate SHA-256 hash of a file
   */
  async calculateFileHash(filepath: string): Promise<string> {
    try {
      const content = await fs.readFile(filepath);
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch (error) {
      throw new FileError(`Failed to calculate file hash: ${String(error)}`);
    }
  }

  /**
   * Generate file hash from content string
   */
  generateContentHash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Get documents that need integrity checks
   * Returns documents that haven't been checked recently
   */
  async getDocumentsForIntegrityCheck(maxAge: number = 24 * 60 * 60 * 1000): Promise<Document[]> {
    const documents = this.db.listDocuments(1000, 0);
    const cutoffTime = new Date(Date.now() - maxAge);
    
    return documents.filter(doc => {
      const updatedAt = new Date(doc.updated_at);
      return updatedAt < cutoffTime || doc.status === 'file_missing';
    });
  }

  /**
   * Background integrity monitoring
   * Check a subset of documents periodically
   */
  async performPeriodicCheck(batchSize: number = 10): Promise<FileIntegrityResult[]> {
    const documentsToCheck = await this.getDocumentsForIntegrityCheck();
    const batch = documentsToCheck.slice(0, batchSize);
    
    const results: FileIntegrityResult[] = [];
    
    for (const document of batch) {
      const result = await this.checkDocumentIntegrity(document);
      await this.updateDocumentStatus(document, result);
      results.push(result);
    }
    
    return results;
  }
}