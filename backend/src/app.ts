import cors from 'cors';
import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { z } from 'zod';
import {
  createSessionToken,
  hashPassword,
  normalizeEmail,
  publicUser,
  verifyPassword,
  verifySessionToken,
} from './auth';
import { evaluateRuntimeBehavior, executeChallengeCode } from './runtime';
import { getScoreForSkill } from './scoring';
import {
  createDefaultProfile,
  type NeatCodeRepository,
  summarizeChallenges,
  updateProfileAfterAttempt,
} from './repository';
import {
  skillIds,
  type Challenge,
  type CodingLevel,
  type EvaluationFeedback,
  type JsonValue,
  type PublicUser,
  type RuntimeEvaluation,
  type ScoreBreakdown,
  type SkillId,
  type UserAccount,
  type UserProfile,
} from './domain';
import { type LlmService } from './llm';

export interface CreateAppOptions {
  corsOrigins: string[];
  llm: LlmService;
  repository: NeatCodeRepository;
  sessionSecret: string;
}

interface AuthenticatedRequest extends Request {
  account: UserAccount;
  user: PublicUser;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
  }
}

interface PracticeStats {
  acceptedSubmissions: number;
  totalPracticeSeconds: number;
  totalSubmissions: number;
}

const starterSkillOrder: SkillId[] = [
  'readability',
  'naming',
  'complexity',
  'error-handling',
  'testing',
  'modularity',
  'security',
  'async-programming',
  'performance',
  'restraint',
  'code-review',
  'architecture',
];

const signupSchema = z.object({
  codingLevel: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).default('beginner'),
  displayName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(180),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(180),
  password: z.string().min(1).max(200),
});

const submitSchema = z.object({
  code: z.string().min(1),
  durationSeconds: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60)
    .default(0),
  explanation: z.string().max(2000).default(''),
  hintsUsed: z.number().int().min(0).max(5).default(0),
});

const hintSchema = z.object({
  level: z.number().int().min(1).max(5),
});

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const runSchema = z.object({
  args: z.array(jsonValueSchema).max(6).default([]),
  code: z.string().min(1).max(30000),
});

function publicChallenge(challenge: Challenge): Omit<
  Challenge,
  'evaluation' | 'generatedBy' | 'generationReason' | 'hiddenTargets'
> & {
  hintCount: number;
} {
  const {
    evaluation: _evaluation,
    generatedBy: _generatedBy,
    generationReason: _generationReason,
    hiddenTargets: _hiddenTargets,
    ...visibleChallenge
  } = challenge;

  return {
    ...visibleChallenge,
    hintCount: challenge.hints.length,
  };
}

