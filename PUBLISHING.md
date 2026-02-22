# Publishing to npm

Packages are published under the `@matperez` scope so you can run:

```bash
npx @matperez/coderag-mcp --root=/path/to/project
# or
npx @matperez/coderag-mcp --root=/path/to/project --index-only
```

The `coderag` bin is provided by `@matperez/coderag-mcp`.

## Prerequisites

1. **npm account** with access to the `@matperez` scope (create org at [npmjs.com](https://www.npmjs.com) if needed).
2. **Logged in:** `npm login` (use your npm credentials).

## Publish order

Publish **core first**, then **mcp-server** (mcp-server depends on core).

### One-time setup

- Ensure `packages/core/package.json` has `"name": "@matperez/coderag"`.
- Ensure `packages/mcp-server/package.json` has `"name": "@matperez/coderag-mcp"` and `"@matperez/coderag": "^0.1.24"` (or the current core version).
- Bump versions in both `package.json` files when you release a new version.

### Publish

From the repo root:

```bash
# Build everything
bun run build

# Publish core (must be first)
bun run publish:core

# Publish MCP server (CLI)
bun run publish:mcp
```

Or in one go (build + core + mcp):

```bash
bun run publish:all
```

Scoped packages are published with `--access public` so they are installable by anyone.

### After publishing

Users can run:

- `npx @matperez/coderag-mcp --root=./my-project` — start MCP server and index
- `npx @matperez/coderag-mcp --root=./my-project --index-only` — index once and exit
- `npm install @matperez/coderag` — use core as a library
