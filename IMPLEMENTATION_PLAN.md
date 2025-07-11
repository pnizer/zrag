# RAG Tool Implementation Plan

## Project Overview

This document outlines the complete implementation plan for a TypeScript-based RAG (Retrieval-Augmented Generation) tool that implements Anthropic's contextual retrieval methodology. The tool will feature both CLI functionality and MCP (Model Context Protocol) server capabilities.

### Core Objectives

1. **Contextual Retrieval**: Implement Anthropic's contextual retrieval approach to improve search accuracy by 35%
2. **Modular AI Providers**: Support multiple AI providers (OpenAI, Anthropic) with easy extensibility
3. **Local Vector Storage**: Use SQLite with vector extensions for embedded, portable storage
4. **Dual Interface**: Provide both CLI tools and MCP server for integration with Claude Code
5. **Text Document Focus**: Initially support text documents (.txt, .md) with room for expansion

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐
│   CLI Interface │    │   MCP Server    │
└─────────┬───────┘    └─────────┬───────┘
          │                      │
          └──────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │    Core Services      │
         │                       │
         │ • DocumentService     │
         │ • ContextService      │
         │ • EmbeddingService    │
         │ • SearchService       │
         │ • DatabaseService     │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │   AI Provider Layer   │
         │                       │
         │ • OpenAI Provider     │
         │ • Anthropic Provider  │
         │ • Provider Interface  │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │   SQLite Database     │
         │   with Vector Ext.    │
         └───────────────────────┘
```

## Technology Stack

### Core Dependencies
- **Runtime**: Node.js 18+ with TypeScript
- **Package Manager**: npm (for npx distribution)
- **Database**: SQLite with bundled sqlite-vss extension for vector operations
- **AI APIs**: OpenAI API (embeddings and context generation)
- **CLI Framework**: Commander.js for command-line interface
- **MCP Integration**: @modelcontextprotocol/sdk for server implementation
- **Database Access**: better-sqlite3 for SQLite operations
- **Validation**: Zod for input validation and type safety

### Development Dependencies
- **Build Tools**: TypeScript compiler, esbuild for bundling
- **Testing**: Jest for unit testing
- **Code Quality**: ESLint, Prettier for code formatting
- **Type Safety**: Strict TypeScript configuration

### Distribution Strategy
- **Package Manager**: npm for publication
- **Usage**: npx rag-tool commands (no global installation required)
- **Build**: Single bundled CLI with embedded dependencies
- **Platform Support**: Cross-platform with bundled native extensions

### Configuration and Storage
- **Default Location**: User home directory (`~/.rag-tool/`) for cross-platform compatibility
- **Override Options**: 
  - `RAG_CONFIG_PATH` environment variable
  - `--config-path` CLI parameter
- **Files**:
  - `config.json` - User configuration and API keys
  - `database.db` - SQLite database with embeddings
- **Cross-platform Support**: Uses Node.js `os.homedir()` for reliable home directory detection
- **Co-location**: Configuration and database stored in same directory for portability

### Default AI Models
- **Embedding Model**: `text-embedding-3-small` (OpenAI) - Cost-effective with good performance
- **Context Generation**: `gpt-4o-mini` (OpenAI) - Very cost-effective for context summarization
- **Fallback Strategy**: Automatic fallback to alternative models if primary unavailable
- **Single Provider**: Simplified setup using OpenAI for both embedding and context generation

## Implementation Phases

### Phase 1: Project Foundation (Days 1-2)

#### 1.1 Project Setup
- Initialize TypeScript Node.js project with npm
- Configure package.json with dependencies and npx-compatible bin entry
- Set up TypeScript configuration with strict mode
- Create project directory structure
- Configure build scripts for esbuild bundling with platform-specific sqlite-vss binaries
- Set up prepublishOnly script for automated building

#### 1.2 Configuration System
- Design configuration schema for API keys and settings
- Implement cross-platform configuration path resolution (user home directory default)
- Add RAG_CONFIG_PATH environment variable and --config-path CLI option support
- Create configuration persistence layer with proper directory creation
- Add validation for configuration values

#### 1.3 AI Provider Abstraction
- Define AIProvider interface
- Implement OpenAI provider with model listing and embeddings
- Implement Anthropic provider for context generation
- Create provider factory and registration system

### Phase 2: Core Services (Days 3-4)

#### 2.1 Database Layer
- Set up SQLite with bundled sqlite-vss extension (cross-platform binaries)
- Implement platform detection and binary loading for vector extensions
- Define database schema for documents, chunks, and embeddings
- Implement DatabaseService with CRUD operations
- Add vector similarity search functions
- Create database migration system

#### 2.2 Document Processing
- Implement DocumentService for file loading
- Create chunking strategies (character-based, sentence-based)
- Add text preprocessing and cleaning utilities
- Implement overlap handling for chunks

#### 2.3 Contextual Retrieval Engine
- Implement ContextService using OpenAI GPT-4o-mini for cost efficiency
- Use Anthropic's official contextual retrieval prompt template
- Implement OpenAI prompt caching for cost optimization (up to 75% savings)
- Add batch processing for multiple chunks with shared document context
- Implement error handling and retry logic

#### 2.4 Embedding System
- Implement EmbeddingService with OpenAI integration
- Add support for different embedding models
- Create embedding storage and retrieval
- Implement batch embedding processing

### Phase 3: CLI Implementation (Days 5-6)

#### 3.1 Command Structure
- Implement `rag init` command for project initialization
- Create `rag db-init` for database setup
- Add `rag add <file>` for document ingestion
- Implement `rag search <query>` for testing searches
- Add `rag server` to start MCP server

#### 3.2 User Experience
- Add progress indicators for long-running operations
- Implement comprehensive error messages
- Create help documentation for each command
- Add configuration validation and troubleshooting

#### 3.3 Interactive Setup
- Implement API key collection with secure input
- Add model selection after fetching available models
- Create configuration validation and testing
- Add setup completion confirmation

### Phase 4: MCP Server Integration (Days 7-8)

#### 4.1 Server Implementation
- Set up MCP server with TypeScript SDK
- Implement server initialization and transport
- Add proper error handling and logging
- Create server lifecycle management

#### 4.2 Tool Registration
- Implement `search_documents` tool for semantic search
- Add `add_document` tool for document ingestion
- Create `list_documents` tool for document management
- Implement input validation with Zod schemas

#### 4.3 Resource Management
- Create document content resources
- Implement search result resources
- Add metadata and status resources
- Create resource URI templates

### Phase 5: Testing and Optimization (Days 9-10)

#### 5.1 Unit Testing
- Write tests for core services
- Test AI provider implementations
- Validate database operations
- Test CLI command functionality

#### 5.2 Integration Testing
- Test end-to-end document processing
- Validate MCP server functionality
- Test error handling scenarios
- Validate configuration management

#### 5.3 Performance Optimization
- Optimize chunking strategies
- Implement embedding caching
- Optimize database queries
- Add performance monitoring

## Detailed Technical Specifications

### Database Schema

```sql
-- Documents table with processing status tracking
CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    total_chunks INTEGER NOT NULL,
    processed_chunks INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'complete', 'failed'
    last_error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Chunks table with detailed processing status
