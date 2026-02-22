# Codebase Search Roadmap

## ✅ Completed Features (v1.0)

### Core Search (Q1 2025)
- [x] TF-IDF based search ranking
- [x] Code-aware tokenization (identifiers, keywords)
- [x] .gitignore support
- [x] Language detection
- [x] Comprehensive test suite (150+ tests)
- [x] CI/CD pipeline with GitHub Actions

### File Watching (Q1 2025)
- [x] Real-time file monitoring with chokidar
- [x] Debounced updates (500ms)
- [x] Automatic index updates on file add/change/delete
- [x] Graceful handling of file operations

### Persistent Storage (Q1 2025)
- [x] SQLite database with Drizzle ORM
- [x] Store file metadata and content
- [x] Store TF-IDF vectors per document
- [x] Store global IDF scores
- [x] Load existing index on startup
- [x] WAL mode for better concurrency
- [x] Database migrations

### MCP Integration (Q1 2025)
- [x] MCP server implementation
- [x] Claude Desktop integration
- [x] Auto-indexing on startup
- [x] Watch mode enabled by default

---

## 🚧 In Progress

### AST Analysis & Symbol Search (Q2 2025)
See "Planned Features" section below for details.

---

## ✅ Recently Completed (Q1 2025)

### Performance Optimizations
- [x] **Hash-based Change Detection** - Skip unchanged files during re-indexing
- [x] **Incremental TF-IDF Updates** - Smart update strategy (only update affected terms/documents)
- [x] **Query Result Caching** - LRU cache with TTL for faster repeated searches
- [x] **Batch Database Operations** - Transaction-based bulk inserts for 10x faster indexing
- [x] **Smart Cache Validation** - Auto-detect when >20% files change, trigger full rebuild

### Semantic Search Foundation
- [x] **Embeddings Interface** - Pure functional API using Vercel AI SDK
- [x] **OpenAI Integration** - Support for text-embedding-3-small/large and ada-002
- [x] **Mock Provider** - Deterministic embeddings for testing
- [x] **Cosine Similarity** - Vector comparison utilities
- [x] **Text Chunking** - Split large texts with overlap for better embeddings

---

## 🎯 Planned Features

### AST Analysis & Symbol Search (Q2 2025)
**Priority: High**

Implement Abstract Syntax Tree (AST) analysis for precise symbol-level search:

- [ ] **AST Parser Integration**
  - TypeScript/JavaScript (using @typescript-eslint/parser or swc)
  - Python (using tree-sitter-python)
  - Go (using tree-sitter-go)
  - Rust (using tree-sitter-rust)
  - Java (using tree-sitter-java)

- [ ] **Symbol Extraction**
  - Function/method definitions
  - Class/interface definitions
  - Variable/constant declarations
  - Type definitions
  - Import/export statements
  - Comments and documentation

- [ ] **Symbol Search**
  - Search by symbol type (function, class, variable, etc.)
  - Find all references to a symbol
  - Find all implementations of an interface
  - Find all callers of a function
  - Search within specific scopes (file, module, package)

- [ ] **Symbol Metadata Storage**
  - New database table for symbols
  - Symbol name, type, location (file, line, column)
  - Scope information (parent symbol, visibility)
  - Signature information (parameters, return type)
  - Documentation/comments

- [ ] **Enhanced Search API**
  ```typescript
  // Symbol-specific search
  await indexer.searchSymbols({
    name: 'getUserData',
    type: 'function',
    scope: 'src/api',
  });

  // Find references
  await indexer.findReferences({
    symbol: 'UserService',
    type: 'class',
  });

  // Find implementations
  await indexer.findImplementations('IUserRepository');
  ```

**Benefits:**
- Precise symbol-level search vs. text-based search
- Understand code structure and relationships
- Better code navigation and refactoring support
- Language-aware search (respects semantics)
- Foundation for code intelligence features

**Technical Approach:**
- Use tree-sitter for universal AST parsing (supports 40+ languages)
- Incremental parsing for fast updates
- Store symbol locations and metadata in SQLite
- Index symbols alongside TF-IDF vectors
- Hybrid search: combine TF-IDF and symbol search for best results

