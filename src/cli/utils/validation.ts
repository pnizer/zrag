import { ValidationError } from '../../utils/errors.js';

export function validateApiKey(apiKey: string, provider: string): void {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new ValidationError(`${provider} API key cannot be empty`);
  }

  // Basic format validation
  switch (provider.toLowerCase()) {
    case 'openai':
      if (!apiKey.startsWith('sk-')) {
        throw new ValidationError('OpenAI API key should start with "sk-"');
      }
      if (apiKey.length < 20) {
        throw new ValidationError('OpenAI API key appears to be too short');
      }
      break;
    case 'anthropic':
      if (!apiKey.startsWith('sk-ant-')) {
        throw new ValidationError('Anthropic API key should start with "sk-ant-"');
      }
      if (apiKey.length < 20) {
        throw new ValidationError('Anthropic API key appears to be too short');
      }
      break;
  }
}

export function validateFilePath(filePath: string): void {
  if (!filePath || filePath.trim().length === 0) {
    throw new ValidationError('File path cannot be empty');
  }

  // Check for dangerous patterns
  if (filePath.includes('..')) {
    throw new ValidationError('File path cannot contain ".." (directory traversal)');
  }

  if (filePath.startsWith('/etc/') || filePath.startsWith('/proc/') || filePath.startsWith('/sys/')) {
    throw new ValidationError('Cannot access system directories');
  }
}

export function validateChunkingOptions(options: {
  strategy?: string;
  chunkSize?: number;
  overlap?: number;
}): void {
  const validStrategies = ['character', 'sentence', 'paragraph'];
  
  if (options.strategy && !validStrategies.includes(options.strategy)) {
    throw new ValidationError(`Invalid chunking strategy. Must be one of: ${validStrategies.join(', ')}`);
  }

  if (options.chunkSize !== undefined) {
    if (!Number.isInteger(options.chunkSize) || options.chunkSize <= 0) {
      throw new ValidationError('Chunk size must be a positive integer');
    }
    if (options.chunkSize > 10000) {
      throw new ValidationError('Chunk size is too large (max: 10000)');
    }
  }

  if (options.overlap !== undefined) {
    if (!Number.isInteger(options.overlap) || options.overlap < 0) {
      throw new ValidationError('Overlap must be a non-negative integer');
    }
    if (options.chunkSize && options.overlap >= options.chunkSize) {
      throw new ValidationError('Overlap must be smaller than chunk size');
    }
  }
}

export function formatValidationError(error: unknown): string {
  if (error instanceof ValidationError) {
    return `❌ Validation Error: ${error.message}`;
  }
  
  if (error instanceof Error) {
    return `❌ Error: ${error.message}`;
  }
  
  return `❌ Unknown error: ${String(error)}`;
}

export function validateQueryString(query: string): void {
  if (!query || query.trim().length === 0) {
    throw new ValidationError('Search query cannot be empty');
  }

  if (query.trim().length > 1000) {
    throw new ValidationError('Search query is too long (max: 1000 characters)');
  }
}

export function validateSearchOptions(options: {
  limit?: number;
  threshold?: number;
}): void {
  if (options.limit !== undefined) {
    if (!Number.isInteger(options.limit) || options.limit <= 0) {
      throw new ValidationError('Limit must be a positive integer');
    }
    if (options.limit > 100) {
      throw new ValidationError('Limit is too large (max: 100)');
    }
  }

  if (options.threshold !== undefined) {
    if (typeof options.threshold !== 'number' || options.threshold < 0 || options.threshold > 1) {
      throw new ValidationError('Threshold must be a number between 0 and 1');
    }
  }
}