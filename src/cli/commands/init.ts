import { Command } from 'commander';
import { ConfigManager } from '../../utils/config.js';
import { OpenAIProvider } from '../../providers/openai.js';
import { AnthropicProvider } from '../../providers/anthropic.js';
import { ProgressIndicator } from '../utils/progress.js';
import { promptUser, promptSecure, promptConfirm, promptChoice } from '../utils/input.js';
import { validateApiKey, formatValidationError } from '../utils/validation.js';

export function createInitCommand(): Command {
  return new Command('init')
    .description('Initialize RAG tool configuration with interactive setup')
    .option('--config-path <path>', 'Path to configuration file')
    .option('--force', 'Overwrite existing configuration')
    .action(async (options) => {
      try {
        await initializeConfiguration(options);
      } catch (error) {
        console.error(formatValidationError(error));
        process.exit(1);
      }
    });
}

async function initializeConfiguration(options: { configPath?: string; force?: boolean }): Promise<void> {
  console.log('🚀 RAG Tool Configuration Setup');
  console.log('');

  const configManager = new ConfigManager(options.configPath);

  // Check if configuration already exists
  if (configManager.exists() && !options.force) {
    const overwrite = await promptConfirm(
      'Configuration already exists. Do you want to overwrite it?',
      false
    );
    
    if (!overwrite) {
      console.log('Configuration setup cancelled.');
      return;
    }
  }

  console.log('This wizard will help you set up your RAG tool configuration.');
  console.log('You\'ll need API keys for the AI providers you want to use.');
  console.log('');

  // Provider selection
  const providers = await selectProviders();
  const config: any = {
    version: '0.1.0',
    providers: {},
    database: {
      path: configManager.getDefaultDatabasePath(),
      vectorDimension: 1536, // OpenAI text-embedding-3-small
    },
    chunking: {
      strategy: 'sentence',
      chunkSize: 1000,
      overlap: 200,
    },
    contextGeneration: {
      provider: 'openai',
      maxContextTokens: 500,
    },
  };

  // Configure OpenAI
  if (providers.includes('openai')) {
    console.log('📋 OpenAI Configuration');
    config.providers.openai = await configureOpenAI();
    console.log('');
  }

  // Configure Anthropic
  if (providers.includes('anthropic')) {
    console.log('📋 Anthropic Configuration');
    config.providers.anthropic = await configureAnthropic();
    console.log('');
  }

  // Chunking configuration
  console.log('📋 Document Processing Configuration');
  const chunkingConfig = await configureChunking();
  config.chunking = { ...config.chunking, ...chunkingConfig };
  console.log('');

  // Context generation configuration
  console.log('📋 Context Generation Configuration');
  const contextConfig = await configureContextGeneration(providers);
  config.contextGeneration = { ...config.contextGeneration, ...contextConfig };
  console.log('');

  // Save configuration
  const progress = new ProgressIndicator('Saving configuration...');
  progress.start();

  try {
    configManager.save(config);
    progress.stop('Configuration saved successfully!');
  } catch (error) {
    progress.fail('Failed to save configuration');
    throw error;
  }

  // Test configuration
  console.log('');
  const testConfig = await promptConfirm('Would you like to test the configuration?', true);
  
  if (testConfig) {
    await testConfiguration(config);
  }

  console.log('');
  console.log('✅ Setup complete!');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Initialize the database: rag-tool db-init');
  console.log('  2. Add a document: rag-tool add <file>');
  console.log('  3. Search documents: rag-tool search "<query>"');
  console.log('');
}

async function selectProviders(): Promise<string[]> {
  const choices = [
    { label: 'OpenAI only (Recommended)', value: ['openai'], description: 'Embeddings + Context generation' },
    { label: 'OpenAI + Anthropic', value: ['openai', 'anthropic'], description: 'More options but requires both API keys' },
    { label: 'OpenAI only (Basic)', value: ['openai'], description: 'Just embeddings, no context generation' },
  ];

  return await promptChoice(
    '🔧 Which AI providers would you like to configure?',
    choices,
    0
  );
}

async function configureOpenAI(): Promise<object> {
  let apiKey: string;
  let isValid = false;

  while (!isValid) {
    apiKey = await promptSecure('Enter your OpenAI API key: ');
    
    try {
      validateApiKey(apiKey, 'openai');
      
      // Test the API key
      const progress = new ProgressIndicator('Validating OpenAI API key...');
      progress.start();
      
      const provider = new OpenAIProvider(apiKey);
      const valid = await provider.validateApiKey(apiKey);
      
      if (valid) {
        progress.stop('OpenAI API key is valid!');
        isValid = true;
      } else {
        progress.fail('Invalid OpenAI API key');
        const retry = await promptConfirm('Would you like to try again?', true);
        if (!retry) {
          throw new Error('OpenAI configuration cancelled');
        }
      }
    } catch (error) {
      console.log(formatValidationError(error));
      const retry = await promptConfirm('Would you like to try again?', true);
      if (!retry) {
        throw new Error('OpenAI configuration cancelled');
      }
    }
  }

  // Select embedding model
  const embeddingModels = [
    { label: 'text-embedding-3-small (Recommended)', value: 'text-embedding-3-small', description: 'Cost-effective, good performance' },
    { label: 'text-embedding-3-large', value: 'text-embedding-3-large', description: 'Higher performance, more expensive' },
    { label: 'text-embedding-ada-002', value: 'text-embedding-ada-002', description: 'Legacy model' },
  ];

  const embeddingModel = await promptChoice(
    'Select embedding model:',
    embeddingModels,
    0
  );

  return {
    apiKey: apiKey!,
    embeddingModel,
    maxTokens: 4000,
  };
}