---

### Postgres и параллельная индексация — не делаем
**Решение (2026-02):** Внедрение бекенда PostgreSQL и параллельной индексации (сегменты, pool, bulk insert) провели в эксперименте. По итогам бенчмарков решили не продолжать: для одного процесса SQLite быстрее и проще; выигрыш от Postgres — только в сценарии «общий индекс на несколько процессов». Подробности, цифры и выводы: [Эксперимент: Postgres и параллельная индексация](docs/postgres-parallel-experiment.md).

---

### Postgres: разделение данных по проектам (multi-tenant)
**Priority: Medium** *(актуально только если в будущем снова появится бекенд Postgres)*

Сейчас в SQLite проекты разделены по каталогам: `~/.coderag/projects/<hash>/index.db` (hash от `codebaseRoot`). В Postgres одна `DATABASE_URL` ведёт в одну базу и одни таблицы — колонки `project_id` / `codebase_root` нет. Два репо с одним и тем же `DATABASE_URL` пишут в одни таблицы; `files.path` уникален и относительный, поэтому возможны конфликты и смешение данных.

Варианты реализации:

- [ ] **Вариант A: разная база на проект** — для каждого проекта свой `database` в connection string (или разный `DATABASE_URL`). Изменений в коде не требуется; зафиксировать в документации.
- [ ] **Вариант B: схема на проект** — одна БД, отдельная PostgreSQL-схема на проект (например `project_<hash>`). Нужен параметр схемы в конфиге и доработка миграций.
- [ ] **Вариант C: колонка codebase_root / project_id** — добавить в `files` (и при необходимости в связанные таблицы) колонку, хранить hash/путь корня проекта, во всех запросах фильтровать по ней. Одна БД обслуживает много проектов.

---

### Ускорение индексации
**Priority: Medium**

Текущие узкие места: по одному INSERT на чанк в БД; последовательные парсинг и токенизация внутри батча/сегмента; синхронное чтение файлов.

- [ ] **Bulk insert чанков** — один (или несколько) INSERT на батч вместо N (INSERT ... VALUES (...), (...) RETURNING id). Высокий эффект, средняя сложность.
- [ ] **Параллельная токенизация** — вызывать tokenize для нескольких чанков в батче параллельно (Promise.all по группе чанков). Средний эффект, низкая сложность.
- [ ] **Параллельный парсинг/чтение внутри сегмента (Postgres)** — не делаем (часть отменённого эксперимента Postgres + параллельная индексация, см. [postgres-parallel-experiment.md](docs/postgres-parallel-experiment.md)).
- [ ] **Увеличить indexingBatchSize** (при достаточной RAM) — замерить 100–150 файлов на батч. Низкий–средний эффект, низкая сложность.
- [ ] **Асинхронное чтение файлов** — fs.promises.readFile и обрабатывать пачками. Низкий эффект на SSD, низкая сложность.

Приоритет по эффекту/сложности: bulk insert чанков → параллельная токенизация → параллельный парсинг в сегменте → размер батча → async read.

---

### Фоновая индексация (работа с RAG во время индексации)
**Priority: Medium**

Цель: запускать индексацию в фоне и сразу использовать поиск по уже проиндексированной части кода, без ожидания полного окончания `index()`.

**Текущее состояние**

- При persistent storage (SQLite/Postgres) поиск идёт по БД: `searchChunks()` → `searchByTerms()`, `getIdfScoresForTerms()`. Проверки «индекс не готов» для этого режима нет — поиск читает то, что уже в БД.
- IDF и TF-IDF пересчитываются **один раз в конце** `index()`. Пока индексация идёт, в БД появляются новые файлы/чанки/векторы, но таблицы `idf_scores` и значения `tfidf` в `document_vectors` обновляются только после полного прохода. Поэтому поиск в середине индексации будет по «смеси» старого IDF и частично новых данных — результат частичный или с искажённым ранжированием.

**Что сделать**

