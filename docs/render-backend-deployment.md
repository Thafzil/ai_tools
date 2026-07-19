# Render Backend Deployment

Deploy NEATCODE API as a Render Web Service.

## Create The API Service

In Render, choose **New > Web Service** and connect the same repository.

- Name: `ai-tools-api`
- Environment: `Node`
- Branch: `main`
- Root Directory: leave empty
- Build Command: `npm ci && npm run build:render:api`
- Start Command: `npm run api:start`
- Health Check Path: `/api/neatcode/health`

Render provides the `PORT` variable for web services. The API binds to `0.0.0.0` and reads that port automatically.

## Environment Variables

Add these in the API service's **Environment** tab.

| Key | Value |
| --- | --- |
| `ALLOW_MEMORY_FALLBACK` | `false` |
| `CORS_ORIGIN` | `https://ai-tools-awpa.onrender.com` |
| `HOST` | `0.0.0.0` |
| `LLM_BASE_URL` | `https://api.openai.com/v1` |
| `LLM_MODEL` | `gpt-4.1-mini` |
| `LLM_PROVIDER` | `openai` |
| `LLM_TIMEOUT_MS` | `90000` |
| `MONGO_DB_NAME` | `neatcode` |
| `MONGO_URI` | your MongoDB Atlas URI |
| `OPENAI_API_KEY` | your OpenAI API key |
| `SESSION_SECRET` | a long random string |

Generate `SESSION_SECRET` locally with:

```sh
openssl rand -hex 32
```

Do not use `http://localhost:11434/v1` on Render. `localhost` inside Render means the Render container, not your laptop. Use OpenAI or another publicly reachable OpenAI-compatible endpoint.

## Link The Existing Static UI

After the API deploy succeeds, copy its Render URL. It should look like:

```txt
https://ai-tools-api-6jkb.onrender.com
```

Then open the static site service `ai-tools` and add this rewrite **above** the existing SPA fallback:

| Source | Destination | Action |
| --- | --- | --- |
| `/api/*` | `https://ai-tools-api-6jkb.onrender.com/api/*` | `Rewrite` |
| `/*` | `/index.html` | `Rewrite` |

The `/api/*` rule must be first.

## Smoke Test

Open:

```txt
https://ai-tools-api-6jkb.onrender.com/api/neatcode/health
```

Expected:

- HTTP 200
- `repository.mode` should be `mongo`
- `llm.provider` should be `openai`
