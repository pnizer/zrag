# RAG Tool - Claude Code Context

## Development Commands

```bash
# Build the project (TypeScript compilation + bundling)
npm run build

# Development mode with file watching
npm run dev

# Run tests (when implemented)
npm test

# Lint TypeScript code
npm run lint

# Format code with Prettier
npm run format
```

## High-Level Architecture

This is a **Retrieval-Augmented Generation (RAG) tool** implementing Anthropic's contextual retrieval methodology, delivering 35% accuracy improvements through enhanced context generation.

### Core Design Principles

**Dual Interface Strategy**: The application provides both CLI and MCP (Model Context Protocol) server interfaces, allowing integration with Claude Desktop and other AI applications.

**Processing Pipeline**: Documents flow through a multi-stage pipeline:
1. **Ingestion** (`DocumentService`) - File validation, content extraction, deduplication
2. **Chunking** (`TextChunker`) - Intelligent text segmentation with overlap strategies
3. **Contextualization** - Enhanced chunk context using Anthropic's methodology
4. **Embedding** - OpenAI API integration for vector representations
5. **Storage** - SQLite with planned vector extension support

### Key Technical Components

**Storage Layer** (`DatabaseService`):
- SQLite with WAL mode for concurrency
- Schema supports processing state tracking
- Future vector search via sqlite-vss extension
- Foreign key constraints for data integrity

**Document Processing** (`DocumentService`):
- Content hash-based deduplication
- Support for .txt, .md, .markdown formats
- Chunking strategies: character, sentence, paragraph
- Comprehensive processing status tracking

**Text Processing** (`TextProcessor`):
- Unicode normalization and cleaning
- Markdown-to-text extraction
- Token estimation and truncation
- Content validation and metadata extraction

**Configuration** (`RagConfigSchema`):
- Zod-based schema validation
- OpenAI API integration configuration
- Extensible provider system architecture

### Distribution Strategy

**Cross-Platform Bundling**: Uses esbuild to create standalone executables with shebang headers for Unix systems. Distribution via npm with npx execution pattern.

**Type Safety**: Strict TypeScript configuration with comprehensive error handling using custom error classes (`FileError`, `ValidationError`, `DatabaseError`).

## Project Structure

```
src/
├── cli/           # Command-line interface
├── mcp/           # Model Context Protocol server
├── services/      # Core business logic (database, document processing)
├── utils/         # Utilities (chunking, text processing, errors)
├── types/         # TypeScript type definitions
└── providers/     # External service integrations (OpenAI)
```

## Implementation Status

- ✅ **Phase 1**: Project setup, basic CLI, database schema
- 🔄 **Phase 2**: Core services (DocumentService, chunking, text processing)
- ⏳ **Phase 3**: Context generation and OpenAI integration
- ⏳ **Phase 4**: MCP server implementation
- ⏳ **Phase 5**: Vector search and optimization

## Key Files to Understand

- `src/services/document.ts` - Central document processing orchestration
- `src/utils/chunking.ts` - Text segmentation algorithms
- `src/services/database.ts` - Data persistence and retrieval
- `src/types/document.ts` - Core data model definitions
- `IMPLEMENTATION_PLAN.md` - Detailed project roadmap

## Development Notes

**Always compile and test before finishing tasks**: Run `npm run build` and `npm test` to ensure code quality.

**Database Initialization**: Database auto-creates in `~/.rag-tool/database.db` with proper foreign key constraints and indexing.

**Error Handling**: Uses typed error classes for different failure modes - essential for debugging processing pipeline issues.