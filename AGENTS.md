# AGENTS.md — dsh-workbench

Plugin-local conventions for the collaborative human-AI workbench.

## Scope

- Runtime: Node `>=22`, dual-face package. Host half `lib/index.js`; browser
  half `lib/client.js` loaded via `dsh.client` declaration.
- Loader contract: named exports `name` / `inject` / `Config` / `apply` only.
  Host `inject = ['tools', 'webServer', 'systemPrompt']`.
  Registrations via `ctx.effect` / `ctx.tools.register`.
  Client `inject = ['slots']`, registers the `conversation.view` "workbench" cell.

## Repository Invariants

- `package.json`: `private: true`, `type: module`, `main: lib/index.js`,
  `exports["."]` typed + `exports["./client"]` (browser bundle).
  `files: [lib/, cordis.patch.yml]`, `dsh.bundle.patch: ./cordis.patch.yml`,
  `dsh.client: { platform: 'web' }`.
- `@deepseek-ai/cordis ^4.0.2` in peer+dev.
- `@deepseek-ai/dsh-tools ^0.1.2-rc.1` in peer+dev.
- `tsdown.config.ts` dual build (Node ESM + Browser CJS wrapped in `window.__ModuleLoader__.load`).
- Output schema: execute() must strictly conform to declared properties (`additionalProperties: false`).
