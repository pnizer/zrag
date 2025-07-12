#!/usr/bin/env node
import { Command } from 'commander';
import { createInitCommand } from './commands/init.js';
import { createDbInitCommand } from './commands/db-init.js';
import { createAddCommand } from './commands/add.js';
import { createSearchCommand } from './commands/search.js';

const program = new Command();

program
  .name('rag-tool')
  .description('TypeScript-based RAG tool implementing Anthropic\'s contextual retrieval methodology')
  .version('0.1.0');

// Add commands
program.addCommand(createInitCommand());
program.addCommand(createDbInitCommand());
program.addCommand(createAddCommand());
program.addCommand(createSearchCommand());

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