CREATE TABLE chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    original_text TEXT NOT NULL,
    contextualized_text TEXT,
    start_position INTEGER NOT NULL,
    end_position INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'contextualized', 'embedded', 'complete', 'failed'
    error_message TEXT,
    processing_step TEXT, -- 'chunking', 'context_generation', 'embedding', 'storage'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

-- Embeddings table with vector support
CREATE TABLE embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_id INTEGER NOT NULL,
    embedding BLOB NOT NULL,
    model_used TEXT NOT NULL,
    embedding_dimension INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

-- Vector search table (sqlite-vss)
CREATE VIRTUAL TABLE vector_index USING vss0(
    embedding(1536),  -- OpenAI text-embedding-3-small dimension
    chunk_id INTEGER
);
```

### AI Provider Interface

```typescript
interface AIProvider {
    name: string;
    
    // Model management
    listModels(): Promise<Model[]>;
    validateApiKey(apiKey: string): Promise<boolean>;
    
    // Embedding operations
    generateEmbedding(text: string, model?: string): Promise<number[]>;
    batchGenerateEmbeddings(texts: string[], model?: string): Promise<number[][]>;
    
    // Context generation (for providers that support it)
    generateContext?(document: string, chunk: string): Promise<string>;
}

interface Model {
    id: string;
    name: string;
    type: 'embedding' | 'chat' | 'completion';
    maxTokens?: number;
    costPer1kTokens?: number;
}
```

### Configuration Schema

```typescript
interface RagConfig {
    version: string;
    providers: {
        openai?: {
            apiKey: string;
            embeddingModel: string;
            maxTokens: number;
        };
        anthropic?: {
            apiKey: string;
            model: string;
            maxTokens: number;
        };
    };
    database: {
        path: string;
        vectorDimension: number;
    };
    chunking: {
        strategy: 'character' | 'sentence' | 'paragraph';
        chunkSize: number;
        overlap: number;
    };
    contextGeneration: {
        provider: 'anthropic' | 'openai';
        maxContextTokens: number;
        prompt: string;
    };
}
```

### Contextual Retrieval Implementation

#### Anthropic's Official Prompt Template
```typescript
const ANTHROPIC_CONTEXTUAL_PROMPT = `
<document>
{documentContent}
</document>
Here is the chunk we want to situate within the whole document
<chunk>
{chunkText}
</chunk>
Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.`;
```

#### OpenAI Prompt Caching Optimization
- **Requirements**: Prompts must be 1024+ tokens for caching eligibility
- **Structure**: Static document content at beginning, dynamic chunk content at end
- **Cache Benefits**: Up to 75% cost reduction and 80% latency improvement
- **User Parameter**: Use document hash for consistent cache routing
- **Implementation**: Shared document prefix across all chunks from same document

#### Cost Optimization Strategy
```typescript
class ContextService {
  async generateContextsForDocument(document: Document, chunks: Chunk[]) {
    // Document prefix cached across all chunks
    const documentPrefix = `<document>\n${document.content}\n</document>\n...`;
    const userParam = `doc-${document.content_hash.substring(0, 8)}`;
    
    // Each chunk benefits from cached document context
    for (const chunk of chunks) {
      const context = await this.generateWithCache(documentPrefix, chunk, userParam);
    }
  }
}
```

### CLI Command Specifications

#### `rag-tool init`
- Interactive setup wizard
- API key collection and validation
- Model selection from available options
- Configuration file creation
- Initial validation tests

#### `rag db-init`
- Database creation with proper schema
- Vector extension initialization
- Index creation for performance
- Validation of database setup

#### `rag add <file>`
- File validation and loading
- Document processing and chunking
- Context generation for each chunk
- Embedding generation and storage
- Progress reporting with ETA

#### `rag search <query>`
- Query embedding generation
- Vector similarity search
- Result ranking and scoring
- Formatted output with relevance scores

#### `rag server`
- MCP server initialization
- Tool and resource registration
- Transport setup (stdio)
- Graceful shutdown handling

### MCP Server Tools

#### search_documents
```typescript
{
    name: "search_documents",
    description: "Search through documents using semantic similarity",
    inputSchema: {
        type: "object",
        properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "number", default: 10, description: "Maximum results" },
            threshold: { type: "number", default: 0.7, description: "Similarity threshold" }
        },
        required: ["query"]
    }
}
```

#### add_document
```typescript
{
    name: "add_document",
    description: "Add a new document to the knowledge base",
    inputSchema: {
        type: "object",
        properties: {
            filepath: { type: "string", description: "Path to the document file" },
            metadata: { type: "object", description: "Optional metadata" }
        },
        required: ["filepath"]
    }
}
```

#### list_documents
```typescript
{
    name: "list_documents",
    description: "List all documents in the knowledge base",
    inputSchema: {
        type: "object",
        properties: {
            limit: { type: "number", default: 50 },
            offset: { type: "number", default: 0 }
        }
    }
}
```

## File Structure

```
rag-tool/
├── src/
│   ├── cli/
│   │   ├── commands/
│   │   │   ├── init.ts
│   │   │   ├── db-init.ts
│   │   │   ├── add.ts
│   │   │   ├── search.ts
│   │   │   └── server.ts
│   │   ├── utils/
│   │   │   ├── config.ts
│   │   │   ├── progress.ts
│   │   │   └── validation.ts
│   │   └── index.ts
│   ├── mcp/
│   │   ├── server.ts
│   │   ├── tools/
│   │   │   ├── search.ts
│   │   │   ├── add-document.ts
│   │   │   └── list-documents.ts
│   │   └── resources/
│   │       ├── documents.ts
│   │       └── search-results.ts
│   ├── services/
│   │   ├── document.ts
│   │   ├── context.ts
│   │   ├── embedding.ts
│   │   ├── search.ts
│   │   └── database.ts
│   ├── providers/
│   │   ├── base.ts
│   │   ├── openai.ts
│   │   ├── anthropic.ts
│   │   └── factory.ts
│   ├── types/
│   │   ├── config.ts
│   │   ├── document.ts
│   │   ├── provider.ts
│   │   └── search.ts
│   └── utils/
│       ├── chunking.ts
│       ├── text-processing.ts
│       └── errors.ts
├── binaries/
│   ├── sqlite-vss-darwin-x64.dylib
│   ├── sqlite-vss-darwin-arm64.dylib
│   ├── sqlite-vss-linux-x64.so
│   ├── sqlite-vss-linux-arm64.so
│   └── sqlite-vss-win32-x64.dll
├── dist/
│   └── cli.js (bundled executable)
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── docs/
│   ├── API.md
│   ├── CLI.md
│   └── MCP.md
├── package.json (with bin entry for npx)
├── tsconfig.json
├── .eslintrc.js
├── .prettierrc
└── README.md
```

## Error Handling Strategy

### API Error Handling
- Implement retry logic with exponential backoff
- Handle rate limiting gracefully
- Provide clear error messages for API failures
- Cache successful operations to minimize API calls

### Database Error Handling
- Implement transaction rollback for failed operations
- Handle database corruption scenarios
- Provide database repair utilities
- Backup and recovery mechanisms

### File Processing Error Handling
- Validate file formats and sizes
- Handle encoding issues gracefully
- Implement resume capability for interrupted processing
- Track processing status at document and chunk level
- Stop on failure and allow restart from last successful point
- Clear error reporting for unsupported files
- Store failure state for debugging and recovery

## Performance Considerations

### Chunking Strategy
- Implement overlapping chunks to preserve context
- Optimize chunk size based on embedding model limits
- Use sentence boundary detection for natural breaks
- Cache chunking results for repeated processing

### Embedding Optimization
- Implement batch processing for multiple chunks
- Cache embeddings to avoid recomputation
- Use appropriate embedding models for the use case
- Implement compression for storage efficiency

### Search Performance
- Use vector indexes for fast similarity search
- Implement result caching for common queries
- Optimize database queries with proper indexing
- Implement pagination for large result sets

## Security Considerations

### API Key Management
- Store API keys securely (encrypted at rest)
- Validate API keys before storage
- Provide key rotation capabilities
- Never log or expose API keys

### Data Privacy
- Implement local-only storage by default
- Provide data deletion capabilities
- Handle sensitive documents appropriately
- Implement access controls for multi-user scenarios

### Input Validation
- Validate all user inputs thoroughly
- Sanitize file paths and content
- Implement file size limits
- Prevent injection attacks

## Future Extension Points

### Additional AI Providers
- Cohere embeddings and reranking
- Hugging Face model integration
- Local embedding models (Sentence Transformers)
- Custom provider implementations

### Document Format Support
- PDF document processing
- Microsoft Office documents
- Web content extraction
- Code file processing with syntax awareness

### Advanced Features
- Reranking with cross-encoder models
- Hybrid search (BM25 + vector similarity)
- Document summarization
- Query expansion and refinement

### Integration Capabilities
- REST API server mode
- Webhook integrations
- Export/import functionality
- Cloud storage backends

## Success Metrics

### Performance Targets
- Document processing: < 30 seconds per 10MB document
- Search latency: < 500ms for typical queries
- Storage efficiency: < 2x original document size
- Memory usage: < 512MB for typical operations

### Quality Metrics
- Search relevance: > 80% user satisfaction
- Context generation: > 90% coherent summaries
- Error rate: < 1% for supported file formats
- API reliability: > 99% successful requests

## Implementation TODO List

### Phase 1: Project Foundation (Days 1-2)
- [ ] 1.1.1 Initialize TypeScript Node.js project with npm
- [ ] 1.1.2 Configure package.json with dependencies and npx-compatible bin entry
- [ ] 1.1.3 Set up TypeScript configuration with strict mode
- [ ] 1.1.4 Create project directory structure
- [ ] 1.1.5 Configure build scripts for esbuild bundling with platform-specific sqlite-vss binaries
- [ ] 1.1.6 Set up prepublishOnly script for automated building
- [ ] 1.2.1 Design configuration schema for API keys and settings
- [ ] 1.2.2 Implement cross-platform configuration path resolution (user home directory default)
- [ ] 1.2.3 Add RAG_CONFIG_PATH environment variable and --config-path CLI option support
- [ ] 1.2.4 Create configuration persistence layer with proper directory creation
- [ ] 1.2.5 Add validation for configuration values
- [ ] 1.3.1 Define AIProvider interface
- [ ] 1.3.2 Implement OpenAI provider with model listing and embeddings
- [ ] 1.3.3 Implement Anthropic provider for context generation
- [ ] 1.3.4 Create provider factory and registration system

### Phase 2: Core Services (Days 3-4)
- [ ] 2.1.1 Set up SQLite with bundled sqlite-vss extension (cross-platform binaries)
- [ ] 2.1.2 Implement platform detection and binary loading for vector extensions
- [ ] 2.1.3 Define database schema for documents, chunks, and embeddings
- [ ] 2.1.4 Implement DatabaseService with CRUD operations
- [ ] 2.1.5 Add vector similarity search functions
- [ ] 2.1.6 Create database migration system
- [ ] 2.2.1 Implement DocumentService for file loading
- [ ] 2.2.2 Create chunking strategies (character-based, sentence-based)
- [ ] 2.2.3 Add text preprocessing and cleaning utilities
- [ ] 2.2.4 Implement overlap handling for chunks
- [ ] 2.3.1 Implement ContextService using OpenAI GPT-4o-mini for cost efficiency
- [ ] 2.3.2 Use Anthropic's official contextual retrieval prompt template
- [ ] 2.3.3 Implement OpenAI prompt caching for cost optimization (up to 75% savings)
- [ ] 2.3.4 Add batch processing for multiple chunks with shared document context
- [ ] 2.3.5 Implement error handling and retry logic
- [ ] 2.4.1 Implement EmbeddingService with OpenAI integration
- [ ] 2.4.2 Add support for different embedding models
- [ ] 2.4.3 Create embedding storage and retrieval
- [ ] 2.4.4 Implement batch embedding processing

### Phase 3: CLI Implementation (Days 5-6)
- [ ] 3.1.1 Implement `rag-tool init` command for project initialization
- [ ] 3.1.2 Create `rag-tool db-init` for database setup
- [ ] 3.1.3 Add `rag-tool add <file>` for document ingestion
- [ ] 3.1.4 Implement `rag-tool search <query>` for testing searches
- [ ] 3.1.5 Add `rag-tool server` to start MCP server
- [ ] 3.2.1 Add progress indicators for long-running operations
- [ ] 3.2.2 Implement comprehensive error messages
- [ ] 3.2.3 Create help documentation for each command
- [ ] 3.2.4 Add configuration validation and troubleshooting
- [ ] 3.3.1 Implement API key collection with secure input
- [ ] 3.3.2 Add model selection after fetching available models
- [ ] 3.3.3 Create configuration validation and testing
- [ ] 3.3.4 Add setup completion confirmation

### Phase 4: MCP Server Integration (Days 7-8)
- [ ] 4.1.1 Set up MCP server with TypeScript SDK
- [ ] 4.1.2 Implement server initialization and transport
- [ ] 4.1.3 Add proper error handling and logging
- [ ] 4.1.4 Create server lifecycle management
- [ ] 4.2.1 Implement `search_documents` tool for semantic search
- [ ] 4.2.2 Add `add_document` tool for document ingestion
- [ ] 4.2.3 Create `list_documents` tool for document management
- [ ] 4.2.4 Implement input validation with Zod schemas
- [ ] 4.3.1 Create document content resources
- [ ] 4.3.2 Implement search result resources
- [ ] 4.3.3 Add metadata and status resources
- [ ] 4.3.4 Create resource URI templates

### Phase 5: Testing and Optimization (Days 9-10)
- [ ] 5.1.1 Write tests for core services
- [ ] 5.1.2 Test AI provider implementations
- [ ] 5.1.3 Validate database operations
- [ ] 5.1.4 Test CLI command functionality
- [ ] 5.2.1 Test end-to-end document processing
- [ ] 5.2.2 Validate MCP server functionality
- [ ] 5.2.3 Test error handling scenarios
- [ ] 5.2.4 Validate configuration management
- [ ] 5.3.1 Optimize chunking strategies
- [ ] 5.3.2 Implement embedding caching
- [ ] 5.3.3 Optimize database queries
- [ ] 5.3.4 Add performance monitoring

## Conclusion

This implementation plan provides a comprehensive roadmap for building a production-ready RAG tool with contextual retrieval capabilities. The modular architecture ensures extensibility, while the dual CLI/MCP interface provides flexibility for different use cases.

The phased approach allows for iterative development and testing, ensuring each component works correctly before moving to the next phase. The emphasis on error handling, performance, and security ensures the tool will be robust and reliable in production environments.

Key success factors:
1. **Thorough testing** at each phase
2. **User feedback** during CLI development
3. **Performance monitoring** throughout implementation
4. **Documentation** for future maintenance and extension

The estimated timeline of 10 days provides adequate time for careful implementation while maintaining momentum toward a working system.