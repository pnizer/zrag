import crypto from 'crypto';

export class TextProcessor {
  /**
   * Clean and normalize text content
   */
  static cleanText(text: string): string {
    return text
      // Normalize Unicode characters
      .normalize('NFKD')
      // Remove or replace problematic characters
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
      .replace(/\u00A0/g, ' ') // Replace non-breaking spaces with regular spaces
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Trim
      .trim();
  }

  /**
   * Extract plain text from various formats
   */
  static extractText(content: string, format: 'txt' | 'md' = 'txt'): string {
    switch (format) {
      case 'txt':
        return this.cleanText(content);
      case 'md':
        return this.extractFromMarkdown(content);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Extract plain text from Markdown
   */
  private static extractFromMarkdown(markdown: string): string {
    return markdown
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`\n]+`/g, '')
      // Remove headers (keep text)
      .replace(/^#{1,6}\s+/gm, '')
      // Remove links but keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove images
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
      // Remove emphasis markers
      .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1')
      // Remove strikethrough
      .replace(/~~([^~]+)~~/g, '$1')
      // Remove horizontal rules
      .replace(/^[-*_]{3,}$/gm, '')
      // Remove list markers
      .replace(/^[\s]*[-*+]\s+/gm, '')
      .replace(/^[\s]*\d+\.\s+/gm, '')
      // Clean up
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Generate content hash for deduplication
   */
  static generateContentHash(content: string): string {
    const normalizedContent = this.cleanText(content);
    return crypto.createHash('sha256').update(normalizedContent).digest('hex');
  }

  /**
   * Estimate token count (rough approximation)
   */
  static estimateTokenCount(text: string): number {
    // Rough estimation: ~4 characters per token for English text
    const cleanedText = this.cleanText(text);
    return Math.ceil(cleanedText.length / 4);
  }

  /**
   * Truncate text to maximum token count
   */
  static truncateToTokens(text: string, maxTokens: number): string {
    const estimatedTokens = this.estimateTokenCount(text);
    
    if (estimatedTokens <= maxTokens) {
      return text;
    }
    
    // Approximate character limit
    const maxChars = maxTokens * 4;
    const truncated = text.slice(0, maxChars);
    
    // Try to end at a sentence boundary
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf('.'),
      truncated.lastIndexOf('!'),
      truncated.lastIndexOf('?')
    );
    
    if (lastSentenceEnd > maxChars * 0.8) {
      return truncated.slice(0, lastSentenceEnd + 1).trim();
    }
    
    // Fall back to word boundary
    const lastSpaceIndex = truncated.lastIndexOf(' ');
    if (lastSpaceIndex > maxChars * 0.8) {
      return truncated.slice(0, lastSpaceIndex).trim();
    }
    
    return truncated.trim();
  }

  /**
   * Validate text content
   */
  static validateText(text: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!text || typeof text !== 'string') {
      errors.push('Text must be a non-empty string');
      return { valid: false, errors };
    }
    
    const cleanedText = this.cleanText(text);
    
    if (cleanedText.length === 0) {
      errors.push('Text cannot be empty after cleaning');
    }
    
    if (cleanedText.length > 10_000_000) { // 10MB limit
      errors.push('Text is too large (max 10MB)');
    }
    
    // Check for minimal meaningful content
    const wordCount = cleanedText.split(/\s+/).filter(word => word.length > 0).length;
    if (wordCount < 3) {
      errors.push('Text must contain at least 3 words');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Extract metadata from text content
   */
  static extractMetadata(text: string): {
    wordCount: number;
    characterCount: number;
    estimatedTokens: number;
    language?: string;
    hasStructure: boolean;
  } {
    const cleanedText = this.cleanText(text);
    const words = cleanedText.split(/\s+/).filter(word => word.length > 0);
    
    return {
      wordCount: words.length,
      characterCount: cleanedText.length,
      estimatedTokens: this.estimateTokenCount(cleanedText),
      language: this.detectLanguage(cleanedText),
      hasStructure: this.hasStructuralElements(text)
    };
  }

  /**
   * Simple language detection (basic heuristics)
   */
  private static detectLanguage(text: string): string {
    // Very basic language detection - could be enhanced with a proper library
    const sample = text.slice(0, 1000).toLowerCase();
    
    // Common English words
    const englishWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
    const englishMatches = englishWords.filter(word => sample.includes(` ${word} `)).length;
    
    if (englishMatches >= 3) {
      return 'en';
    }
    
    return 'unknown';
  }

  /**
   * Check if text has structural elements
   */
  private static hasStructuralElements(text: string): boolean {
    // Check for headers, lists, or other structural markdown
    const structuralPatterns = [
      /^#{1,6}\s/m,        // Headers
      /^[-*+]\s/m,         // Unordered lists
      /^\d+\.\s/m,         // Ordered lists
      /^>\s/m,             // Blockquotes
      /```[\s\S]*?```/,    // Code blocks
      /\|.*\|/m,           // Tables
    ];
    
    return structuralPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Split text into logical sections
   */
  static splitIntoSections(text: string): Array<{
    title?: string;
    content: string;
    startPosition: number;
    endPosition: number;
  }> {
    const sections: Array<{
      title?: string;
      content: string;
      startPosition: number;
      endPosition: number;
    }> = [];
    
    // Split by markdown headers
    const headerRegex = /^(#{1,6})\s+(.+)$/gm;
    let lastIndex = 0;
    let match;
    
    while ((match = headerRegex.exec(text)) !== null) {
      // Add previous section if exists
      if (match.index > lastIndex) {
        const prevContent = text.slice(lastIndex, match.index).trim();
        if (prevContent.length > 0) {
          sections.push({
            content: prevContent,
            startPosition: lastIndex,
            endPosition: match.index
          });
        }
      }
      
      // Find next header or end of text
      const nextHeaderMatch = headerRegex.exec(text);
      const sectionEnd = nextHeaderMatch?.index ?? text.length;
      
      // Reset regex for next iteration
      headerRegex.lastIndex = match.index;
      
      const sectionContent = text.slice(match.index, sectionEnd).trim();
      sections.push({
        title: match[2]!.trim(),
        content: sectionContent,
        startPosition: match.index,
        endPosition: sectionEnd
      });
      
      lastIndex = sectionEnd;
    }
    
    // Add final section if no headers found or remaining content
    if (lastIndex < text.length || sections.length === 0) {
      const finalContent = text.slice(lastIndex).trim();
      if (finalContent.length > 0) {
        sections.push({
          content: finalContent,
          startPosition: lastIndex,
          endPosition: text.length
        });
      }
    }
    
    return sections;
  }
}