import OpenAI from 'openai';
import { BaseAIProvider } from './base.js';
import { Model } from '../types/provider.js';
import { ApiError } from '../utils/errors.js';

export class OpenAIProvider extends BaseAIProvider {
  name = 'openai';
  private client: OpenAI;

  constructor(apiKey: string) {
    super(apiKey);
    this.client = new OpenAI({ apiKey });
  }

  async listModels(): Promise<Model[]> {
    try {
      const response = await this.withRetry(() => this.client.models.list());
      
      return response.data
        .filter(model => 
          model.id.includes('embedding') || 
          model.id.includes('gpt') || 
          model.id.includes('text-davinci')
        )
        .map(model => {
          const modelData: Model = {
            id: model.id,
            name: model.id,
            type: this.getModelType(model.id),
          };
          
          const maxTokens = this.getMaxTokens(model.id);
          if (maxTokens !== undefined) {
            modelData.maxTokens = maxTokens;
          }
          
          const cost = this.getCostPer1kTokens(model.id);
          if (cost !== undefined) {
            modelData.costPer1kTokens = cost;
          }
          
          return modelData;
        });
    } catch (error) {
      throw new ApiError(`Failed to list OpenAI models: ${String(error)}`, this.name);
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const testClient = new OpenAI({ apiKey });
      await testClient.models.list();
      return true;
    } catch {
      return false;
    }
  }

  async generateEmbedding(text: string, model: string = 'text-embedding-3-small'): Promise<number[]> {
    this.validateText(text);

    try {
      const response = await this.withRetry(() =>
        this.client.embeddings.create({
          model,
          input: text,
        })
      );

      return response.data[0]?.embedding ?? [];
    } catch (error) {
      throw new ApiError(`Failed to generate embedding: ${String(error)}`, this.name);
    }
  }

  async batchGenerateEmbeddings(texts: string[], model: string = 'text-embedding-3-small'): Promise<number[][]> {
    this.validateBatchTexts(texts);

    try {
      const response = await this.withRetry(() =>
        this.client.embeddings.create({
          model,
          input: texts,
        })
      );

      return response.data.map(item => item.embedding);
    } catch (error) {
      throw new ApiError(`Failed to generate batch embeddings: ${String(error)}`, this.name);
    }
  }

  /**
   * Generate context using OpenAI chat completion with prompt caching support
   */
  async generateContext(document: string, chunk: string): Promise<string> {
    const prompt = `<document>
${document}
</document>
Here is the chunk we want to situate within the whole document
<chunk>
${chunk}
</chunk>
Please give a short succinct context to situate this chunk within the overall document for the purposes of improving 
search retrieval of the chunk. Answer only with the succinct context and nothing else. Use the original language of the 
text, and don't start the summary with something like 'This chunk contains...'. Go directly to the summary.`;

    try {
      const response = await this.withRetry(() =>
        this.client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 100,
          temperature: 0,
        })
      );

      return response.choices[0]?.message?.content?.trim() ?? '';
    } catch (error) {
      throw new ApiError(`Failed to generate context: ${String(error)}`, this.name);
    }
  }

  /**
   * Generate text using OpenAI chat completion with flexible options
   */
  async generateText(
    prompt: string,
    options?: {
      model?: string;
      maxTokens?: number;
      temperature?: number;
      user?: string;
    }
  ): Promise<{
    text: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    cached?: boolean;
  }> {
    const opts = {
      model: 'gpt-4o-mini',
      maxTokens: 500,
      temperature: 0.1,
      ...options,
    };

    try {
      const response = await this.withRetry(() =>
        this.client.chat.completions.create({
          model: opts.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: opts.maxTokens,
          temperature: opts.temperature,
          ...(opts.user && { user: opts.user }), // Include user param for caching if provided
        })
      );

      const result: {
        text: string;
        usage?: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        };
        cached?: boolean;
      } = {
        text: response.choices[0]?.message?.content?.trim() ?? '',
        cached: false,
      };

      if (response.usage) {
        result.usage = {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        };
      }

      return result;
    } catch (error) {
      throw new ApiError(`Failed to generate text: ${String(error)}`, this.name);
    }
  }

  /**
   * Generate context with caching optimization
   */
  async generateContextWithCache(
    documentPrefix: string,
    chunk: string,
    userParam: string
  ): Promise<string> {
    const fullPrompt = `${documentPrefix}<chunk>
${chunk}
</chunk>
Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.`;

    try {
      const response = await this.withRetry(() =>
        this.client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: fullPrompt }],
          max_tokens: 100,
          temperature: 0,
          user: userParam, // Important for cache routing
        })
      );

      return response.choices[0]?.message?.content?.trim() ?? '';
    } catch (error) {
      throw new ApiError(`Failed to generate context with cache: ${String(error)}`, this.name);
    }
  }

  private getModelType(modelId: string): 'embedding' | 'chat' | 'completion' {
    if (modelId.includes('embedding')) return 'embedding';
    if (modelId.includes('gpt')) return 'chat';
    return 'completion';
  }

  private getMaxTokens(modelId: string): number | undefined {
    const tokenLimits: Record<string, number> = {
      'gpt-4o': 128000,
      'gpt-4o-mini': 128000,
      'gpt-4': 8192,
      'gpt-3.5-turbo': 16385,
      'text-embedding-3-small': 8191,
      'text-embedding-3-large': 8191,
      'text-embedding-ada-002': 8191,
    };

    for (const [model, tokens] of Object.entries(tokenLimits)) {
      if (modelId.includes(model)) return tokens;
    }

    return undefined;
  }

  private getCostPer1kTokens(modelId: string): number | undefined {
    const costs: Record<string, number> = {
      'gpt-4o-mini': 0.15,
      'gpt-4o': 2.5,
      'gpt-3.5-turbo': 0.5,
      'text-embedding-3-small': 0.02,
      'text-embedding-3-large': 0.13,
      'text-embedding-ada-002': 0.1,
    };

    for (const [model, cost] of Object.entries(costs)) {
      if (modelId.includes(model)) return cost;
    }

    return undefined;
  }
}