- [ ] **Не блокировать на index()** — вызывать `index()` без обязательного `await` (фоновый запуск), при этом API/MCP не ждут завершения индексации и сразу отдают управление. Статус индексации уже есть (`getStatus()`, `isIndexing`, `progress`), его можно отдавать в UI/клиенту.
- [ ] **Разрешить search() во время индексации** — для persistent storage ничего не блокирует: поиск уже читает из БД. Имеет смысл явно задокументировать: «поиск возвращает результаты по уже проиндексированной части; до завершения индексации ранжирование может быть неполным».
- [ ] **Опционально: периодический пересчёт IDF во время индексации** — после каждых N батчей (или каждые M секунд) вызывать `rebuildIdfScoresFromVectors()` и `recalculateTfidfScores()` по уже записанным данным. Тогда поиск в фоне будет видеть всё более полный и консистентный индекс по мере роста обработанных файлов (ценой дополнительной нагрузки на БД и CPU).
- [ ] **MCP/интеграции** — при старте сервера запускать индексацию в фоне и сразу обрабатывать запросы поиска; в ответах или отдельном инструменте возвращать `isIndexing` и `progress`, чтобы клиент мог показывать «индексация 30%» и при этом уже вызывать поиск.

**Итог:** да, сделать фонную индексацию и работу с RAG по уже проиндексированной части можно: поиск по persistent storage уже не блокируется завершением `index()`. Нужны только явный фоновый запуск, опционально — периодический пересчёт IDF для лучшего качества частичного поиска и документирование поведения.

---

### Парсеры внутри репозитория (vendoring / submodule)
**Priority: Low–Medium**

Цель: подгружать парсеры при сборке coderag и иметь возможность править код парсера при багах (например WASM «Out of bounds» в synth-go).

Сейчас парсеры подтягиваются из npm (`@sylphx/synth-*`) или из локального клона Synth через symlink (`scripts/link-synth-go.sh`). Импорт в коде — динамический `import(config.parser)` по имени пакета.

**Вариант A: Git submodule Synth + workspace**

- [ ] Добавить Synth как submodule, например `third_party/synth`.
- [ ] Включить пакеты парсеров в workspaces: `"third_party/synth/packages/*"` (или перечислить нужные, например `synth-go`, `synth-js`, …), чтобы `@sylphx/synth-go` резолвился в дерево репо.
- [ ] В корне coderag в сборке сначала собирать парсеры (например `turbo run build --filter=@sylphx/synth-go --filter=...` или зависимость `packages/core` от этих пакетов), затем сборка core.
- [ ] Убрать (или сделать опциональными с приоритетом workspace) `optionalDependencies` в `packages/core` для тех парсеров, что берём из submodule.
- Плюсы: исходники парсеров в репо, можно коммитить патчи в submodule или форк. Минусы: нужна поддержка submodule (init/update), сборка Synth (часть парсеров — WASM, может потребоваться Rust/wasm-pack).

**Вариант B: Копирование парсеров в монорепо (vendoring)**

- [ ] Скопировать нужные пакеты из Synth в репо, например `packages/parsers/synth-go`, `packages/parsers/synth-js`, с теми же `name` в package.json (`@sylphx/synth-go` и т.д.).
- [ ] Добавить `packages/parsers/*` в workspaces; в `packages/core` зависеть от них через workspace (или оставить optional и дать резолвиться локальным пакетам).
- [ ] В корневом build (turbo) обеспечить порядок: сначала сборка парсеров, потом core.
- Плюсы: полный контроль, нет submodule. Минусы: синхронизация с upstream вручную (копирование/обновление).

**Общее для обоих вариантов**

- [ ] Резолв парсеров не менять: по-прежнему `import('@sylphx/synth-go')` и т.п. — резолвер (bun/npm) подхватит workspace-пакеты.
- [ ] Документировать: как собрать, как править парсер и пересобрать (для A — правки в submodule, для B — в `packages/parsers/...`).

---

### Smart Incremental Indexing (Q2 2025)
**Priority: Medium**

- [ ] **Hash-based Change Detection**
  - Compare file hashes to detect changes
  - Skip unchanged files on re-index
  - Only rebuild affected TF-IDF vectors

