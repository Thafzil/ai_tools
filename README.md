# Workspace Tools

Angular shell for modular tools. Markdown AST Studio and NEATCODE are exposed as Native Federation remotes and loaded by the shell on demand.

## Features

- Shell home page with a tool catalog and a clean user-facing launch flow.
- Native Federation runtime loading for separately deployed tools.
- NEATCODE adaptive refactoring practice with login/signup, user-specific profiles, Ollama-generated dirty-code challenges, hints, scoring, attempts, and skill tracking.
- Live Markdown editor with formatting tools for headings, emphasis, lists, tasks, code, tables, and links.
- GitHub Flavored Markdown support through Unified, Remark Parse, and Remark GFM.
- Explicit AST to element-model renderer in `src/app/tools/markdown-studio/markdown/markdown-renderer.service.ts`.
- Preview, generated HTML, AST rows, element rows, raw AST JSON, and document metrics.
- Isolated `srcdoc` HTML preview built from the generated HTML output.
- HTML tag source map that follows preview hover and scrolls to the matching generated tag.
- Workspace-level light and dark themes with local preference persistence.
- Local draft persistence, clipboard copy, clipboard paste, and standalone HTML export.
- Node/Express NEATCODE API with signed sessions, MongoDB persistence, Ollama/OpenAI-compatible generation, and a local memory fallback for development.
- Unit coverage for rendering, stats, GFM structures, unsafe input handling, and shell routing.

## Development

```bash
npm install
npm start
```

Open `http://127.0.0.1:4200/`.

Run the backend API:

```bash
npm run api
```

Run the Markdown Studio remote target:

```bash
npm run start:markdown-studio
```

Open `http://127.0.0.1:4301/`.

Run the NEATCODE remote target:

```bash
npm run start:neatcode
```

Open `http://127.0.0.1:4302/`.

## Backend Environment

Create `backend/.env` from `backend/.env.example`.

`MONGO_URI` must be a full MongoDB connection string, including host or Atlas cluster. `MONGO_USER` and `MONGO_PASSWORD` alone are not enough to connect. You can also provide `MONGO_HOST`, `MONGO_USER`, and `MONGO_PASSWORD`, and the API will compose a URI.

Set `ALLOW_MEMORY_FALLBACK=false` when MongoDB should be mandatory. When no Mongo URI/host is available and fallback is true, the API uses an in-memory development store and reports that in `/api/neatcode/health`.

For local Ollama:

```bash
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=llama3.2:latest
```

## Quality Checks

```bash
npm run build
npm run build:markdown-studio
npm run build:neatcode
npm run api:check
npm test -- --watch=false
```

## Architecture

- `App` owns the fixed shell header, workspace navigation, theme control, and route outlet.
- `HomeComponent` renders the shell catalog from `src/app/tools/tool-catalog.ts`.
- `federation.config.js` exposes Markdown Studio or NEATCODE depending on `NF_TARGET` and configures shared dependencies.
- `public/federation.manifest.json` maps `markdownAstStudio` and `neatCodeAcademy` to their remote `remoteEntry.json` files.
- `/tools/markdown-ast-studio` loads `MarkdownStudioModule` from the remote with `loadRemoteModule(...)`.
- `/tools/neatcode` loads `NeatCodeAcademyModule` from the remote with `loadRemoteModule(...)`.
- `MarkdownStudioComponent` lives under `src/app/tools/markdown-studio/` and owns the editor workflow, local persistence, clipboard actions, export, AST graph, and view state.
- `NeatCodeAcademyComponent` lives under `src/app/tools/neatcode-academy/` and owns authentication, the refactoring workspace, hints, scoring UI, and snippet analysis.
- `backend/src/` owns the NEATCODE API, auth/session signing, Ollama generation, deterministic scoring engine, and Mongo/memory repositories.
- `MarkdownProcessorService` owns Markdown parsing and document statistics.
- `MarkdownRendererService` owns AST node rendering, URL sanitization, HTML escaping, DOM-node creation, and tree flattening.
- `src/markdown-studio/main.ts` bootstraps the same `MarkdownStudioComponent` as a standalone application target named `markdown-studio-remote`.
- `src/neatcode/main.ts` bootstraps the same `NeatCodeAcademyComponent` as a standalone application target named `neatcode-remote`.

## Tool Routes

- Shell route: `/tools/markdown-ast-studio`
- Shell route: `/tools/neatcode`
- Markdown remote entry: `http://127.0.0.1:4301/remoteEntry.json`
- NEATCODE remote entry: `http://127.0.0.1:4302/remoteEntry.json`
- Markdown standalone build target: `markdown-studio-remote`
- NEATCODE standalone build target: `neatcode-remote`
- Markdown standalone output: `dist/markdown-studio-remote`
- NEATCODE standalone output: `dist/neatcode-remote`
# ai_tools
