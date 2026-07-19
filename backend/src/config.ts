import dotenv from 'dotenv';

dotenv.config({ path: 'backend/.env', quiet: true });
dotenv.config({ quiet: true });

const DEFAULT_CORS_ORIGINS = [
  'http://127.0.0.1:4200',
  'http://localhost:4200',
  'http://127.0.0.1:4301',
  'http://localhost:4301',
  'http://127.0.0.1:4302',
  'http://localhost:4302',
];

const DEFAULT_LLM_MODEL = 'llama3.2:latest';
const DEFAULT_LLM_BASE_URL = 'http://localhost:11434/v1';
const DEFAULT_PORT = 5050;
const DEFAULT_SESSION_SECRET = 'local-neatcode-session-secret-change-me-before-deployment';

export interface ServerConfig {
  allowMemoryFallback: boolean;
  corsOrigins: string[];
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  llmProvider: 'ollama' | 'openai';
  llmTimeoutMs: number;
  mongoDbName: string;
  mongoUri: string;
  nodeEnv: string;
  port: number;
  sessionSecret: string;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseOrigins(value: string | undefined): string[] {
  if (!value) {
    return DEFAULT_CORS_ORIGINS;
  }

  const configuredOrigins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return Array.from(new Set([...DEFAULT_CORS_ORIGINS, ...configuredOrigins]));
}

function buildMongoUri(): string {
  if (process.env['MONGO_URI']) {
    return process.env['MONGO_URI'];
  }

  const host = process.env['MONGO_HOST'];
  const user = process.env['MONGO_USER'];
  const password = process.env['MONGO_PASSWORD'];

  if (!host || !user || !password) {
    return '';
  }

  const protocol =
    host.startsWith('mongodb://') || host.startsWith('mongodb+srv://') ? '' : 'mongodb+srv://';
  const database = process.env['MONGO_DB_NAME'] || 'neatcode';
  const separator = host.includes('?') ? '&' : '?';
  return `${protocol}${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}/${database}${separator}retryWrites=true&w=majority`;
}

export function getServerConfig(): ServerConfig {
  return {
    allowMemoryFallback: parseBoolean(process.env['ALLOW_MEMORY_FALLBACK'], true),
    corsOrigins: parseOrigins(process.env['CORS_ORIGIN']),
    llmApiKey: process.env['LLM_API_KEY'] || process.env['OPENAI_API_KEY'] || 'ollama',
    llmBaseUrl: process.env['LLM_BASE_URL'] || DEFAULT_LLM_BASE_URL,
    llmModel: process.env['LLM_MODEL'] || process.env['MODEL'] || DEFAULT_LLM_MODEL,
    llmProvider: process.env['LLM_PROVIDER'] === 'openai' ? 'openai' : 'ollama',
    llmTimeoutMs: Number(process.env['LLM_TIMEOUT_MS'] || 90_000),
    mongoDbName: process.env['MONGO_DB_NAME'] || 'neatcode',
    mongoUri: buildMongoUri(),
    nodeEnv: process.env['NODE_ENV'] || 'development',
    port: Number(process.env['PORT'] || DEFAULT_PORT),
    sessionSecret: process.env['SESSION_SECRET'] || DEFAULT_SESSION_SECRET,
  };
}
