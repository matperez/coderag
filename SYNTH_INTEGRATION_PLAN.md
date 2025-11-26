# Synth Integration Plan for AST-Based Code Chunking

## 🎯 目標

用 Synth 取代現有嘅簡單字符切割，實現 **AST-aware semantic chunking**。

---

## 📋 現有實現分析

### 當前 Chunking (embeddings.ts)

```typescript
export const chunkText = (
  text: string,
  options: {
    readonly maxChunkSize?: number;  // 1000 chars
    readonly overlap?: number;        // 100 chars
  } = {}
): readonly string[] => {
  // 固定大小切割 + overlap
  // ❌ 問題：會切斷語義單元（函數、類別）
}
```

### 支援語言 (utils.ts)

CodeRAG 現支援：
- **JS/TS**: `.ts`, `.tsx`, `.js`, `.jsx`
- **Python**: `.py`
- **Go**: `.go`
- **Rust**: `.rs`
- **Java**: `.java`
- **C/C++**: `.c`, `.cpp`
- **其他**: Ruby, PHP, Swift, Kotlin
- **Markup**: Markdown, JSON, YAML, TOML, SQL

---

## 🚀 Synth Integration 設計

### 1. 新增 AST Chunking 函數

```typescript
// packages/core/src/ast-chunking.ts

import { synth } from '@sylphx/synth';
import { parse as parseJS } from '@sylphx/synth-js';
import { detectLanguage } from './utils.js';

/**
 * AST-based code chunking options
 */
export interface ASTChunkOptions {
  readonly maxChunkSize?: number;      // Max tokens/chars per chunk
  readonly minChunkSize?: number;      // Min size to avoid tiny chunks
  readonly chunkByNodeType?: boolean;  // Split by semantic units
  readonly preserveContext?: boolean;  // Include parent context (imports, etc)
}

/**
 * Chunk code using AST analysis (Synth-powered)
 */
export const chunkCodeByAST = async (
  code: string,
  filePath: string,
  options: ASTChunkOptions = {}
): Promise<readonly string[]> => {
  const {
    maxChunkSize = 1000,
    minChunkSize = 100,
    chunkByNodeType = true,
    preserveContext = true,
  } = options;

  // 1. Detect language
  const language = detectLanguage(filePath);
  if (!language) {
    // Fallback to character-based chunking
    return chunkText(code, { maxChunkSize });
  }

  // 2. Parse AST using Synth
  const ast = await parseWithSynth(code, language);
  if (!ast) {
    return chunkText(code, { maxChunkSize });
  }

  // 3. Extract semantic chunks
  const chunks = extractSemanticChunks(ast, code, {
    maxChunkSize,
    minChunkSize,
    preserveContext,
  });

  return chunks;
};

/**
 * Parse code with Synth based on language
 */
async function parseWithSynth(code: string, language: string) {
  try {
    switch (language) {
      case 'JavaScript':
      case 'TypeScript':
      case 'JSX':
      case 'TSX':
        return parseJS(code, { sourceType: 'module' });

      case 'Markdown':
        return synth().parse(code, 'markdown');

      case 'JSON':
        return synth().parse(code, 'json');

      case 'Python':
        return synth().parse(code, 'python');

      case 'Go':
        return synth().parse(code, 'go');

      case 'Rust':
        return synth().parse(code, 'rust');

      // TODO: Add more languages as Synth supports them

      default:
        return null;
    }
  } catch (error) {
    console.error(`[WARN] Synth parsing failed for ${language}:`, error);
    return null;
  }
}

/**
 * Extract semantic chunks from AST
 *
 * Strategy:
 * - Split at function/class boundaries
 * - Keep complete semantic units
 * - Merge small chunks if under minChunkSize
 * - Include context (imports, type definitions) when preserveContext=true
 */
function extractSemanticChunks(
  ast: any,
  sourceCode: string,
  options: {
    maxChunkSize: number;
    minChunkSize: number;
    preserveContext: boolean;
  }
): string[] {
  const chunks: string[] = [];
  const contextNodes: any[] = []; // imports, type defs, etc.

  // TODO: Implement AST traversal
  // 需要 Synth 提供嘅功能（見下面）

  return chunks;
}
```

---

## 🔧 Synth 需要提供嘅功能

### **1. AST Node 遍歷 API** ⭐️ **HIGH PRIORITY**

```typescript
// 需求：統一嘅 node traversal interface
interface ASTNode {
  type: string;           // 'FunctionDeclaration', 'ClassDeclaration', etc.
  start: number;          // 源碼起始位置
  end: number;            // 源碼結束位置
  children?: ASTNode[];   // 子節點
  parent?: ASTNode;       // 父節點
  loc?: {                 // 行列資訊
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

// API 例子
tree.traverse((node: ASTNode, depth: number) => {
  if (node.type === 'FunctionDeclaration') {
    // Extract this function as a chunk
  }
});

// 或者用 visitor pattern
tree.walk({
  FunctionDeclaration(node) {
    // Handle function nodes
  },
  ClassDeclaration(node) {
    // Handle class nodes
  },
});
```

### **2. 源碼位置提取** ⭐️ **HIGH PRIORITY**

```typescript
// 需求：從 AST node 提取對應嘅源碼
tree.getSourceText(node: ASTNode): string

// 例子
const funcNode = tree.findNode(n => n.type === 'FunctionDeclaration');
const funcCode = tree.getSourceText(funcNode);
// => "function foo() { ... }"
```

### **3. 語義節點類型查詢** ⭐️ **MEDIUM PRIORITY**

```typescript
// 需求：識別唔同語言嘅語義邊界
tree.findSemanticBoundaries(options?: {
  types: ('function' | 'class' | 'method' | 'import' | 'export')[];
}): ASTNode[]

// 例子
const boundaries = tree.findSemanticBoundaries({
  types: ['function', 'class']
});
// => [FunctionDeclaration, ClassDeclaration, ...]
```

