# Workspace Tools

Angular shell for modular tools. The first tool is Markdown AST Studio, which is exposed as a Native Federation remote and loaded by the shell on demand.

## Features

- Shell home page with a tool catalog and a clean user-facing launch flow.
- Native Federation runtime loading for separately deployed tools.
- Live Markdown editor with formatting tools for headings, emphasis, lists, tasks, code, tables, and links.
- GitHub Flavored Markdown support through Unified, Remark Parse, and Remark GFM.
- Explicit AST to element-model renderer in `src/app/tools/markdown-studio/markdown/markdown-renderer.service.ts`.
- Preview, generated HTML, AST rows, element rows, raw AST JSON, and document metrics.
- Isolated `srcdoc` HTML preview built from the generated HTML output.
- HTML tag source map that follows preview hover and scrolls to the matching generated tag.
- Workspace-level light and dark themes with local preference persistence.
- Local draft persistence, clipboard copy, clipboard paste, and standalone HTML export.
- Unit coverage for rendering, stats, GFM structures, and unsafe input handling.

## Development

```bash
npm install
npm start
```

Open `http://127.0.0.1:4200/`.

Run the Markdown Studio remote target:

```bash
npm run start:markdown-studio
```

Open `http://127.0.0.1:4301/`.

## Quality Checks

```bash
npm run build
npm run build:markdown-studio
npm test -- --watch=false
```

## Architecture

- `App` owns the fixed shell header, workspace navigation, theme control, and route outlet.
- `HomeComponent` renders the shell catalog from `src/app/tools/tool-catalog.ts`.
- `federation.config.js` exposes Markdown Studio from the remote build and configures shared dependencies.
- `public/federation.manifest.json` maps `markdownAstStudio` to the remote `remoteEntry.json`.
- `/tools/markdown-ast-studio` loads `MarkdownStudioModule` from the remote with `loadRemoteModule(...)`.
- `MarkdownStudioComponent` lives under `src/app/tools/markdown-studio/` and owns the editor workflow, local persistence, clipboard actions, export, AST graph, and view state.
- `MarkdownProcessorService` owns Markdown parsing and document statistics.
- `MarkdownRendererService` owns AST node rendering, URL sanitization, HTML escaping, DOM-node creation, and tree flattening.
- `src/markdown-studio/main.ts` bootstraps the same `MarkdownStudioComponent` as a standalone application target named `markdown-studio-remote`.

## Tool Routes

- Shell route: `/tools/markdown-ast-studio`
- Remote entry: `http://127.0.0.1:4301/remoteEntry.json`
- Standalone build target: `markdown-studio-remote`
- Standalone output: `dist/markdown-studio-remote`
