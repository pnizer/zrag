import { AIProvider, Model } from '../types/provider.js';
import { ApiError } from '../utils/errors.js';

export abstract class BaseAIProvider implements AIProvider {
  abstract name: string;
  protected apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  abstract listModels(): Promise<Model[]>;
  abstract validateApiKey(apiKey: string): Promise<boolean>;
  abstract generateEmbedding(text: string, model?: string): Promise<number[]>;
  abstract batchGenerateEmbeddings(texts: string[], model?: string): Promise<number[][]>;

  /**
   * Handle API errors with retry logic
   */
  protected async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on authentication errors
        if (this.isAuthError(error)) {
          throw new ApiError(`Authentication failed: ${lastError.message}`, this.name);
        }

        // Don't retry on the last attempt
        if (attempt === maxRetries) {
          break;
        }

        // Exponential backoff
        const waitTime = delay * Math.pow(2, attempt - 1);
        await this.sleep(waitTime);
      }
    }

    throw new ApiError(`Operation failed after ${maxRetries} attempts: ${lastError!.message}`, this.name);
  }

  /**
   * Check if error is authentication related
   */
  protected isAuthError(error: unknown): boolean {
    const errorMessage = String(error).toLowerCase();
    return errorMessage.includes('unauthorized') || 
           errorMessage.includes('api key') || 
           errorMessage.includes('authentication');
  }

  /**
   * Check if error is rate limit related
   */
  protected isRateLimitError(error: unknown): boolean {
    const errorMessage = String(error).toLowerCase();
    return errorMessage.includes('rate limit') || 
           errorMessage.includes('too many requests');
  }

  /**
   * Sleep for specified milliseconds
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate text input for embedding generation
   */
  protected validateText(text: string): void {
    if (!text || text.trim().length === 0) {
      throw new ApiError('Text cannot be empty');
    }
    
    if (text.length > 100000) { // Reasonable limit
      throw new ApiError('Text is too long for processing');
    }
  }

  /**
   * Validate batch texts input
   */
  protected validateBatchTexts(texts: string[]): void {
    if (!texts || texts.length === 0) {
      throw new ApiError('Texts array cannot be empty');
    }

    if (texts.length > 100) { // Reasonable batch limit
      throw new ApiError('Too many texts in batch request');
    }

    texts.forEach((text, index) => {
      try {
        this.validateText(text);
      } catch (error) {
        throw new ApiError(`Invalid text at index ${index}: ${String(error)}`);
      }
    });
  }
}