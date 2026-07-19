import vm from 'node:vm';
import {
  type Challenge,
  type ChallengeFetchMock,
  type ChallengeRuntimeCase,
  type JsonValue,
  type RuntimeCaseResult,
  type RuntimeEvaluation,
  type RuntimeExecutionOutcome,
  type RuntimeFetchCall,
} from './domain';

type RuntimeContext = vm.Context & Record<string, unknown>;

const DEFAULT_RUNTIME_TIMEOUT_MS = 800;
const MAX_RUNTIME_CASES = 8;
const RUNTIME_FILENAME = 'neatcode-submission.vm.js';

interface ExecuteOptions {
  args: JsonValue[];
  code: string;
  entryPoint: string;
  fetchMocks: ChallengeFetchMock[];
  timeoutMs: number;
}

function normalizeJson(value: unknown): JsonValue {
  if (value === undefined) {
    return null;
  }

  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || Array.isArray(item) || typeof item !== 'object') {
      return item;
    }

    return Object.keys(item as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = (item as Record<string, unknown>)[key];
        return sorted;
      }, {});
  });
}

function publicOutcome(outcome: RuntimeExecutionOutcome): RuntimeExecutionOutcome {
  return {
    error: outcome.error,
    fetchCalls: outcome.fetchCalls,
    status: outcome.status,
    value: outcome.value,
  };
}

function equivalentOutcome(
  left: RuntimeExecutionOutcome,
  right: RuntimeExecutionOutcome,
): boolean {
  return stableStringify(publicOutcome(left)) === stableStringify(publicOutcome(right));
}

function createFetchMock(fetchMocks: ChallengeFetchMock[], fetchCalls: RuntimeFetchCall[]) {
  let index = 0;

  return async (url: unknown, options: { body?: unknown; method?: string } = {}) => {
    const mock = fetchMocks[index] ?? fetchMocks[fetchMocks.length - 1] ?? { json: {}, ok: true };
    index += 1;
    fetchCalls.push({
      body: typeof options.body === 'string' ? options.body : options.body ? stableStringify(options.body) : undefined,
      method: options.method || 'GET',
      url: String(url),
    });

    return {
      ok: mock.ok ?? true,
      status: mock.status ?? (mock.ok === false ? 500 : 200),
      json: async () => normalizeJson(mock.json ?? {}),
      text: async () => mock.text ?? (mock.json ? stableStringify(mock.json) : ''),
    };
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      windowlessSetTimeout(() => reject(new Error(`Execution timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

const windowlessSetTimeout = setTimeout;

async function executeJavaScript(options: ExecuteOptions): Promise<RuntimeExecutionOutcome> {
  const fetchCalls: RuntimeFetchCall[] = [];
  const context = vm.createContext({
    console: {
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
      log: () => undefined,
      warn: () => undefined,
    },
    fetch: createFetchMock(options.fetchMocks, fetchCalls),
    globalThis: undefined,
    setTimeout,
  }) as RuntimeContext;
  context['globalThis'] = context;
  context['__args'] = options.args;

  try {
    const script = new vm.Script(
      `${options.code}
globalThis.__runtimePromise = (async () => {
  const entry = typeof ${options.entryPoint} !== 'undefined' ? ${options.entryPoint} : undefined;
  if (typeof entry !== 'function') {
    throw new Error('Entry function "${options.entryPoint}" was not found.');
  }
  return await entry(...globalThis.__args);
})();`,
      { filename: RUNTIME_FILENAME },
    );

    script.runInContext(context, { timeout: options.timeoutMs });
    const value = await withTimeout(Promise.resolve(context['__runtimePromise']), options.timeoutMs);

    return {
      fetchCalls,
      status: 'returned',
      value: normalizeJson(value),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      fetchCalls,
      status: 'threw',
    };
  }
}

async function evaluateCase(
  challenge: Challenge,
  submittedCode: string,
  testCase: ChallengeRuntimeCase,
  timeoutMs: number,
): Promise<RuntimeCaseResult> {
  const commonOptions = {
    args: testCase.args,
    entryPoint: challenge.runtime?.entryPoint || '',
    fetchMocks: testCase.fetchMocks ?? [],
    timeoutMs,
  };
  const [baseline, submitted] = await Promise.all([
    executeJavaScript({ ...commonOptions, code: challenge.startingCode }),
    executeJavaScript({ ...commonOptions, code: submittedCode }),
  ]);
  const passed = equivalentOutcome(baseline, submitted);

  return {
    args: testCase.args,
    baseline,
    name: testCase.name,
    passed,
    submitted,
  };
}

export async function evaluateRuntimeBehavior(
  challenge: Challenge,
  submittedCode: string,
): Promise<RuntimeEvaluation> {
  const runtime = challenge.runtime;

  if (!runtime?.entryPoint || !runtime.testCases?.length) {
    return {
      cases: [],
      message: 'No runnable runtime scenarios are available for this question yet.',
      passed: false,
      passedCount: 0,
      total: 0,
    };
  }

  const timeoutMs = runtime.timeoutMs ?? DEFAULT_RUNTIME_TIMEOUT_MS;
  const cases = await Promise.all(
    runtime.testCases.slice(0, MAX_RUNTIME_CASES).map((testCase) =>
      evaluateCase(challenge, submittedCode, testCase, timeoutMs),
    ),
  );
  const passedCount = cases.filter((testCase) => testCase.passed).length;

  return {
    cases,
    entryPoint: runtime.entryPoint,
    message: `${passedCount}/${cases.length} runtime scenarios matched the original output.`,
    passed: passedCount === cases.length,
    passedCount,
    total: cases.length,
  };
}

export async function executeChallengeCode(
  challenge: Challenge,
  code: string,
  args: JsonValue[],
): Promise<RuntimeExecutionOutcome> {
  const runtime = challenge.runtime;

  if (!runtime?.entryPoint) {
    return {
      error: 'No public function is available for this question yet.',
      fetchCalls: [],
      status: 'threw',
    };
  }

  return await executeJavaScript({
    args,
    code,
    entryPoint: runtime.entryPoint,
    fetchMocks: [],
    timeoutMs: runtime.timeoutMs ?? DEFAULT_RUNTIME_TIMEOUT_MS,
  });
}
