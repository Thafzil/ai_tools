# Render UI Deployment

This deploys the Angular shell and the current microfrontend tools as one Render static site.

## Recommended First UI Deploy

Create a Render Static Site from this repository, or use the repo-level `render.yaml` Blueprint.

- Service type: `Static Site`
- Build command: `npm ci && npm run build:render:ui`
- Publish directory: `dist/decoders-markdown/browser`
- SPA rewrite: `/*` -> `/index.html`

The build command creates this production layout:

- Shell app: `dist/decoders-markdown/browser`
- Markdown Studio remote: `dist/decoders-markdown/browser/remotes/markdown-studio`
- NEATCODE remote: `dist/decoders-markdown/browser/remotes/neatcode`
- Federation manifest: `dist/decoders-markdown/browser/federation.manifest.json`

This keeps the microfrontend loading model but serves all UI assets from one Render CDN URL.

## Later Separate Remote Deploys

If a tool needs independent UI deployment later:

1. Deploy the remote as its own Render Static Site.
2. Use the remote's `remoteEntry.json` URL in the shell build.
3. Build the shell with:

```sh
MARKDOWN_REMOTE_ENTRY=https://your-markdown-remote.onrender.com/remoteEntry.json \
NEATCODE_REMOTE_ENTRY=https://your-neatcode-remote.onrender.com/remoteEntry.json \
npm run build:render:shell
```

For NEATCODE alone:

- Build command: `npm ci && npm run build:neatcode`
- Publish directory: `dist/neatcode-remote/browser`

## Backend Rewrite

After the API is deployed, add a Render rewrite above the SPA fallback:

| Source | Destination | Action |
| --- | --- | --- |
| `/api/*` | `https://ai-tools-api-6jkb.onrender.com/api/*` | `Rewrite` |
| `/*` | `/index.html` | `Rewrite` |

Keep the `/api/*` rule above the `/*` -> `/index.html` rule.
