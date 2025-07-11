import { Command } from 'commander';
import { ConfigManager } from './utils/config.js';

const program = new Command();

program
  .name('rag-tool')
  .description('TypeScript-based RAG tool with contextual retrieval')
  .version('0.1.0');

// Init command placeholder
program
  .command('init')
  .description('Initialize RAG tool configuration')
  .option('--config-path <path>', 'Custom configuration path')
  .action(async (options) => {
    try {
      const configManager = new ConfigManager(options.configPath);
      
      if (await configManager.exists()) {
        console.log('✓ Configuration already exists at:', configManager.getConfigPath());
        return;
      }

      console.log('🚀 Initializing RAG tool...');
      console.log('📁 Configuration directory:', configManager.getConfigDir());
      console.log('⚙️  Configuration file:', configManager.getConfigPath());
      console.log('💾 Database file:', configManager.getDatabasePath());
      
      // For now, just create the directory
      await configManager.ensureConfigDir();
      console.log('✓ Configuration directory created');
      console.log('');
      console.log('Next steps:');
      console.log('1. Set up your API keys');
      console.log('2. Run "rag-tool db-init" to initialize the database');
      console.log('3. Start adding documents with "rag-tool add <file>"');
      
    } catch (error) {
      console.error('❌ Initialization failed:', String(error));
      process.exit(1);
    }
  });

// Test command for configuration
program
  .command('config')
  .description('Show configuration information')
  .option('--config-path <path>', 'Custom configuration path')
  .action(async (options) => {
    try {
      const configManager = new ConfigManager(options.configPath);
      
      console.log('Configuration Information:');
      console.log('📁 Config directory:', configManager.getConfigDir());
      console.log('⚙️  Config file:', configManager.getConfigPath());
      console.log('💾 Database file:', configManager.getDatabasePath());
      console.log('📋 Config exists:', await configManager.exists());
      
    } catch (error) {
      console.error('❌ Failed to show config:', String(error));
      process.exit(1);
    }
  });

// Placeholder commands for other functionality
program
  .command('db-init')
  .description('Initialize the database')
  .action(() => {
    console.log('🚧 Database initialization not implemented yet');
  });

program
  .command('add <file>')
  .description('Add a document to the knowledge base')
  .action((file) => {
    console.log(`🚧 Document addition not implemented yet: ${file}`);
  });

program
  .command('search <query>')
  .description('Search through documents')
  .action((query) => {
    console.log(`🚧 Search not implemented yet: ${query}`);
  });

program
  .command('server')
  .description('Start MCP server')
  .action(() => {
    console.log('🚧 MCP server not implemented yet');
  });

// Error handling
program.exitOverride();

try {
  program.parse();
} catch (error) {
  console.error('❌ Command failed:', String(error));
  process.exit(1);
}