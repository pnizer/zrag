# zrag 🔍

A TypeScript-based Retrieval-Augmented Generation (RAG) tool implementing Anthropic's contextual retrieval methodology for 35% improved search accuracy. Features both CLI functionality and upcoming MCP (Model Context Protocol) server capabilities.

## ✨ Features

### 🏗️ **Linear Chunk Processing**
- **Pipeline Architecture**: Read → Context → Embedding → Store for each chunk
- **Configurable Parallelism**: Control concurrent processing (1-20 chunks, default: 5)
- **Comprehensive Logging**: Detailed verbose output for debugging and monitoring

### 📄 **Document Processing**
- **File-Reference Architecture**: Database stores only positions and metadata, not content
- **Smart Chunking**: Character, sentence, and paragraph-based strategies
- **Integrity Checking**: SHA-256 hashing and file modification tracking
- **Format Support**: Text (.txt) and Markdown (.md) documents

### 🧠 **Contextual Retrieval**
- **Anthropic's Method**: Official contextual retrieval prompt template
- **OpenAI Integration**: GPT-4o-mini for cost-effective context generation
- **Prompt Caching**: Up to 75% cost reduction with OpenAI's caching
- **Batch Processing**: Efficient multi-chunk processing

### 🔢 **Vector Embeddings**
- **OpenAI Embeddings**: text-embedding-3-small for cost-effectiveness
- **SQLite Storage**: Local vector storage with sqlite-vss
- **Batch Generation**: Efficient multi-document embedding
- **Vector Search**: Fast semantic similarity search

### 🖥️ **CLI Interface**
- **Interactive Setup**: Guided configuration with API key validation
- **Progress Indicators**: Real-time processing feedback
- **Error Recovery**: Graceful failure handling and restart capability
- **Flexible Options**: Extensive customization via CLI flags

## 🚀 Quick Start

### Installation & Setup

```bash
# Install via npm (when published)
npx zrag init

# Or clone and build locally
git clone <repository>
cd zrag
npm install
npm run build
```

### Basic Usage

```bash
# Initialize configuration
npx zrag init

# Set up database
npx zrag db-init

# Add a document with default settings
npx zrag add document.txt

# Add with custom parallelism and verbose logging
npx zrag add document.txt --max-parallel 10 --verbose

# Search your documents
npx zrag search "your search query"

# List all documents
npx zrag list
```

### Advanced Options

```bash
# Skip context generation (embedding only)
npx zrag add document.txt --skip-context

# Skip embedding generation (context only)
npx zrag add document.txt --skip-embedding

# Dry run to see what would happen
npx zrag add document.txt --dry-run --verbose

# Force overwrite existing document
npx zrag add document.txt --force

# Use custom config path
npx zrag add document.txt --config-path /path/to/config.json
```

## 📚 How to Use

### Complete Workflow

```bash
# 1. Initialize configuration (interactive setup)
zrag init

# 2. Set up database
zrag db-init

# 3. Add documents to your knowledge base
zrag add path/to/document.txt

# 4. Search your documents
zrag search "your question or query"
```

### 🔧 Command Reference

#### `zrag init`
Initialize RAG tool configuration with interactive setup.

```bash
zrag init [options]

Options:
  --config-path <path>    Path to configuration file
  --force                 Overwrite existing configuration
```

**Examples:**
```bash
# Interactive setup with default config location
zrag init

# Use custom config path
zrag init --config-path /custom/path/config.json

# Force overwrite existing config
zrag init --force
```

#### `zrag db-init`
Initialize the database with required schemas and indexes.

```bash
zrag db-init [options]

Options:
  --config-path <path>    Path to configuration file
  --force                 Recreate database if it already exists
  --test                  Test database operations after initialization
```

**Examples:**
```bash
# Standard database initialization
zrag db-init

# Recreate database (deletes existing data)
zrag db-init --force

# Initialize and test database operations
zrag db-init --test
```

#### `zrag add`
Add documents to the knowledge base with full processing pipeline.

```bash
zrag add <file> [options]

Arguments:
  file                           Path to the document file to add

Options:
  --config-path <path>           Path to configuration file
  --skip-context                 Skip context generation step
  --skip-embedding              Skip embedding generation step
  --force                       Overwrite existing document with same content hash
  --dry-run                     Show what would be done without actually processing
  --verbose                     Show detailed logs including chunking and API details
  --max-parallel <number>       Maximum chunks to process in parallel (default: 5)
  --rebuild-vector-index        Rebuild vector index from existing embeddings
```

**Examples:**
```bash
# Add document with default settings
zrag add document.txt

# Add with verbose logging and higher parallelism
zrag add document.txt --verbose --max-parallel 10

# Dry run to see what would happen
zrag add document.txt --dry-run --verbose

# Skip context generation (faster, embedding only)
zrag add document.txt --skip-context

# Skip embedding generation (context only)
zrag add document.txt --skip-embedding

# Force overwrite existing document
zrag add document.txt --force

# Process with custom parallelism (good for API rate limits)
zrag add large-document.txt --max-parallel 3
```

