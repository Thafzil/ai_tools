# AI Tools Workspace

This repository is an Angular shell for small AI-powered tools. The main tool in this workspace is **NEATCODE**, an adaptive JavaScript refactoring practice app.

## NEATCODE

NEATCODE helps users practice refactoring without breaking behavior.

The user signs up, selects a coding level, gets one AI-generated JavaScript question, improves the provided function, runs the code, submits it, and receives a refactoring score only after the output still matches the original function.

The next question adapts from the user's weaker skills, so practice becomes more focused over time.

### What NEATCODE Does

- User signup and login.
- Starting level selection: beginner, intermediate, advanced, or expert.
- AI-generated JavaScript refactoring questions.
- Function-based messy code that the user can improve.
- Runtime execution for the user's code.
- Behavior comparison between original code and submitted code.
- AI scoring only after the output matches.
- Simple result view with score and areas to improve.
- Hints generated for the current question.
- User-specific skill profile, submissions, solved questions, average score, and coded time.
- Adaptive next question based on the user's weaker skills.

### How AI Is Used

AI is used for:

- Generating a new JavaScript question.
- Creating the messy starting code.
- Creating hints for that exact code.
- Scoring the user's refactor after behavior is verified.
- Suggesting areas to improve.

AI is not used as the first correctness check. The backend first runs the original function and the user's function with the same inputs. If the output does not match, scoring is stopped.

### Tech Stack

- Angular 21
- Angular Native Federation for shell and microfrontend loading
- Node.js and Express backend
- MongoDB for persistent users, profiles, challenges, and attempts
- OpenAI-compatible LLM client
- Ollama for quick local AI testing
- OpenAI API for deployed or higher-quality generation

## Local Setup

Install dependencies:

```bash
npm install
```

Create a backend environment file:

```bash
cp backend/.env.example backend/.env
```

Then update `backend/.env` using one of the examples below.

## Quick Local Testing With Ollama

Use this when you want to run NEATCODE locally without OpenAI billing and without MongoDB setup.

Start Ollama:

```bash
ollama serve
```

Pull a small model:

```bash
ollama pull gemma:2b
```

Use this `backend/.env`:

```env
PORT=5050
NODE_ENV=development
HOST=127.0.0.1
CORS_ORIGIN=http://127.0.0.1:4200,http://localhost:4200,http://127.0.0.1:4302,http://localhost:4302
SESSION_SECRET=local-neatcode-session-secret-change-me

ALLOW_MEMORY_FALLBACK=true
MONGO_URI=
MONGO_DB_NAME=neatcode

LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=gemma:2b
LLM_TIMEOUT_MS=90000
```

Notes:

- `ALLOW_MEMORY_FALLBACK=true` lets the backend run without MongoDB.
- Data is temporary in this mode. Users and attempts reset when the API restarts.
- `gemma:2b` is good for fast local testing. If you have a stronger local model, set `LLM_MODEL` to that model name.

## Local Setup With MongoDB

Use this when you want accounts, attempts, scores, and generated questions to persist.

```env
PORT=5050
NODE_ENV=development
HOST=127.0.0.1
CORS_ORIGIN=http://127.0.0.1:4200,http://localhost:4200,http://127.0.0.1:4302,http://localhost:4302
SESSION_SECRET=replace-with-a-long-random-secret

ALLOW_MEMORY_FALLBACK=false
MONGO_URI=mongodb+srv://<user>:<password>@<cluster-host>/neatcode?retryWrites=true&w=majority
MONGO_DB_NAME=neatcode

LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=gemma:2b
LLM_TIMEOUT_MS=90000
```

`MONGO_URI` must be the full MongoDB connection string. Username and password alone are not enough because MongoDB also needs the host or Atlas cluster address.

## Using OpenAI Instead Of Ollama

Use this for deployed environments or better question/scoring quality.

```env
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=<your-openai-api-key>
LLM_MODEL=<your-model-name>
LLM_TIMEOUT_MS=90000
```

Keep secrets out of source control. Do not commit `backend/.env`.

## Run NEATCODE Locally

Start the backend API:

```bash
npm run api
```

Check API health:

```bash
curl http://127.0.0.1:5050/api/neatcode/health
```

Start the NEATCODE standalone microfrontend:

```bash
npm run start:neatcode
```

Open:

```text
http://127.0.0.1:4302/
```

## Run Through The Shell App

For the full shell experience, run the backend, the NEATCODE remote, and the shell app.

Terminal 1:

```bash
npm run api
```

Terminal 2:

```bash
npm run start:neatcode
```

Terminal 3:

```bash
npm start
```

Open:

```text
http://127.0.0.1:4200/tools/neatcode
```

The shell loads NEATCODE from:

```text
http://127.0.0.1:4302/remoteEntry.json
```

API calls are proxied to:

```text
http://127.0.0.1:5050/api
```

## Useful Commands

```bash
# Backend type check
npm run api:check

# Build backend for deployment
npm run build:render:api

# Build shell app
npm run build

# Build NEATCODE remote
npm run build:neatcode

# Build all UI targets for Render static deployment
npm run build:render:ui
```

## Project Structure

```text
backend/src/
  app.ts          NEATCODE API routes
  auth.ts         Password hashing and signed sessions
  config.ts       Environment configuration
  llm.ts          AI question generation and scoring
  repository.ts   MongoDB and memory repositories
  runtime.ts      JavaScript execution and behavior comparison
  scoring.ts      Deterministic scoring helpers

src/app/tools/neatcode-academy/
  neatcode-academy.component.ts      Main NEATCODE UI logic
  neatcode-academy.component.html    NEATCODE UI template
  neatcode-academy.component.scss    NEATCODE styling
  neatcode-api.service.ts            Frontend API client
  neatcode.types.ts                  Frontend API types

src/neatcode/
  main.ts        Standalone NEATCODE remote bootstrap
```

## Main Routes

- Shell home: `http://127.0.0.1:4200/`
- NEATCODE in shell: `http://127.0.0.1:4200/tools/neatcode`
- NEATCODE standalone remote: `http://127.0.0.1:4302/`
- NEATCODE API health: `http://127.0.0.1:5050/api/neatcode/health`

## Render Deployment Notes

Backend service:

```bash
npm ci && npm run build:render:api
```

Start command:

```bash
npm run api:start
```

Static UI build:

```bash
npm ci && npm run build:render:ui
```

Render rewrite rules for static UI should send `/api/*` to the backend service before the catch-all app route.

## Markdown Studio

Markdown Studio is the other tool in this workspace. It lets users write or paste Markdown, inspect generated HTML, and view AST/tree output. It is also exposed as a Native Federation remote, but NEATCODE is the primary app for this project demo.
