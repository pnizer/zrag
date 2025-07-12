import { z } from 'zod';

export const RagConfigSchema = z.object({
  version: z.string().default('0.1.0'),
  providers: z.object({
    openai: z.object({
      apiKey: z.string(),
      embeddingModel: z.string().default('text-embedding-3-small'),
      contextModel: z.string().default('gpt-4o-mini'),
      maxTokens: z.number().default(4000),
    }).optional(),
    anthropic: z.object({
      apiKey: z.string(),
      model: z.string().default('claude-3-haiku-20240307'),
      maxTokens: z.number().default(4000),
    }).optional(),
  }),
  database: z.object({
    path: z.string(),
    vectorDimension: z.number().default(1536),
  }),
  chunking: z.object({
    strategy: z.enum(['character', 'sentence', 'paragraph']).default('sentence'),
    chunkSize: z.number().default(1000),
    overlap: z.number().default(200),
  }),
  contextGeneration: z.object({
    provider: z.enum(['openai', 'anthropic']).default('openai'),
    maxContextTokens: z.number().default(100),
    prompt: z.string().default(`<document>
{documentContent}
</document>
Here is the chunk we want to situate within the whole document
<chunk>
{chunkText}
</chunk>
Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.`),
  }),
  processing: z.object({
    maxParallelChunks: z.number().min(1).max(20).default(5),
    enableLinearProcessing: z.boolean().default(true),
  }).optional(),
});

export type RagConfig = z.infer<typeof RagConfigSchema>;

export const DefaultConfig: Partial<RagConfig> = {
  version: '0.1.0',
  chunking: {
    strategy: 'sentence',
    chunkSize: 1000,
    overlap: 200,
  },
  contextGeneration: {
    provider: 'openai',
    maxContextTokens: 100,
    prompt: `<document>
{documentContent}
</document>
Here is the chunk we want to situate within the whole document
<chunk>
{chunkText}
</chunk>
Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.`,
  },
  database: {
    path: '', // Will be set dynamically by ConfigManager
    vectorDimension: 1536,
  },
  processing: {
    maxParallelChunks: 5,
    enableLinearProcessing: true,
  },
};