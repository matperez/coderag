---
"@sylphx/coderag": minor
"@sylphx/coderag-mcp": minor
---

# 🎉 CodeRAG - Initial Release v0.1.0

Lightning-fast hybrid code search (TF-IDF + Vector) - RAG-ready for AI assistants

## Core Features

### Hybrid Search Engine
- **TF-IDF Search**: Fast keyword-based search with relevance scoring
- **Vector Search**: Semantic search using embeddings (HNSW algorithm)
- **Hybrid Ranking**: Weighted combination for best results

### Performance
- **2.7x faster** initial indexing vs traditional approaches
- **166x faster** incremental updates
- **100x faster** cached queries

### Code Tokenization
- StarCoder2-based tokenizer for code understanding
- Handles camelCase, snake_case, code identifiers
- Lightweight fallback tokenizer (no model download required)

### Embedding Provider Support
- OpenAI (official)
- OpenAI-compatible (OpenRouter, Together AI, Fireworks AI, Ollama)
- Extensible provider registry for custom implementations
- Mock provider for testing

### Persistent Storage
- SQLite-based metadata and index storage
- Atomic batch operations
- Incremental update engine

### MCP Server
- Model Context Protocol integration
- RAG-ready for AI assistants
- Search tools and index management

## Architecture

- Pure functional design
- Registry Pattern for extensibility
- Comprehensive test coverage (396 tests passing)

## Packages

- **@sylphx/coderag**: Core search library
- **@sylphx/coderag-mcp**: MCP server for AI integration