### **4. 智能合併小節點** ⭐️ **LOW PRIORITY**

```typescript
// 需求：合併過細嘅節點避免產生太多碎片
tree.mergeSmallNodes(minSize: number): ASTNode[]

// 例子
const merged = tree.mergeSmallNodes(100); // Merge nodes < 100 chars
```

### **5. Context 提取** ⭐️ **MEDIUM PRIORITY**

```typescript
// 需求：提取 imports, type definitions 等上下文
tree.extractContext(): {
  imports: ASTNode[];
  types: ASTNode[];
  constants: ASTNode[];
}

// 用途：每個 chunk 前面加上必要嘅 context
// 例如：import 語句、type definitions
```

---

## 📊 實現優先級

### Phase 1: 基本 AST Chunking (Week 1-2)
- ✅ Synth 提供 `traverse()` API
- ✅ Synth 提供 `getSourceText()` API
- ✅ 實現 JS/TS AST chunking
- ✅ Fallback to character chunking

### Phase 2: 多語言支援 (Week 3-4)
- ✅ Python, Go, Rust 支援
- ✅ Markdown structure-aware chunking
- ✅ JSON/YAML semantic splitting

### Phase 3: 優化 & Context (Week 5-6)
- ✅ Context preservation (imports, types)
- ✅ Smart node merging
- ✅ Performance benchmarking

---

## 🧪 測試策略

```typescript
// packages/core/src/ast-chunking.test.ts

describe('AST-based chunking', () => {
  it('should split JavaScript by functions', async () => {
    const code = `
      function foo() { return 1; }
      function bar() { return 2; }
      function baz() { return 3; }
    `;

    const chunks = await chunkCodeByAST(code, 'test.js');

    expect(chunks.length).toBe(3);
    expect(chunks[0]).toContain('function foo');
    expect(chunks[1]).toContain('function bar');
    expect(chunks[2]).toContain('function baz');
  });

  it('should preserve context (imports)', async () => {
    const code = `
      import { foo } from 'bar';

      function usesFoo() { return foo(); }
      function alsoUsesFoo() { return foo(); }
    `;

    const chunks = await chunkCodeByAST(code, 'test.ts', {
      preserveContext: true,
    });

    // Both chunks should include the import
    expect(chunks[0]).toContain('import { foo }');
    expect(chunks[1]).toContain('import { foo }');
  });

  it('should merge small chunks', async () => {
    const code = `
      const a = 1;
      const b = 2;
      const c = 3;
    `;

    const chunks = await chunkCodeByAST(code, 'test.js', {
      minChunkSize: 50,
    });

    // Should merge into 1 chunk instead of 3 tiny ones
    expect(chunks.length).toBe(1);
  });

  it('should fallback to character chunking for unknown languages', async () => {
    const code = 'a'.repeat(2000);

    const chunks = await chunkCodeByAST(code, 'test.unknown');

    expect(chunks.length).toBeGreaterThan(1);
  });
});
```

---

## 🔗 API Changes

### 新增導出 (packages/core/src/index.ts)

```typescript
export {
  chunkCodeByAST,
  type ASTChunkOptions,
} from './ast-chunking.js';
```

### 向後兼容

保留原有 `chunkText()` 作為 fallback：

```typescript
// 現有代碼繼續工作
import { chunkText } from '@codebase-search/core';
const chunks = chunkText(text, { maxChunkSize: 1000 });

// 新 API
import { chunkCodeByAST } from '@codebase-search/core';
const chunks = await chunkCodeByAST(code, filePath, { maxChunkSize: 1000 });
```

---

## 📦 Dependencies

```json
{
  "dependencies": {
    "@sylphx/synth": "^0.x.x",
    "@sylphx/synth-js": "^0.x.x"
  }
}
```

---

## 🎯 預期效果

### Before (Character-based)
```typescript
// ❌ 切斷函數定義
chunk1: "function calculateTotal(items) {\n  let sum = 0;\n  for (const"
chunk2: " item of items) {\n    sum += item.price;\n  }\n  return sum;\n}"
```

### After (AST-based)
```typescript
// ✅ 完整嘅語義單元
chunk1: "function calculateTotal(items) {\n  let sum = 0;\n  for (const item of items) {\n    sum += item.price;\n  }\n  return sum;\n}"
```

### 檢索質量提升
- **Before**: "calculate" 可能搵唔到完整函數
- **After**: 整個函數嘅 embedding 更準確，檢索更精確

---

## 🚨 注意事項

1. **Performance**: AST parsing 比 character splitting 慢，需要 benchmark
2. **Error Handling**: Synth parsing 失敗要 gracefully fallback
3. **Large Files**: 超大檔案（>1MB）可能需要 streaming parsing
4. **Memory**: AST 佔用內存，需要考慮 memory footprint

---

## 📞 需要 Synth Team 提供

### Critical Path Items (Week 1)
1. ✅ 統一嘅 `traverse()` / `walk()` API
2. ✅ `getSourceText(node)` 方法
3. ✅ Node type 定義 (`ASTNode` interface)

### Nice-to-Have (Week 2+)
4. ✅ `findSemanticBoundaries()` helper
5. ✅ `extractContext()` helper
6. ✅ Performance benchmarks for large files

---

## 🎉 總結

用 Synth 做 AST-based chunking 將會：
- ✅ 保持代碼語義完整性
- ✅ 提升 embedding 質量
- ✅ 改善 RAG 檢索精度
- ✅ 支援 19+ 語言
- ✅ 超快速度 (50-3000x)

**下一步**: 等 Synth 提供 critical path APIs，即可開始實現！
