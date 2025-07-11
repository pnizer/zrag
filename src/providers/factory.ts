import { AIProvider } from '../types/provider.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { ConfigurationError } from '../utils/errors.js';

export type ProviderName = 'openai' | 'anthropic';

export class ProviderFactory {
  /**
   * Create an AI provider instance
   */
  static createProvider(name: ProviderName, apiKey: string): AIProvider {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new ConfigurationError(`API key is required for ${name} provider`);
    }

    switch (name) {
      case 'openai':
        return new OpenAIProvider(apiKey);
      case 'anthropic':
        return new AnthropicProvider(apiKey);
      default:
        throw new ConfigurationError(`Unsupported provider: ${name}`);
    }
  }

  /**
   * Get list of supported providers
   */
  static getSupportedProviders(): ProviderName[] {
    return ['openai', 'anthropic'];
  }

  /**
   * Validate provider name
   */
  static isValidProvider(name: string): name is ProviderName {
    return this.getSupportedProviders().includes(name as ProviderName);
  }

  /**
   * Create multiple providers from configuration
   */
  static createProvidersFromConfig(config: {
    openai?: { apiKey: string };
    anthropic?: { apiKey: string };
  }): Map<ProviderName, AIProvider> {
    const providers = new Map<ProviderName, AIProvider>();

    if (config.openai?.apiKey) {
      providers.set('openai', this.createProvider('openai', config.openai.apiKey));
    }

    if (config.anthropic?.apiKey) {
      providers.set('anthropic', this.createProvider('anthropic', config.anthropic.apiKey));
    }

    if (providers.size === 0) {
      throw new ConfigurationError('At least one provider must be configured');
    }

    return providers;
  }

  /**
   * Get the primary provider based on configuration
   */
  static getPrimaryProvider(
    providers: Map<ProviderName, AIProvider>,
    preferredProvider?: ProviderName
  ): AIProvider {
    if (preferredProvider && providers.has(preferredProvider)) {
      return providers.get(preferredProvider)!;
    }

    // Fallback order: OpenAI first, then Anthropic
    if (providers.has('openai')) {
      return providers.get('openai')!;
    }

    if (providers.has('anthropic')) {
      return providers.get('anthropic')!;
    }

    throw new ConfigurationError('No providers available');
  }
}