# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Fresh `bun init` scaffold (Bun v1.3.14). `index.ts` is a one-line hello-world; `package.json` has no scripts and no runtime dependencies. No app code, tests, or framework yet — don't assume hidden structure.

## Commands

- `bun install` — install dependencies
- `bun run index.ts` — run the entry point once
- `bun --hot index.ts` — run with hot reload during development
- `bun test` — run all tests
- `bun test path/to/file.test.ts` — run a single test file
- `bun test -t "name"` — run tests matching a name pattern
- `bunx tsc --noEmit` — typecheck (tsconfig has `noEmit: true`, strict, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`)

## Runtime rule: use Bun, not Node

Default to Bun instead of Node.js. This is the project's primary constraint.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` / `yarn install` / `pnpm install`
- Use `bun run <script>` instead of `npm run` / `yarn run` / `pnpm run`
- Use `bunx <package> <command>` instead of `npx`
- Bun auto-loads `.env` — don't add `dotenv`.

## APIs to prefer

- `Bun.serve()` for HTTP/WebSockets/HTTPS/routes — don't use `express`
- `bun:sqlite` for SQLite — don't use `better-sqlite3`
- `Bun.redis` for Redis — don't use `ioredis`
- `Bun.sql` for Postgres — don't use `pg` or `postgres.js`
- Built-in `WebSocket` — don't use `ws`
- `Bun.file` over `node:fs` `readFile`/`writeFile`
- `` Bun.$`ls` `` over `execa`

## Testing

Use `bun test`.

```ts
// index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

For more, see the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
