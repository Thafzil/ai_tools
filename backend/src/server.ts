import { createApp } from './app';
import { getServerConfig } from './config';
import { LlmService } from './llm';
import { createRepository } from './repository';

const config = getServerConfig();

async function startServer(): Promise<void> {
  const repository = await createRepository({
    allowMemoryFallback: config.allowMemoryFallback,
    mongoDbName: config.mongoDbName,
    mongoUri: config.mongoUri,
  });
  const llm = new LlmService({
    apiKey: config.llmApiKey,
    baseUrl: config.llmBaseUrl,
    model: config.llmModel,
    provider: config.llmProvider,
    timeoutMs: config.llmTimeoutMs,
  });
  const app = createApp({
    corsOrigins: config.corsOrigins,
    llm,
    repository,
    sessionSecret: config.sessionSecret,
  });

  app.listen(config.port, config.host, () => {
    const health = repository.getHealth();
    console.log(
      `NEATCODE API listening on http://${config.host}:${config.port} (${health.mode}: ${health.detail})`,
    );
  });
}

startServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown API startup error';
  console.error(`NEATCODE API failed to start: ${message}`);
  process.exitCode = 1;
});
