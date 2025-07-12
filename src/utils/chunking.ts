export interface ChunkingOptions {
  strategy: 'character' | 'sentence' | 'paragraph';
  chunkSize: number;
  overlap: number;
}

export interface TextChunk {
  text: string;
  startPosition: number;
  endPosition: number;
  index: number;
}

export class TextChunker {
  private options: ChunkingOptions;

  constructor(options: ChunkingOptions) {
    this.options = options;
  }

  /**
   * Split text into chunks based on the configured strategy
   */
  chunk(text: string): TextChunk[] {
    const cleanedText = this.preprocessText(text);
    
    switch (this.options.strategy) {
      case 'character':
        return this.chunkByCharacter(cleanedText);
      case 'sentence':
        return this.chunkBySentence(cleanedText);
      case 'paragraph':
        return this.chunkByParagraph(cleanedText);
      default:
        throw new Error(`Unsupported chunking strategy: ${this.options.strategy}`);
    }
  }

  /**
   * Preprocess text to clean up whitespace and normalize
   */
  private preprocessText(text: string): string {
    return text
      // Normalize line endings
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // Remove excessive whitespace but preserve structure
      .replace(/[ \t]+/g, ' ')
      // Normalize multiple newlines to maximum of 2
      .replace(/\n{3,}/g, '\n\n')
      // Trim leading/trailing whitespace
      .trim();
  }

  /**
   * Chunk text by character count with overlap
   */
  private chunkByCharacter(text: string): TextChunk[] {
    const chunks: TextChunk[] = [];
    const { chunkSize, overlap } = this.options;
    
    let startPosition = 0;
    let chunkIndex = 0;
    
    while (startPosition < text.length) {
      const endPosition = Math.min(startPosition + chunkSize, text.length);
      const chunkText = text.slice(startPosition, endPosition);
      
      chunks.push({
        text: chunkText.trim(),
        startPosition,
        endPosition,
        index: chunkIndex++
      });
      
      // Move start position forward, accounting for overlap
      startPosition = Math.max(startPosition + chunkSize - overlap, startPosition + 1);
      
      // Avoid infinite loop if overlap is too large
      if (startPosition >= endPosition) {
        break;
      }
    }
    
    return chunks.filter(chunk => chunk.text.length > 0);
  }

  /**
   * Chunk text by sentences with overlap (simplified safe version)
   */
  private chunkBySentence(text: string): TextChunk[] {
    const sentences = this.splitIntoSentences(text);
    const chunks: TextChunk[] = [];
    
    let chunkIndex = 0;
    let i = 0;
    
    while (i < sentences.length) {
      let currentChunk = '';
      const startPos = sentences[i]!.startPosition;
      let endPos = startPos;
      
      // Build chunk by adding sentences until we hit the size limit
      while (i < sentences.length) {
        const sentence = sentences[i]!;
        const testChunk = currentChunk + (currentChunk ? ' ' : '') + sentence.text;
        
        if (testChunk.length > this.options.chunkSize && currentChunk.length > 0) {
          // Current chunk is full, break to create it
          break;
        }
        
        currentChunk = testChunk;
        endPos = sentence.endPosition;
        i++;
      }
      
      // Create the chunk
      if (currentChunk.trim().length > 0) {
        chunks.push({
          text: currentChunk.trim(),
          startPosition: startPos,
          endPosition: endPos,
          index: chunkIndex++
        });
        
        // Calculate overlap for next chunk
        if (i < sentences.length) {
          // Move back by approximately overlap amount, but safely
          const overlapChars = Math.min(this.options.overlap, Math.floor(currentChunk.length / 2));
          let backtrackChars = 0;
          let backtrackSentences = 0;
          
          // Count back until we have enough overlap or run out of sentences
          for (let j = i - 1; j >= 0 && backtrackChars < overlapChars; j--) {
            backtrackChars += sentences[j]!.text.length;
            backtrackSentences++;
          }
          
          // Move back by the calculated amount, but ensure we make progress
          i = Math.max(i - backtrackSentences, i - Math.floor(backtrackSentences / 2));
        }
      } else {
        // Safety: if somehow we get an empty chunk, just advance
        i++;
      }
    }
    
    return chunks;
  }