- [ ] **Partial Index Updates**
  - Update only changed documents
  - Recalculate IDF scores incrementally
  - Maintain index consistency

- [ ] **Background Indexing**
  - Queue-based indexing for large codebases
  - Progress reporting
  - Cancellation support

**Benefits:**
- Faster re-indexing (only changed files)
- Lower resource usage
- Better user experience for large codebases

---

### Advanced Search Features (Q2-Q3 2025)
**Priority: Medium**

- [ ] **Fuzzy Search**
  - Levenshtein distance for typo tolerance
  - Phonetic matching
  - Configurable similarity threshold

- [ ] **Regular Expression Search**
  - Regex pattern matching
  - Syntax highlighting in results
  - Performance optimizations

- [ ] **Multi-language Support**
  - Language-specific tokenization
  - Language-specific stop words
  - Polyglot codebase support

- [ ] **Search Filters**
  - Filter by language
  - Filter by file path pattern
  - Filter by date range
  - Filter by file size

- [ ] **Search Ranking Improvements**
  - BM25 algorithm (alternative to TF-IDF)
  - Learning to rank (ML-based ranking)
  - User feedback integration

---

### Code Intelligence (Q3 2025)
**Priority: Low**

Building on AST analysis:

- [ ] **Code Navigation**
  - Go to definition
  - Go to implementation
  - Go to type definition
  - Find all references

- [ ] **Code Completion**
  - Context-aware suggestions
  - Import suggestions
  - Symbol suggestions

- [ ] **Refactoring Support**
  - Rename symbol across codebase
  - Extract function/method
  - Move symbol to different file

- [ ] **Code Quality**
  - Dead code detection
  - Unused imports detection
  - Circular dependency detection

---

### Enterprise Features (Q3-Q4 2025)
**Priority: Low**

- [ ] **Multi-repository Support**
  - Index multiple repositories
  - Cross-repository search
  - Repository management UI

- [ ] **Team Features**
  - Shared index across team
  - Collaborative annotations
  - Code ownership tracking

- [ ] **Advanced Security**
  - Encrypted database
  - Access control
  - Audit logging

- [ ] **Analytics**
  - Search query analytics
  - Usage statistics
  - Performance metrics

---

### Documentation & Ecosystem (Ongoing)

- [ ] **Documentation**
  - API reference
  - Architecture guide
  - Performance tuning guide
  - Best practices

- [ ] **Integrations**
  - VS Code extension
  - JetBrains plugin
  - Vim plugin
  - Emacs package

- [ ] **Developer Experience**
  - CLI tool for testing
  - Web UI for visualization
  - Debug mode with detailed logs
  - Performance profiling tools

---

## 📝 Research & Exploration

### Future Possibilities

- **Semantic Search**
  - Vector embeddings for code semantics
  - AI-powered code understanding
  - Natural language queries

- **Code Graph Analysis**
  - Dependency graph
  - Call graph
  - Data flow analysis
  - Control flow analysis

- **Language Models Integration**
  - Code summarization
  - Code explanation
  - Code generation suggestions

- **Real-time Collaboration**
  - Live index updates across team
  - Shared search history
  - Collaborative annotations

---

## 🤝 Contributing

We welcome contributions! See areas where you can help:

1. **AST Analysis** - Help implement tree-sitter integration
2. **Performance** - Optimize indexing and search algorithms
3. **Language Support** - Add support for more languages
4. **Documentation** - Improve docs and examples
5. **Testing** - Add more test coverage

---

## 📅 Release Schedule

- **v1.0** (Q1 2025) - Core features + persistent storage ✅
- **v1.1** (Q2 2025) - AST analysis + symbol search
- **v1.2** (Q2 2025) - Smart incremental indexing
- **v2.0** (Q3 2025) - Advanced search + code intelligence
- **v2.1** (Q4 2025) - Enterprise features

---

## 💬 Feedback

We'd love to hear your thoughts! Please:
- Open an issue for feature requests
- Join discussions for roadmap input
- Share your use cases and pain points

---

**Last Updated**: 2026-02-22
