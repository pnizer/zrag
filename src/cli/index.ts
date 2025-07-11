#!/usr/bin/env node
import { Command } from 'commander';
import { createInitCommand } from './commands/init.js';
import { createDbInitCommand } from './commands/db-init.js';

const program = new Command();

program
  .name('rag-tool')
  .description('TypeScript-based RAG tool implementing Anthropic\'s contextual retrieval methodology')
  .version('0.1.0');

// Add commands
program.addCommand(createInitCommand());
program.addCommand(createDbInitCommand());

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