#### `zrag search`
Search through indexed documents using semantic similarity.

```bash
zrag search <query> [options]

Arguments:
  query                         Search query text

Options:
  -l, --limit <number>          Maximum number of results (default: 10)
  -t, --threshold <number>      Similarity threshold 0-1 (default: 0.7)
  --config-path <path>          Path to configuration file
  --no-context                  Hide contextual information in results
  --format <format>             Output format: table|json|detailed (default: table)
  --document-id <id>            Search within specific document only
  --verbose                     Show detailed embedding generation logs
```

**Examples:**
```bash
# Basic search
zrag search "How does authentication work?"

# Search with more results and lower threshold
zrag search "machine learning" --limit 20 --threshold 0.5

# Search in JSON format
zrag search "API endpoints" --format json

# Search within specific document
zrag search "configuration" --document-id 1

# Detailed search with verbose logging
zrag search "vector embeddings" --format detailed --verbose

# Hide context information
zrag search "quick overview" --no-context
```

#### `zrag server` (Coming Soon)
Start MCP server for Claude Code integration.

```bash
zrag server
```

### 💡 Usage Tips

#### Choosing Parallelism
- **Default (5)**: Good for most use cases
- **Low (1-3)**: For API rate limits or system resource constraints
- **High (10-20)**: For powerful systems and generous API limits

#### Understanding Thresholds
- **0.9**: Very strict, only highly relevant results
- **0.7**: Balanced (default), good precision/recall trade-off
- **0.5**: More permissive, broader results
- **0.3**: Very broad, may include tangentially related content

#### Dry Run Benefits
```bash
# Preview before processing
zrag add large-document.txt --dry-run --verbose

# Shows:
# - Estimated API calls and tokens
# - Chunking strategy results
# - Processing time estimates
# - Cost projections
```

#### Debugging and Troubleshooting
```bash
# Maximum verbosity for debugging
zrag add document.txt --verbose

# Test search with detailed output
zrag search "test query" --verbose --format detailed

# Database issues
zrag db-init --test
```

## 📊 Configuration

Configuration is stored in `~/.zrag/config.json`:

```json
{
  "version": "0.1.0",
  "providers": {
    "openai": {
      "apiKey": "your-api-key",
      "embeddingModel": "text-embedding-3-small",
      "contextModel": "gpt-4o-mini",
      "maxTokens": 4000
    }
  },
  "database": {
    "path": "/Users/you/.zrag/database.db",
    "vectorDimension": 1536
  },
  "chunking": {
    "strategy": "sentence",
    "chunkSize": 1000,
    "overlap": 200
  },
  "contextGeneration": {
    "provider": "openai",
    "maxContextTokens": 100
  },
  "processing": {
    "maxParallelChunks": 5,
    "enableLinearProcessing": true
  }
}
```

## 🏗️ Architecture

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
         │ • ChunkProcessingService │
         │ • DatabaseService     │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │   AI Provider Layer   │
         │                       │
         │ • OpenAI Provider     │
         │ • Provider Interface  │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │   SQLite Database     │
         │   with Vector Ext.    │
         └───────────────────────┘
```

## 🎯 How It Works

### Linear Processing Pipeline

Each document chunk flows through a complete pipeline:

1. **📖 Read**: Extract text from original file using stored positions
2. **🧠 Context**: Generate contextual summary using Anthropic's method
3. **🔢 Embedding**: Create vector embedding with OpenAI
4. **💾 Store**: Save metadata and vectors to SQLite database

### Controlled Parallelism

- **Semaphore Pattern**: Limits concurrent chunk pipelines
- **Resource Management**: Prevents API rate limit issues
- **Configurable**: Adjust based on your API limits and system resources

### File-Reference Architecture

- **No Content Storage**: Database contains only file paths and positions
- **Privacy Focused**: Original files remain the source of truth
- **Integrity Checking**: SHA-256 hashes detect file changes
- **Lightweight**: Minimal database storage requirements

### Build & Test

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run linting
npm run lint

# Format code
npm run format
```

## 📈 Performance

- **Document Processing**: < 30 seconds per 10MB document
- **Search Latency**: < 500ms for typical queries
- **Storage Efficiency**: < 2x original document size
- **Memory Usage**: < 512MB for typical operations

## 🔮 Roadmap

### Phase 4: MCP Server Integration
- Model Context Protocol server for Claude Code integration
- Real-time document search and retrieval tools
- Resource management for documents and search results

### Phase 5: Advanced Features
- Additional AI providers (Anthropic, Cohere, local models)
- Document format expansion (PDF, Office documents)
- Hybrid search (BM25 + vector similarity)
- REST API server mode

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Anthropic**: For the contextual retrieval methodology
- **OpenAI**: For embeddings and context generation APIs
- **Claude Code**: For being the perfect vibe-coding companion
- **sqlite-vss**: For making vector search accessible and portable

---

*Built with TypeScript, powered by AI, and crafted through the art of vibe-coding.* ✨