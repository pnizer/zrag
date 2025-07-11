import { BaseAIProvider } from './base.js';
import { Model } from '../types/provider.js';
import { ApiError } from '../utils/errors.js';

export class AnthropicProvider extends BaseAIProvider {
  name = 'anthropic';

  constructor(apiKey: string) {
    super(apiKey);
  }

  async listModels(): Promise<Model[]> {
    // Anthropic doesn't have a models endpoint, return known models
    return [
      {
        id: 'claude-3-haiku-20240307',
        name: 'Claude 3 Haiku',
        type: 'chat',
        maxTokens: 200000,
        costPer1kTokens: 0.25,
      },
      {
        id: 'claude-3-sonnet-20240229',
        name: 'Claude 3 Sonnet',
        type: 'chat',
        maxTokens: 200000,
        costPer1kTokens: 3.0,
      },
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        type: 'chat',
        maxTokens: 200000,
        costPer1kTokens: 15.0,
      },
    ];
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    // For now, just check if the key is provided
    // In a real implementation, we'd make a test API call
    return typeof apiKey === 'string' && apiKey.length > 0;
  }

  async generateEmbedding(): Promise<number[]> {
    throw new ApiError('Anthropic does not provide embedding models', this.name);
  }

  async batchGenerateEmbeddings(): Promise<number[][]> {
    throw new ApiError('Anthropic does not provide embedding models', this.name);
  }

  /**
   * Generate context using Anthropic Claude
   * Note: This is a placeholder implementation
   */
  async generateContext(_document: string, _chunk: string): Promise<string> {
    // This would require implementing the Anthropic API client
    // For now, we'll throw an error since we're using OpenAI as primary
    throw new ApiError('Anthropic context generation not implemented yet', this.name);
  }
}