function createCorsOptions(corsOrigins: string[]): cors.CorsOptions {
  return {
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin not allowed: ${origin}`));
    },
  };
}

function selectPracticeSkills(
  profile: Pick<UserProfile, 'skillScores' | 'totalAttempts'>,
): SkillId[] {
  if (profile.totalAttempts === 0) {
    return starterSkillOrder;
  }

  return skillIds
    .map((skill) => ({ skill, score: profile.skillScores[skill] }))
    .sort((left, right) => left.score - right.score)
    .map((item) => item.skill);
}

function chooseFocusSkill(profile: Pick<UserProfile, 'skillScores' | 'totalAttempts'>): SkillId {
  const orderedSkills = selectPracticeSkills(profile);
  const candidateCount = Math.min(3, orderedSkills.length);
  const candidates = orderedSkills.slice(0, candidateCount);
  return candidates[Math.floor(Math.random() * candidates.length)] ?? orderedSkills[0];
}

function getActiveChallenges(profile: UserProfile, challenges: Challenge[]): Challenge[] {
  return challenges.filter((challenge) => !profile.completedChallenges.includes(challenge.id));
}

function getNewestChallenge(challenges: Challenge[]): Challenge {
  return [...challenges].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function hasValidJavaScriptSyntax(source: string): boolean {
  try {
    new vm.Script(source);
    return true;
  } catch {
    return false;
  }
}

function hasRunnableContract(challenge: Challenge): boolean {
  return Boolean(
    challenge.contractVersion === 3 &&
    challenge.hints?.length &&
    challenge.runtime?.entryPoint &&
    challenge.runtime.testCases?.length &&
    hasValidJavaScriptSyntax(challenge.startingCode) &&
    hasValidJavaScriptSyntax(challenge.referenceCode),
  );
}

async function buildPracticeStats(
  repository: NeatCodeRepository,
  userId: string,
): Promise<PracticeStats> {
  const attempts = await repository.listAttempts(userId, 1000);

  return {
    acceptedSubmissions: attempts.filter((attempt) => attempt.feedback.runtimeEvaluation?.passed).length,
    totalPracticeSeconds: attempts.reduce(
      (total, attempt) => total + Math.max(0, attempt.durationSeconds || 0),
      0,
    ),
    totalSubmissions: attempts.length,
  };
}

function zeroScore(): ScoreBreakdown {
  return {
    codeQuality: 0,
    complexity: 0,
    correctness: 0,
    errorHandling: 0,
    independence: 0,
    modularity: 0,
    naming: 0,
    reasoning: 0,
    restraint: 0,
    testability: 0,
    total: 0,
  };
}

function behaviorGateFeedback(runtimeEvaluation: RuntimeEvaluation): EvaluationFeedback {
  return {
    coachNote:
      'Output changed, so scoring is paused until the refactor matches the original behavior.',
    improvements: [],
    missedIssues: [],
    nextRecommendation:
      'Run the function again and make every runtime scenario match before submitting for AI scoring.',
    regressions: [
      'The submitted code does not match the original output for every runtime scenario.',
    ],
    reviewAnnotations: [
      {
        detail:
          'The first fix is behavioral: make the returned value, thrown error, and fetch calls match the original code.',
        lineNumber: 1,
        title: 'Output changed',
        type: 'improvement',
      },
    ],
    runtimeEvaluation,
    score: zeroScore(),
  };
}

async function createPracticeChallenge(
  repository: NeatCodeRepository,
  llm: LlmService,
  profile: UserProfile,
): Promise<Challenge> {
  const existingChallenges = await repository.listChallenges(profile.userId);
  const recentTitles = existingChallenges.map((challenge) => challenge.title).slice(-10);
  const challenge = await llm
    .generateChallenge({
      focusSkill: chooseFocusSkill(profile),
      profile,
      recentTitles,
    })
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`AI challenge generation failed: ${detail}`);
      throw new ApiError(
        'AI question generation could not create a valid JavaScript challenge. Please try again.',
        503,
      );
    });

  await repository.saveChallenge(challenge);
  return challenge;
}

async function ensureCurrentChallenge(
  repository: NeatCodeRepository,
  llm: LlmService,
  profile: UserProfile,
): Promise<Challenge> {
  const existingChallenges = await repository.listChallenges(profile.userId);
  const activeChallenges = getActiveChallenges(profile, existingChallenges);

  if (activeChallenges.length) {
    const runnableChallenges = activeChallenges.filter(hasRunnableContract);

    if (runnableChallenges.length) {
      return getNewestChallenge(runnableChallenges);
    }
  }

  return createPracticeChallenge(repository, llm, profile);
}

function authMiddleware(
  repository: NeatCodeRepository,
  sessionSecret: string,
): (request: Request, response: Response, next: NextFunction) => Promise<void> {
  return async (request, _response, next) => {
    try {
      const header = request.header('authorization') || '';
      const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
      const payload = token ? verifySessionToken(token, sessionSecret) : null;

      if (!payload) {
        throw new ApiError('Authentication required.', 401);
      }

      const account = await repository.findUserById(payload.sub);

      if (!account) {
        throw new ApiError('Session user was not found.', 401);
      }

      (request as AuthenticatedRequest).account = account;
      (request as AuthenticatedRequest).user = publicUser(account);
      next();
    } catch (error) {
      next(error);
    }
  };
}

function buildAuthResponse(
  account: UserAccount,
  sessionSecret: string,
): {
  token: string;
  user: PublicUser;
} {
  return {
    token: createSessionToken(account.id, sessionSecret),
    user: publicUser(account),
  };
}

export function createApp(options: CreateAppOptions): express.Express {
  const app = express();
  const { llm, repository, sessionSecret } = options;
  const requireAuth = authMiddleware(repository, sessionSecret);

  app.use(cors(createCorsOptions(options.corsOrigins)));
  app.use(express.json({ limit: '1mb' }));

  app.get('/', (_request, response) => {
    response.json({
      health: '/api/neatcode/health',
      ok: true,
      service: 'neatcode-api',
    });
  });

  app.get('/api/neatcode/health', (_request, response) => {
    response.json({
      llm: {
        model: process.env['LLM_MODEL'] || process.env['MODEL'] || 'llama3.2:latest',
        provider: llm.getProviderLabel(),
      },
      ok: true,
      store: repository.getHealth(),
      service: 'neatcode-api',
    });
  });

  app.post('/api/neatcode/auth/signup', async (request, response, next) => {
    try {
      const payload = signupSchema.parse(request.body);
      const email = normalizeEmail(payload.email);
      const existingUser = await repository.findUserByEmail(email);

      if (existingUser) {
        throw new ApiError('An account already exists for this email.', 409);
      }

      const password = hashPassword(payload.password);
      const now = new Date().toISOString();
      const account = await repository.createUser({
        createdAt: now,
        displayName: payload.displayName,
        email,
        id: randomUUID(),
        passwordHash: password.hash,
        passwordSalt: password.salt,
        updatedAt: now,
      });
      await repository.saveProfile(
        createDefaultProfile(account.id, account.displayName, payload.codingLevel as CodingLevel),
      );

      response.status(201).json(buildAuthResponse(account, sessionSecret));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/neatcode/auth/login', async (request, response, next) => {
    try {
      const payload = loginSchema.parse(request.body);
      const account = await repository.findUserByEmail(normalizeEmail(payload.email));

      if (!account || !verifyPassword(payload.password, account)) {
        throw new ApiError('Email or password is incorrect.', 401);
      }

      response.json(buildAuthResponse(account, sessionSecret));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/neatcode/session', requireAuth, async (request, response, next) => {
    try {
      const authRequest = request as AuthenticatedRequest;
      const profile = await repository.getProfile(authRequest.account.id);
      response.json({ profile, user: authRequest.user });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/neatcode/bootstrap', requireAuth, async (request, response, next) => {
    try {
      const authRequest = request as AuthenticatedRequest;
      const [profile, lastAttempt, stats] = await Promise.all([
        repository.getProfile(authRequest.account.id),
        repository.getLastAttempt(authRequest.account.id),
        buildPracticeStats(repository, authRequest.account.id),
      ]);
      const recommendedChallenge = await ensureCurrentChallenge(repository, llm, profile);

      response.json({
        challenges: summarizeChallenges([recommendedChallenge]),
        lastAttempt,
        profile,
        recommendedChallenge: publicChallenge(recommendedChallenge),
        stats,
        user: authRequest.user,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/neatcode/challenges', requireAuth, async (request, response, next) => {
    try {
      const authRequest = request as AuthenticatedRequest;
      const profile = await repository.getProfile(authRequest.account.id);
      const currentChallenge = await ensureCurrentChallenge(repository, llm, profile);

      response.json({
        challenges: summarizeChallenges([currentChallenge]),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/neatcode/challenges/:challengeId', requireAuth, async (request, response, next) => {
    try {
      const authRequest = request as AuthenticatedRequest;
      const challengeId = String(request.params['challengeId'] || '');
      const challenge = await repository.getChallenge(authRequest.account.id, challengeId);

      if (!challenge) {
        throw new ApiError('Challenge not found.', 404);
      }

      response.json({ challenge: publicChallenge(challenge) });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    '/api/neatcode/challenges/:challengeId/hints',
    requireAuth,
    async (request, response, next) => {
      try {
        const authRequest = request as AuthenticatedRequest;
        const payload = hintSchema.parse(request.body);
        const challengeId = String(request.params['challengeId'] || '');
        const challenge = await repository.getChallenge(authRequest.account.id, challengeId);

        if (!challenge) {
          throw new ApiError('Challenge not found.', 404);
        }

        const hint = challenge.hints.find((item) => item.level === payload.level);

        if (!hint) {
          throw new ApiError('Hint not found.', 404);
        }

        response.json({ hint });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/neatcode/challenges/:challengeId/run',
    requireAuth,
    async (request, response, next) => {
      try {
        const authRequest = request as AuthenticatedRequest;
        const payload = runSchema.parse(request.body);
        const challengeId = String(request.params['challengeId'] || '');
        const challenge = await repository.getChallenge(authRequest.account.id, challengeId);

        if (!challenge) {
          throw new ApiError('Challenge not found.', 404);
        }

        const outcome = await executeChallengeCode(challenge, payload.code, payload.args);
        response.json({ outcome });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/neatcode/challenges/:challengeId/submit',
    requireAuth,
    async (request, response, next) => {
      try {
        const authRequest = request as AuthenticatedRequest;
        const payload = submitSchema.parse(request.body);
        const challengeId = String(request.params['challengeId'] || '');
        const challenge = await repository.getChallenge(authRequest.account.id, challengeId);

        if (!challenge) {
          throw new ApiError('Challenge not found.', 404);
        }

        const runtimeEvaluation = await evaluateRuntimeBehavior(challenge, payload.code);
        const existingProfile = await repository.getProfile(authRequest.account.id);

        if (!runtimeEvaluation.passed) {
          const attempt = await repository.saveAttempt({
            challengeId: challenge.id,
            createdAt: new Date().toISOString(),
            durationSeconds: payload.durationSeconds,
            explanation: payload.explanation,
            feedback: behaviorGateFeedback(runtimeEvaluation),
            hintsUsed: payload.hintsUsed,
            id: randomUUID(),
            submittedCode: payload.code,
            userId: authRequest.account.id,
          });

          response.status(200).json({
            accepted: false,
            attempt,
            nextChallenge: null,
            profile: existingProfile,
            stats: await buildPracticeStats(repository, authRequest.account.id),
          });
          return;
        }

        const feedback = await llm
          .scoreSubmission({
            challenge,
            durationSeconds: payload.durationSeconds,
            explanation: payload.explanation,
            hintsUsed: payload.hintsUsed,
            runtimeEvaluation,
            submittedCode: payload.code,
          })
          .catch(() => {
            throw new ApiError('AI scoring could not complete. Please try submitting again.', 503);
          });
        const attempt = await repository.saveAttempt({
          challengeId: challenge.id,
          createdAt: new Date().toISOString(),
          durationSeconds: payload.durationSeconds,
          explanation: payload.explanation,
          feedback,
          hintsUsed: payload.hintsUsed,
          id: randomUUID(),
          submittedCode: payload.code,
          userId: authRequest.account.id,
        });
        const profile = updateProfileAfterAttempt(existingProfile, challenge, (skill) =>
          getScoreForSkill(feedback, skill),
        );
        await repository.saveProfile(profile);
        const stats = await buildPracticeStats(repository, authRequest.account.id);

        const nextChallenge = await createPracticeChallenge(repository, llm, profile).catch(
          (error: unknown) => {
            const detail = error instanceof Error ? error.message : String(error);
            console.warn(`Next adaptive question generation failed after scoring: ${detail}`);
            return null;
          },
        );

        response.status(201).json({
          accepted: true,
          attempt,
          nextChallenge: nextChallenge ? publicChallenge(nextChallenge) : null,
          profile,
          stats,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({
        issues: error.issues,
        message: 'Invalid request payload',
      });
      return;
    }

    if (error instanceof ApiError) {
      response.status(error.status).json({ message: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : 'Unexpected server error';
    response.status(500).json({ message });
  };

  app.use(errorHandler);

  return app;
}
