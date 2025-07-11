export class RagToolError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'RagToolError';
  }
}

export class ConfigurationError extends RagToolError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigurationError';
  }
}

export class DatabaseError extends RagToolError {
  constructor(message: string) {
    super(message, 'DATABASE_ERROR');
    this.name = 'DatabaseError';
  }
}

export class ApiError extends RagToolError {
  constructor(message: string, public provider?: string) {
    super(message, 'API_ERROR');
    this.name = 'ApiError';
  }
}

export class ValidationError extends RagToolError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class FileError extends RagToolError {
  constructor(message: string) {
    super(message, 'FILE_ERROR');
    this.name = 'FileError';
  }
}