  /**
   * Split text into sentences with position tracking
   */
  private splitIntoSentences(text: string): Array<{ text: string; startPosition: number; endPosition: number }> {
    const sentences: Array<{ text: string; startPosition: number; endPosition: number }> = [];
    
    // Enhanced sentence boundary detection
    const sentenceRegex = /([.!?]+)\s+/g;
    let lastIndex = 0;
    let match;
    
    while ((match = sentenceRegex.exec(text)) !== null) {
      const endIndex = match.index + match[1]!.length;
      const sentenceText = text.slice(lastIndex, endIndex).trim();
      
      if (sentenceText.length > 0) {
        sentences.push({
          text: sentenceText,
          startPosition: lastIndex,
          endPosition: endIndex
        });
      }
      
      lastIndex = sentenceRegex.lastIndex;
    }
    
    // Add remaining text as final sentence
    if (lastIndex < text.length) {
      const remainingText = text.slice(lastIndex).trim();
      if (remainingText.length > 0) {
        sentences.push({
          text: remainingText,
          startPosition: lastIndex,
          endPosition: text.length
        });
      }
    }
    
    return sentences;
  }

  /**
   * Chunk text by paragraphs with overlap
   */
  private chunkByParagraph(text: string): TextChunk[] {
    const paragraphs = this.splitIntoParagraphs(text);
    const chunks: TextChunk[] = [];
    
    let currentChunk = '';
    let currentStartPos = 0;
    let chunkIndex = 0;
    let paragraphIndex = 0;
    
    while (paragraphIndex < paragraphs.length) {
      const paragraph = paragraphs[paragraphIndex];
      if (!paragraph) {
        paragraphIndex++;
        continue;
      }
      const testChunk = currentChunk + (currentChunk ? '\n\n' : '') + paragraph.text;
      
      // If adding this paragraph would exceed chunk size, finalize current chunk
      if (testChunk.length > this.options.chunkSize && currentChunk.length > 0) {
        const endPos = currentStartPos + currentChunk.length;
        
        chunks.push({
          text: currentChunk.trim(),
          startPosition: currentStartPos,
          endPosition: endPos,
          index: chunkIndex++
        });
        
        // Start new chunk with potential overlap
        if (this.options.overlap > 0 && paragraphIndex > 0) {
          const prevParagraph = paragraphs[paragraphIndex - 1];
          if (prevParagraph && prevParagraph.text.length <= this.options.overlap) {
            currentChunk = prevParagraph.text;
            currentStartPos = prevParagraph.startPosition;
          } else {
            currentChunk = '';
            currentStartPos = paragraph.startPosition;
          }
        } else {
          currentChunk = '';
          currentStartPos = paragraph.startPosition;
        }
      } else {
        // Add paragraph to current chunk
        currentChunk = testChunk;
        if (currentChunk === paragraph.text) {
          currentStartPos = paragraph.startPosition;
        }
        paragraphIndex++;
      }
    }
    
    // Add final chunk if there's remaining text
    if (currentChunk.trim().length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        startPosition: currentStartPos,
        endPosition: currentStartPos + currentChunk.length,
        index: chunkIndex
      });
    }
    
    return chunks;
  }

  /**
   * Split text into paragraphs with position tracking
   */
  private splitIntoParagraphs(text: string): Array<{ text: string; startPosition: number; endPosition: number }> {
    const paragraphs: Array<{ text: string; startPosition: number; endPosition: number }> = [];
    
    // Split by double newlines (paragraph breaks)
    const paragraphTexts = text.split(/\n\s*\n/);
    let currentPosition = 0;
    
    for (const paragraphText of paragraphTexts) {
      const trimmedText = paragraphText.trim();
      if (trimmedText.length > 0) {
        const startPosition = text.indexOf(trimmedText, currentPosition);
        const endPosition = startPosition + trimmedText.length;
        
        paragraphs.push({
          text: trimmedText,
          startPosition,
          endPosition
        });
        
        currentPosition = endPosition;
      }
    }
    
    return paragraphs;
  }

  /**
   * Validate chunking options
   */
  static validateOptions(options: ChunkingOptions): void {
    if (options.chunkSize <= 0) {
      throw new Error('Chunk size must be positive');
    }
    
    if (options.overlap < 0) {
      throw new Error('Overlap cannot be negative');
    }
    
    if (options.overlap >= options.chunkSize) {
      throw new Error('Overlap must be smaller than chunk size');
    }
    
    const validStrategies: ChunkingOptions['strategy'][] = ['character', 'sentence', 'paragraph'];
    if (!validStrategies.includes(options.strategy)) {
      throw new Error(`Invalid chunking strategy. Must be one of: ${validStrategies.join(', ')}`);
    }
  }
}