async function configureAnthropic(): Promise<object> {
  let apiKey: string;
  let isValid = false;

  while (!isValid) {
    apiKey = await promptSecure('Enter your Anthropic API key: ');
    
    try {
      validateApiKey(apiKey, 'anthropic');
      
      // Test the API key
      const progress = new ProgressIndicator('Validating Anthropic API key...');
      progress.start();
      
      const provider = new AnthropicProvider(apiKey);
      const valid = await provider.validateApiKey(apiKey);
      
      if (valid) {
        progress.stop('Anthropic API key is valid!');
        isValid = true;
      } else {
        progress.fail('Invalid Anthropic API key');
        const retry = await promptConfirm('Would you like to try again?', true);
        if (!retry) {
          throw new Error('Anthropic configuration cancelled');
        }
      }
    } catch (error) {
      console.log(formatValidationError(error));
      const retry = await promptConfirm('Would you like to try again?', true);
      if (!retry) {
        throw new Error('Anthropic configuration cancelled');
      }
    }
  }

  return {
    apiKey: apiKey!,
    model: 'claude-3-haiku-20240307',
    maxTokens: 4000,
  };
}

async function configureChunking(): Promise<object> {
  const strategies = [
    { label: 'Sentence-based (Recommended)', value: 'sentence', description: 'Natural language boundaries' },
    { label: 'Paragraph-based', value: 'paragraph', description: 'Semantic groupings' },
    { label: 'Character-based', value: 'character', description: 'Fixed character lengths' },
  ];

  const strategy = await promptChoice(
    'Select chunking strategy:',
    strategies,
    0
  );

  const chunkSizeDefault = strategy === 'sentence' ? 1000 : strategy === 'paragraph' ? 1500 : 800;
  const overlapDefault = Math.floor(chunkSizeDefault * 0.2);

  let chunkSize: number = chunkSizeDefault;
  let chunkSizeInput = '';
  do {
    chunkSizeInput = await promptUser(`Chunk size (${chunkSizeDefault}): `);
    if (chunkSizeInput === '') {
      chunkSize = chunkSizeDefault;
      break;
    }
    const parsed = parseInt(chunkSizeInput);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 10000) {
      chunkSize = parsed;
      break;
    }
    console.log('Please enter a number between 1 and 10000');
  } while (chunkSizeInput !== '');

  let overlap: number = overlapDefault;
  let overlapInput = '';
  do {
    overlapInput = await promptUser(`Overlap size (${overlapDefault}): `);
    if (overlapInput === '') {
      overlap = overlapDefault;
      break;
    }
    const parsed = parseInt(overlapInput);
    if (!isNaN(parsed) && parsed >= 0 && parsed < chunkSize) {
      overlap = parsed;
      break;
    }
    console.log(`Please enter a number between 0 and ${chunkSize - 1}`);
  } while (overlapInput !== '');

  return {
    strategy,
    chunkSize,
    overlap,
  };
}

async function configureContextGeneration(providers: string[]): Promise<object> {
  if (!providers.includes('openai') && !providers.includes('anthropic')) {
    return { provider: 'openai', maxContextTokens: 500 };
  }

  const availableProviders = [
    ...(providers.includes('openai') ? [{ label: 'OpenAI GPT-4o-mini (Recommended)', value: 'openai', description: 'Cost-effective with caching' }] : []),
    ...(providers.includes('anthropic') ? [{ label: 'Anthropic Claude', value: 'anthropic', description: 'High quality context generation' }] : []),
  ];

  if (availableProviders.length === 1) {
    return { provider: availableProviders[0]!.value, maxContextTokens: 500 };
  }

  const provider = await promptChoice(
    'Select provider for context generation:',
    availableProviders,
    0
  );

  let maxTokens: number = 500;
  let maxTokensInput = '';
  do {
    maxTokensInput = await promptUser('Max tokens for context generation (500): ');
    if (maxTokensInput === '') {
      maxTokens = 500;
      break;
    }
    const parsed = parseInt(maxTokensInput);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 2000) {
      maxTokens = parsed;
      break;
    }
    console.log('Please enter a number between 1 and 2000');
  } while (maxTokensInput !== '');

  return {
    provider,
    maxContextTokens: maxTokens,
  };
}

async function testConfiguration(config: any): Promise<void> {
  console.log('🧪 Testing configuration...');
  console.log('');

  // Test OpenAI if configured
  if (config.providers.openai) {
    const progress = new ProgressIndicator('Testing OpenAI connection...');
    progress.start();

    try {
      const provider = new OpenAIProvider(config.providers.openai.apiKey);
      const models = await provider.listModels();
      progress.stop(`OpenAI: Found ${models.length} available models`);
    } catch (error) {
      progress.fail('OpenAI connection failed');
      console.log(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Test Anthropic if configured
  if (config.providers.anthropic) {
    const progress = new ProgressIndicator('Testing Anthropic connection...');
    progress.start();

    try {
      const provider = new AnthropicProvider(config.providers.anthropic.apiKey);
      const valid = await provider.validateApiKey(config.providers.anthropic.apiKey);
      if (valid) {
        progress.stop('Anthropic: Connection successful');
      } else {
        progress.fail('Anthropic: API key validation failed');
      }
    } catch (error) {
      progress.fail('Anthropic connection failed');
      console.log(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('');
}