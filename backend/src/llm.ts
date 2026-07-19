import OpenAI from 'openai';
import vm from 'node:vm';
import { z } from 'zod';
import {
  skillIds,
  type Challenge,
  type ChallengeDifficulty,
  type ChallengeHint,
  type CodeAnalysisResult,
  type EvaluationFeedback,
  type JsonValue,
  type RuntimeEvaluation,
  type ScoreBreakdown,
  type SkillId,
  type UserProfile,
} from './domain';

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: 'ollama' | 'openai';
  timeoutMs: number;
}

interface GenerateChallengeOptions {
  focusSkill: SkillId;
  profile: UserProfile;
  recentTitles: string[];
}

interface CoachFeedbackOptions {
  challenge: Challenge;
  deterministicFeedback: EvaluationFeedback;
  explanation: string;
  submittedCode: string;
}

interface ScoreSubmissionOptions {
  challenge: Challenge;
  durationSeconds: number;
  explanation: string;
  hintsUsed: number;
  runtimeEvaluation: RuntimeEvaluation;
  submittedCode: string;
}

const PLACEHOLDER_FUNCTION_NAMES = new Set([
  'functionName',
  'solution',
  'processData',
  'clean',
  'refactor',
]);
const PLACEHOLDER_METADATA_TITLES = new Set([
  'product problem title',
  'javascript refactor challenge',
  'short challenge title',
]);
const PLACEHOLDER_METADATA_TAGS = new Set(['code-topic', 'tag']);
const INCOMPLETE_CODE_PATTERN =
  /TODO|Code goes here|Return the new object|placeholder|your code here/i;

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

const generatedFetchMockSchema = z.object({
  json: jsonValueSchema.optional(),
  ok: z.boolean().optional(),
  status: z.number().int().min(100).max(599).optional(),
  text: z.string().optional(),
});

const generatedRuntimeCaseSchema = z.object({
  args: z.array(jsonValueSchema).max(6),
  fetchMocks: z.array(generatedFetchMockSchema).max(4).optional(),
  name: z.string().min(3).max(80),
});

const generatedHintSchema = z.object({
  body: z.string().min(24).max(420),
  title: z.string().min(3).max(80),
});

const generatedStringArraySchema = z.array(z.coerce.string().min(1).max(120)).catch([]);

const generatedChallengeShape = z.object({
  antiPatterns: generatedStringArraySchema,
  applicationContext: z.string().min(3).max(80),
  description: z.string().min(20).max(1200),
  difficulty: z.coerce.string().optional().catch(undefined),
  entryPoint: z.coerce.string().default(''),
  estimateMinutes: z.number().int().min(5).max(30),
  expectedTerms: generatedStringArraySchema,
  hints: z.array(generatedHintSchema).min(3).max(5),
  insertedProblems: generatedStringArraySchema,
  messyCode: z.string().min(80).max(7000),
  preferredTerms: generatedStringArraySchema,
  referenceCode: z.string().min(80).max(7000),
  requirements: z.array(z.coerce.string().min(5).max(260)).catch([]),
  tags: z.array(z.coerce.string().min(2).max(40)).catch([]),
  testCases: z.array(generatedRuntimeCaseSchema).min(1),
  title: z.string().min(6).max(80),
  visibleProblems: z.array(z.string()).optional(),
});

const generatedChallengeSchema = generatedChallengeShape.superRefine((value, context) => {
  const entryPoint = resolveEntryPoint(value.entryPoint, value.messyCode, value.referenceCode);

  if (!entryPoint) {
    context.addIssue({
      code: 'custom',
      message: 'entryPoint must identify a function defined by both messyCode and referenceCode.',
      path: ['entryPoint'],
    });
  } else if (PLACEHOLDER_FUNCTION_NAMES.has(entryPoint)) {
    context.addIssue({
      code: 'custom',
      message: 'entryPoint must be an original domain-specific function name, not a placeholder.',
      path: ['entryPoint'],
    });
  }
});

const generatedMetadataShape = z.object({
  antiPatterns: generatedStringArraySchema,
  applicationContext: z.coerce.string().min(3).max(80),
  description: z.coerce
    .string()
    .min(20)
    .max(1200),
  estimateMinutes: z.coerce.number().int().min(5).max(30).catch(12),
  expectedTerms: generatedStringArraySchema,
  hints: z.array(generatedHintSchema).min(3).max(5),
  insertedProblems: generatedStringArraySchema,
  preferredTerms: generatedStringArraySchema,
  requirements: z.array(z.coerce.string().min(5).max(260)).catch([]),
  tags: z.array(z.coerce.string().min(2).max(40)).catch([]),
  title: z.coerce.string().min(6).max(80),
});

const generatedMetadataSchema = generatedMetadataShape.superRefine((value, context) => {
  const title = value.title.trim().toLowerCase();
  const normalizedTags = value.tags.map((tag) => tag.trim().toLowerCase());

  if (PLACEHOLDER_METADATA_TITLES.has(title)) {
    context.addIssue({
      code: 'custom',
      message: 'title must be a specific generated product problem title, not a placeholder.',
      path: ['title'],
    });
  }

  if (normalizedTags.some((tag) => PLACEHOLDER_METADATA_TAGS.has(tag))) {
    context.addIssue({
      code: 'custom',
      message: 'tags must be specific learner-facing code tags, not placeholder labels.',
      path: ['tags'],
    });
  }

  value.hints.forEach((hint, index) => {
    const text = `${hint.title} ${hint.body}`.toLowerCase();

    if (/\b(clean up the code|main pain|check as you go|lock the behavior|look for the part)\b/.test(text)) {
      context.addIssue({
        code: 'custom',
        message: 'hints must point to concrete code areas, not generic coaching.',
        path: ['hints', index],
      });
    }
  });
});

const stagedRuntimeCaseSchema = z.object({
  args: z.unknown(),
  fetchMocks: z.array(generatedFetchMockSchema).max(4).optional(),
  name: z.coerce.string().min(3).max(80).catch('Runtime scenario'),
});

const stagedRuntimeCasesSchema = z.object({
  testCases: z.array(z.unknown()).transform((items, context) => {
    const runtimeCases = items.flatMap((item) => {
      const parsed = stagedRuntimeCaseSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });

    if (runtimeCases.length < 3) {
      context.addIssue({
        code: 'custom',
        message: 'At least three valid runtime scenario objects are required.',
      });
    }

    return runtimeCases;
  }),
});

const coachSchema = z.object({
  coachNote: z.string().min(20).max(360),
  improvements: z.array(z.string().min(5).max(160)).min(1).max(5),
  missedIssues: z.array(z.string().min(5).max(160)).max(5),
  nextRecommendation: z.string().min(12).max(220),
  regressions: z.array(z.string().min(5).max(160)).max(5),
});

const scoreNumberSchema = z.coerce.number().catch(0);

const scoreBreakdownSchema = z.object({
  codeQuality: scoreNumberSchema,
  complexity: scoreNumberSchema,
  correctness: scoreNumberSchema,
  errorHandling: scoreNumberSchema,
  independence: scoreNumberSchema,
  modularity: scoreNumberSchema,
  naming: scoreNumberSchema,
  reasoning: scoreNumberSchema,
  restraint: scoreNumberSchema,
  testability: scoreNumberSchema,
  total: scoreNumberSchema,
}).catch({
  codeQuality: 0,
  complexity: 0,
  correctness: 100,
  errorHandling: 0,
  independence: 0,
  modularity: 0,
  naming: 0,
  reasoning: 0,
  restraint: 0,
  testability: 0,
  total: 0,
});

const reviewAnnotationSchema = z.object({
  detail: z.coerce.string().catch('Review this line for the focus skill.'),
  lineNumber: z.coerce.number().int().min(1).max(1000).catch(1),
  title: z.coerce.string().catch('Review note'),
  type: z.enum(['improvement', 'mastered']).catch('improvement'),
});

const aiScoreSchema = z.object({
  coachNote: z.coerce.string().catch('AI reviewed the refactor after the output matched.'),
  improvements: z.array(z.coerce.string()).catch([]),
  missedIssues: z.array(z.coerce.string()).catch([]),
  nextRecommendation: z.coerce.string().catch('Keep practicing the current focus skill.'),
  regressions: z.array(z.coerce.string()).catch([]),
  reviewAnnotations: z.array(reviewAnnotationSchema).catch([]),
  score: scoreBreakdownSchema,
});

const analysisScoreSchema = z.object({
  rationale: z.string().min(8).max(180),
  skill: z.enum(skillIds),
  value: z.number().min(0).max(100),
});

const analysisSchema = z.object({
  issues: z
    .array(
      z.object({
        category: z.enum(skillIds),
        detail: z.string().min(12).max(240),
        severity: z.enum(['low', 'medium', 'high']),
        title: z.string().min(3).max(80),
      }),
    )
    .max(6),
  recommendedSkill: z.enum(skillIds),
  scores: z.array(analysisScoreSchema).min(3).max(6),
  strengths: z.array(z.string().min(5).max(160)).max(4),
  summary: z.string().min(8).max(220),
});

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 72);
}

function extractJsonObject(content: string): unknown {
  const withoutFence = content.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');

  if (start < 0 || end <= start) {
    throw new Error('The model did not return a JSON object.');
  }

  return JSON.parse(withoutFence.slice(start, end + 1));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isJavaScriptIdentifier(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}

function extractDefinedEntryPoints(source: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) {
        names.add(match[1]);
      }
    }
  }

  return Array.from(names);
}

function hasEntryPoint(source: string, entryPoint: string): boolean {
  const entryPattern = new RegExp(
    `\\b(function\\s+${escapeRegExp(entryPoint)}\\s*\\(|(?:const|let|var)\\s+${escapeRegExp(entryPoint)}\\s*=)`,
  );
  return entryPattern.test(source);
}

function resolveEntryPoint(
  declaredEntryPoint: string,
  messyCode: string,
  referenceCode: string,
): string | null {
  const declared = declaredEntryPoint.trim();

  if (
    isJavaScriptIdentifier(declared) &&
    hasEntryPoint(messyCode, declared) &&
    hasEntryPoint(referenceCode, declared)
  ) {
    return declared;
  }

  const referenceNames = new Set(extractDefinedEntryPoints(referenceCode));
  return extractDefinedEntryPoints(messyCode).find((name) => referenceNames.has(name)) ?? null;
}

function extractParameterCount(source: string, entryPoint: string): number {
  const escapedEntryPoint = escapeRegExp(entryPoint);
  const patterns = [
    new RegExp(`\\bfunction\\s+${escapedEntryPoint}\\s*\\(([^)]*)\\)`),
    new RegExp(`\\b(?:const|let|var)\\s+${escapedEntryPoint}\\s*=\\s*(?:async\\s*)?\\(([^)]*)\\)\\s*=>`),
    new RegExp(`\\b(?:const|let|var)\\s+${escapedEntryPoint}\\s*=\\s*(?:async\\s*)?([A-Za-z_$][\\w$]*)\\s*=>`),
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);

    if (match?.[1]) {
      return match[1]
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean).length || 1;
    }
  }

  return 1;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) {
    return null;
  }

  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function normalizeGeneratedArgs(args: unknown, parameterCount: number): JsonValue[] {
  if (!Array.isArray(args)) {
    return [toJsonValue(args)];
  }

  if (parameterCount <= 1 && args.length !== 1) {
    return [toJsonValue(args)];
  }

  return args.map((arg) => toJsonValue(arg));
}

function normalizeGeneratedRuntimeCases(
  rawCases: z.infer<typeof stagedRuntimeCaseSchema>[],
  parameterCount: number,
): z.infer<typeof generatedRuntimeCaseSchema>[] {
  return rawCases.slice(0, 5).map((testCase, index) => ({
    args: normalizeGeneratedArgs(testCase.args, parameterCount),
    fetchMocks: testCase.fetchMocks,
    name: testCase.name || `Runtime scenario ${index + 1}`,
  }));
}

function cleanCodeFence(value: string): string {
  return value
    .replace(/```(?:javascript|js)?/gi, '')
    .replace(/```/g, '')
    .trim();
}

function codeCandidateFromResponse(value: string): string {
  const cleaned = cleanCodeFence(value);
  const codeStart = cleaned.search(/\b(?:async\s+function|function|const|let|var)\s+[A-Za-z_$][\w$]*/);

  return codeStart > 0 ? cleaned.slice(codeStart).trim() : cleaned;
}

function hasValidJavaScriptSyntax(source: string): boolean {
  try {
    new vm.Script(source);
    return true;
  } catch {
    return false;
  }
}

function cleanArray(value: string[] | undefined, fallback: string[], limit: number): string[] {
  const items = (value?.length ? value : fallback)
    .flatMap((item) => item.split(/\n|;|\.\s+/))
    .map((item) => item.trim().replace(/^[-*\d.)\s]+/, ''))
    .filter(Boolean);

  return Array.from(new Set(items)).slice(0, limit);
}

function publicRequirementsFor(focusSkill: SkillId): string[] {
  const focus = focusSkill
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  return [
    'Run the code and keep the output exactly the same as the original.',
    `Improve the code mainly in ${focus}.`,
    'Keep the public function name, inputs, returns, errors, and fetch calls stable.',
  ];
}

function cleanTags(value: string[]): string[] {
  return cleanArray(value, [], 6)
    .map((tag) => tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''))
    .filter((tag) => !/^(formatting|spacing|indentation|semicolons?)$/.test(tag))
    .filter(Boolean)
    .slice(0, 6);
}

function cleanHints(value: z.infer<typeof generatedHintSchema>[]): ChallengeHint[] {
  return value.slice(0, 5).map((hint, index) => ({
    body: hint.body.trim(),
    level: index + 1,
    title: hint.title.trim(),
  }));
}

function clampScore(value: number): number {
  return Math.min(Math.max(Math.round(value), 0), 100);
}

function normalizeScore(score: z.infer<typeof scoreBreakdownSchema>): ScoreBreakdown {
  return {
    codeQuality: clampScore(score.codeQuality),
    complexity: clampScore(score.complexity),
    correctness: clampScore(score.correctness),
    errorHandling: clampScore(score.errorHandling),
    independence: clampScore(score.independence),
    modularity: clampScore(score.modularity),
    naming: clampScore(score.naming),
    reasoning: clampScore(score.reasoning),
    restraint: clampScore(score.restraint),
    testability: clampScore(score.testability),
    total: clampScore(score.total),
  };
}

const nonCoachingFeedbackPattern =
  /\b(format|formatting|indent|indentation|spacing|semicolon|review annotation|annotations?|empty arrays?)\b/i;
const placeholderFeedbackPattern =
  /\b(one fair summary sentence|specific mastered|specific remaining|specific area|next practice recommendation)\b/i;

function normalizeCodeForSimilarity(source: string): string {
  return cleanCodeFence(source)
    .replace(/\s+/g, '')
    .replace(/;+/g, ';')
    .trim();
}

function isMostlyUnchanged(original: string, submitted: string): boolean {
  return normalizeCodeForSimilarity(original) === normalizeCodeForSimilarity(submitted);
}

function cleanFeedbackItems(items: string[], limit = 5): string[] {
  return items
    .map((item) => item.trim())
    .filter(
      (item) =>
        item.length > 4 &&
        !nonCoachingFeedbackPattern.test(item) &&
        !placeholderFeedbackPattern.test(item),
    )
    .slice(0, limit);
}

function capUnchangedScore(score: ScoreBreakdown): void {
  const maxRefactorScore = 45;

  score.codeQuality = Math.min(score.codeQuality, maxRefactorScore);
  score.complexity = Math.min(score.complexity, maxRefactorScore);
  score.errorHandling = Math.min(score.errorHandling, maxRefactorScore);
  score.independence = Math.min(score.independence, maxRefactorScore);
  score.modularity = Math.min(score.modularity, maxRefactorScore);
  score.naming = Math.min(score.naming, maxRefactorScore);
  score.reasoning = Math.min(score.reasoning, maxRefactorScore);
  score.restraint = Math.min(score.restraint, maxRefactorScore);
  score.testability = Math.min(score.testability, maxRefactorScore);
  score.total = Math.min(score.total, maxRefactorScore);
}

function normalizeDifficulty(score: number): ChallengeDifficulty {
  if (score < 48) {
    return 'beginner';
  }

  if (score < 70) {
    return 'intermediate';
  }

  if (score < 86) {
    return 'advanced';
  }

  return 'expert';
}

function normalizeGeneratedDifficulty(
  value: string | undefined,
  fallback: ChallengeDifficulty,
): ChallengeDifficulty {
  if (
    value === 'beginner' ||
    value === 'intermediate' ||
    value === 'advanced' ||
    value === 'expert'
  ) {
    return value;
  }

  return fallback;
}

function labelForSkill(value: SkillId): string {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function difficultyForProfile(profile: UserProfile, focusSkill: SkillId): ChallengeDifficulty {
  if (profile.totalAttempts === 0) {
    return profile.startingLevel;
  }

  return normalizeDifficulty(profile.skillScores[focusSkill]);
}

function difficultyGuidanceFor(difficulty: ChallengeDifficulty): string {
  switch (difficulty) {
    case 'beginner':
      return [
        '- Beginner: one function with one parameter, 8 to 18 meaningful lines, simple arrays/objects/strings/numbers, one loop or one if/else, no recursion, no async, no nested loops, and no tricky language features.',
        '- Beginner mess should be easy to see: vague names, repeated expression, avoidable branch, or a slightly overlong block.',
      ].join('\n');
    case 'intermediate':
      return [
        '- Intermediate: one function with one or two parameters, 14 to 30 meaningful lines, realistic arrays/objects, at most one nested loop or nested branch, and enough logic to extract one helper.',
        '- Intermediate mess can include duplicated transforms, mixed responsibilities, awkward conditions, or weak naming.',
      ].join('\n');
    case 'advanced':
      return [
        '- Advanced: one function with two or three parameters, 24 to 46 meaningful lines, multiple branches, data normalization, validation, and one performance or error-handling tradeoff.',
        '- Advanced mess can include coupled responsibilities, repeated scans, unclear guards, and hidden edge cases while staying runnable.',
      ].join('\n');
    case 'expert':
      return [
        '- Expert: one function with two to four parameters, 36 to 68 meaningful lines, layered business rules, edge cases, non-trivial data shapes, and clear refactoring opportunities across several skills.',
        '- Expert mess can include tangled policy logic, repeated calculations, weak boundaries, and subtle correctness traps, but it must still run deterministically.',
      ].join('\n');
  }
}

function numberedCode(source: string): string {
  return source
    .split('\n')
    .map((line, index) => `${String(index + 1).padStart(2, '0')}: ${line}`)
    .join('\n');
}

function stagedCodePrompt(options: GenerateChallengeOptions): string {
  const difficulty = difficultyForProfile(options.profile, options.focusSkill);
  const difficultyGuidance = difficultyGuidanceFor(difficulty);

  return `Write one complete runnable JavaScript function for a refactoring practice question.
Skill focus: ${options.focusSkill}.
Learner signup level: ${options.profile.startingLevel}.
Target difficulty: ${difficulty}.

Difficulty guardrails:
${difficultyGuidance}

Rules:
- Return JavaScript code only.
- Use one public camelCase function declaration with a domain-specific name.
- The function must accept JSON-friendly input and return a JSON-friendly value.
- Make the code intentionally improvable in ${options.focusSkill}, but keep it runnable.
- Create a specific real-world task, not a generic processData style example.
- Include at least one branch or loop and at least two local variables unless the beginner guardrail would make that unnatural.
- Use some realistic messy choices such as vague names, repeated expressions, unnecessary nesting, mixed responsibility, or overlong logic.
- Mess up mainly ${options.focusSkill}; keep unrelated problems mild.
- Do not make spacing, indentation, semicolons, or formatting the main issue.
- Include no imports, exports, require, process, document, window, Date, Math.random, timers, comments, TODOs, or placeholder text.
- Do not use placeholder names like functionName, solution, processData, clean, or refactor.`;
}

function stagedReferencePrompt(entryPoint: string, focusSkill: SkillId, messyCode: string): string {
  return `Rewrite this JavaScript function to improve ${focusSkill} while preserving behavior.
Return JavaScript code only.
Keep the same public function name: ${entryPoint}.
Keep the same inputs, return shape, thrown errors, and side effects.
No imports, exports, require, process, document, window, Date, Math.random, timers, comments, or markdown.

Original code:
${messyCode.slice(0, 5000)}`;
}

function stagedRuntimeCasesPrompt(entryPoint: string, parameterCount: number, messyCode: string): string {
  return `Return JSON only with exactly this shape:
{"testCases":[{"name":"scenario name","args":[/* function arguments */]}]}

Create 3 to 5 runtime scenarios for function ${entryPoint}.
The function has ${parameterCount} argument${parameterCount === 1 ? '' : 's'}.
Each testCases item must have args as an array of arguments to pass to ${entryPoint}.
The first test case must be a normal successful case that returns a value instead of throwing.
Prefer realistic valid inputs. Include edge cases only after at least two normal successful cases.
Use only JSON values: strings, numbers, booleans, null, arrays, and objects.
Do not use functions, undefined, Date, RegExp, comments, or markdown.

Code:
${messyCode.slice(0, 5000)}`;
}

function stagedMetadataPrompt(
  options: GenerateChallengeOptions,
  entryPoint: string,
  messyCode: string,
  referenceCode: string,
): string {
  const difficulty = difficultyForProfile(options.profile, options.focusSkill);
  const focusLabel = labelForSkill(options.focusSkill);
  const codeWithLines = numberedCode(messyCode).slice(0, 4500);
  const referenceWithLines = numberedCode(referenceCode).slice(0, 4500);

  return `Return JSON only for learner-facing metadata for this generated JavaScript refactor challenge.
Required keys:
title, applicationContext, description, estimateMinutes, tags, requirements, hints, insertedProblems, expectedTerms, preferredTerms, antiPatterns.

Rules:
- Skill focus: ${options.focusSkill} (${focusLabel}).
- Difficulty: ${difficulty}.
- entryPoint: ${entryPoint}.
- Avoid these recent titles: ${options.recentTitles.join(', ') || 'none'}.
- title must describe the specific product problem in the code, not internal tooling.
- description must be detailed and specific: 4 to 6 short sentences explaining what ${entryPoint} currently does, the domain situation, what behavior must stay the same, and the main refactor goal.
- description must mention ${entryPoint} and at least two real identifiers, branches, loops, or return values from the messy code.
- tags must be specific learner-facing code/problem strings only, such as "cart-total", "nested-branch", or "data-normalization".
- requirements must be 2 to 3 simple user-facing items. First item must say the result must stay the same. Other items should ask for improved clarity, structure, performance, or safety based on ${focusLabel}.
- hints must be 3 to 5 progressive hints generated from the messy code.
- Each hint body must point to concrete code: use a line number from the numbered messy code, an exact identifier, a specific condition, loop, repeated expression, return value, or branch.
- Beginner hints should be direct and step-by-step. Intermediate and higher hints can be more strategic, but must still name concrete code locations.
- Do not describe formatting, indentation, spacing, or semicolons as the main improvement area.
- hints must be an array of objects with title and body.
- tags, requirements, insertedProblems, expectedTerms, preferredTerms, and antiPatterns must be arrays of strings.
- Do not mention AI, APIs, backend, database, prompts, providers, or architecture.
- Return arrays as arrays, never numeric counts.
- Do not use placeholder words such as "Product problem title", "code-topic", "hint title", or "hidden issue".

Numbered messy code:
${codeWithLines}

Numbered reference direction:
${referenceWithLines}`;
}

function stagedMetadataRescuePrompt(
  options: GenerateChallengeOptions,
  entryPoint: string,
  messyCode: string,
): string {
  const difficulty = difficultyForProfile(options.profile, options.focusSkill);
  const focusLabel = labelForSkill(options.focusSkill);

  return `Return one valid JSON object only.
Create specific learner-facing metadata for this JavaScript refactor exercise.
Required keys: title, applicationContext, description, estimateMinutes, tags, requirements, hints, insertedProblems, expectedTerms, preferredTerms, antiPatterns.

Constraints:
- Difficulty: ${difficulty}.
- Main skill: ${focusLabel}.
- Public function: ${entryPoint}.
- Description: 4 to 6 short sentences, specific to the code, naming ${entryPoint} and at least two identifiers or code paths.
- Requirements: 2 or 3 short strings. First requirement must preserve the same result.
- Hints: exactly 3 objects with title and body. Each body must cite a line number or exact identifier from the numbered code and say what to inspect or change.
- Tags: concrete problem/domain tags only.
- No formatting, spacing, semicolon, architecture, provider, or internal-tooling mentions.

Numbered code:
${numberedCode(messyCode).slice(0, 4500)}`;
}

function secondarySkillsFor(focusSkill: SkillId): SkillId[] {
  const defaults: Record<SkillId, SkillId[]> = {
    architecture: ['modularity', 'restraint', 'testing'],
    'async-programming': ['error-handling', 'testing', 'readability'],
    'code-review': ['readability', 'complexity', 'restraint'],
    complexity: ['readability', 'modularity', 'testing'],
    'error-handling': ['testing', 'modularity', 'readability'],
    modularity: ['testing', 'readability', 'restraint'],
    naming: ['readability', 'code-review', 'restraint'],
    performance: ['readability', 'complexity', 'restraint'],
    readability: ['naming', 'complexity', 'restraint'],
    restraint: ['modularity', 'architecture', 'code-review'],
    security: ['error-handling', 'testing', 'modularity'],
    testing: ['modularity', 'error-handling', 'code-review'],
  };

  return defaults[focusSkill];
}

function typeFor(focusSkill: SkillId): Challenge['type'] {
  if (focusSkill === 'security') {
    return 'security-refactor';
  }

  if (focusSkill === 'testing') {
    return 'add-tests-before-refactoring';
  }

  if (focusSkill === 'code-review') {
    return 'find-the-problems';
  }

  return 'refactor-preserve-behavior';
}

function challengeFromModel(
  raw: z.infer<typeof generatedChallengeSchema>,
  options: GenerateChallengeOptions,
  provider: 'ollama' | 'openai',
  model: string,
): Challenge {
  const focusSkill = options.focusSkill;
  const secondarySkills = secondarySkillsFor(focusSkill);
  const rawRequirements = cleanArray(raw.requirements, [], 8);
  const insertedProblems = cleanArray(raw.insertedProblems, [], 8);
  const expectedTerms = cleanArray(raw.expectedTerms, rawRequirements, 10);
  const preferredTerms = cleanArray(raw.preferredTerms, [], 10);
  const antiPatterns = cleanArray(raw.antiPatterns, [], 8);
  const difficulty = normalizeGeneratedDifficulty(
    raw.difficulty,
    difficultyForProfile(options.profile, focusSkill),
  );
  const title = raw.title.trim();
  const now = new Date().toISOString();
  const slug = slugify(title);
  const startingCode = cleanCodeFence(raw.messyCode);
  const referenceCode = cleanCodeFence(raw.referenceCode);
  const entryPoint = resolveEntryPoint(raw.entryPoint, startingCode, referenceCode) || raw.entryPoint.trim();
  const testCases = raw.testCases.slice(0, 5);

  return {
    applicationContext: raw.applicationContext.trim(),
    contractVersion: 3,
    createdAt: now,
    description: raw.description.trim(),
    difficulty,
    estimateMinutes: raw.estimateMinutes,
    evaluation: {
      antiPatterns,
      expectedTerms,
      maxVagueNames: 1,
      minFunctionCount: focusSkill === 'modularity' || focusSkill === 'testing' ? 3 : 2,
      preferredTerms,
      requiredBehavior: rawRequirements,
    },
    generatedBy: provider,
    generationReason: `Generated for ${focusSkill} practice using ${model}.`,
    hiddenTargets: {
      insertedProblems,
      primarySkill: focusSkill,
      requiredBehavior: rawRequirements,
      secondarySkills,
    },
    hints: cleanHints(raw.hints),
    id: `${slug}-${Date.now().toString(36)}`,
    instructions: publicRequirementsFor(focusSkill),
    language: 'javascript',
    ownerUserId: options.profile.userId,
    primarySkill: focusSkill,
    referenceCode,
    runtime: {
      entryPoint,
      testCases,
      timeoutMs: 900,
    },
    secondarySkills,
    slug,
    startingCode,
    tags: cleanTags(raw.tags),
    title,
    type: typeFor(focusSkill),
    visibleProblems: [],
  };
}

function coachPrompt(options: CoachFeedbackOptions): string {
  return `TASK: coach a JavaScript refactor submission.
Return exactly one JSON object shaped like:
{"coachNote":"One fair summary sentence.","improvements":["Specific mastered or improved item"],"missedIssues":["Specific remaining issue"],"regressions":["Possible behavior risk"],"nextRecommendation":"One next practice recommendation."}

Challenge title: ${options.challenge.title}
Primary skill: ${options.challenge.primarySkill}
Tags: ${(options.challenge.tags || []).join(', ') || options.challenge.primarySkill}
Deterministic score: ${options.deterministicFeedback.score.total}/100
Deterministic score categories: ${JSON.stringify(options.deterministicFeedback.score)}
Runtime behavior checks: ${options.deterministicFeedback.runtimeEvaluation?.message || 'No runnable checks available.'}
Existing improvements: ${options.deterministicFeedback.improvements.join(' | ')}
Existing missed issues: ${options.deterministicFeedback.missedIssues.join(' | ') || 'none'}
Existing regressions: ${options.deterministicFeedback.regressions.join(' | ') || 'none'}
User explanation: ${options.explanation || 'none'}

Submitted code:
${options.submittedCode.slice(0, 5000)}

Rules:
- Keep feedback concise, actionable, and fair.
- Do not invent test execution results. Use only the runtime behavior summary above.
- Do not mention internal model, API, backend, database, or provider details.
- Base the recommendation on the lowest score category or the primary skill.`;
}

function scoreSubmissionPrompt(options: ScoreSubmissionOptions): string {
  const runtimeSummary = options.runtimeEvaluation.cases
    .map((testCase) => `${testCase.name}: ${testCase.passed ? 'matched' : 'changed'}`)
    .join('; ');

  return `TASK: score one JavaScript refactor submission for NEATCODE.
Return exactly one JSON object shaped like:
{"score":{"correctness":100,"codeQuality":80,"naming":80,"modularity":80,"complexity":80,"errorHandling":80,"testability":80,"reasoning":80,"independence":90,"restraint":80,"total":82},"coachNote":"One fair summary sentence.","improvements":["Specific mastered item"],"missedIssues":["Specific area to improve in this solution"],"regressions":[],"reviewAnnotations":[],"nextRecommendation":"One next practice recommendation."}
The shape above is an example. Do not copy its placeholder sentence values.

Context:
- Runtime behavior already passed before this scoring request.
- Runtime summary: ${options.runtimeEvaluation.message}
- Scenario details: ${runtimeSummary || 'all runtime scenarios passed'}
- Primary focus skill: ${options.challenge.primarySkill}
- Supporting skills: ${options.challenge.secondarySkills.join(', ')}
- Tags: ${(options.challenge.tags || []).join(', ') || options.challenge.primarySkill}
- Hints used: ${options.hintsUsed}
- Solve duration seconds: ${options.durationSeconds}
- Learner explanation: ${options.explanation || 'none'}
- Hidden improvement targets: ${options.challenge.hiddenTargets.insertedProblems.join(', ')}
- Preferred clean-code terms: ${options.challenge.evaluation.preferredTerms.join(', ')}
- Original anti-pattern terms: ${options.challenge.evaluation.antiPatterns.join(', ')}

Original messy code:
${options.challenge.startingCode.slice(0, 5000)}

Reference direction:
${options.challenge.referenceCode.slice(0, 5000)}

Submitted code:
${options.submittedCode.slice(0, 7000)}

Scoring rules:
- Correctness must be 100 because runtime behavior already matched. Do not lower correctness for style.
- If submitted code is nearly unchanged from the original messy code, give a low total score even though correctness is 100.
- Score the primary focus skill more heavily than unrelated factors.
- Penalize only real issues visible in the submitted code. Do not invent failures.
- Reward preserving behavior, improving the specific focus area, clear naming, simple flow, focused helpers, and restraint.
- Do not penalize the learner for not writing a separate explanation. Treat reasoning as code clarity and preserved intent.
- missedIssues must be short areas to improve for this exact submitted solution, not a line-by-line code review.
- Do not make spacing, indentation, semicolons, or formatting the main critique.
- Keep reviewAnnotations as an empty array unless a line-specific note is essential.
- Do not mention internal model, API, backend, database, runtime implementation, prompts, or providers.`;
}

function analysisPrompt(source: string): string {
  return `TASK: analyze this JavaScript snippet for clean-code coaching.
Return exactly one JSON object shaped like:
{"summary":"Short coaching summary.","recommendedSkill":"readability","strengths":["Specific strength"],"scores":[{"skill":"readability","value":78,"rationale":"Why this score"}],"issues":[{"title":"Issue title","detail":"Concrete detail","category":"complexity","severity":"medium"}]}

Issue categories must be one of: ${skillIds.join(', ')}.
Score skills must be one of: ${skillIds.join(', ')}.
Use 3 to 6 scores, 0 to 4 strengths, and at most 6 issues.
Severity must be low, medium, or high.
Do not mention internal model, API, backend, database, or provider details.

Code:
${source.slice(0, 12000)}`;
}

const jsonSystemPrompt = `You are NEATCODE's structured JavaScript coaching engine.
Return one valid JSON object only. No markdown, no prose before or after JSON.
Follow the exact shape requested by the user message. Include every required key.
Use double quotes for all JSON strings. Do not use trailing commas.
When uncertain, choose conservative coaching feedback and keep arrays short.
For scoring, only score code quality after runtime behavior has passed; behavior correctness is decided by the runtime gate.
Never mention internal infrastructure, model names, providers, APIs, prompts, or databases.`;

const codeGenerationSystemPrompt = `You are NEATCODE's JavaScript exercise generator.
Return complete runnable JavaScript code only. No markdown, no prose, no comments.
Generate original code for the requested learner and skill focus.
Never use canned examples, static templates, placeholders, imports, exports, or environment-specific APIs.`;

export class LlmService {
  private readonly client: OpenAI;

  constructor(private readonly config: LlmConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeoutMs,
    });
  }

  getProviderLabel(): 'ollama' | 'openai' {
    return this.config.provider;
  }

  async generateChallenge(options: GenerateChallengeOptions): Promise<Challenge> {
    const parsed = await this.generateStagedChallenge(options);
    return challengeFromModel(parsed, options, this.config.provider, this.config.model);
  }

  private async generateStagedChallenge(
    options: GenerateChallengeOptions,
  ): Promise<z.infer<typeof generatedChallengeSchema>> {
    const messyCode = await this.requestJavaScript(stagedCodePrompt(options), 3);
    const messyEntryPoint = extractDefinedEntryPoints(messyCode).find(
      (name) => !PLACEHOLDER_FUNCTION_NAMES.has(name),
    );

    if (!messyEntryPoint) {
      throw new Error('The model did not generate a usable public function.');
    }

    const referenceCode = await this.requestJavaScript(
      stagedReferencePrompt(messyEntryPoint, options.focusSkill, messyCode),
      3,
    );
    const entryPoint = resolveEntryPoint(messyEntryPoint, messyCode, referenceCode);

    if (!entryPoint) {
      throw new Error('The model did not keep the same public function in the reference code.');
    }

    const parameterCount = extractParameterCount(messyCode, entryPoint);
    const runtimeCases = await this.requestJson(
      stagedRuntimeCasesPrompt(entryPoint, parameterCount, messyCode),
      stagedRuntimeCasesSchema,
      this.config.timeoutMs,
      jsonSystemPrompt,
      3,
    );
    let metadata: z.infer<typeof generatedMetadataSchema>;

    try {
      metadata = await this.requestJson(
        stagedMetadataPrompt(options, entryPoint, messyCode, referenceCode),
        generatedMetadataSchema,
        this.config.timeoutMs,
        jsonSystemPrompt,
        3,
      );
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`AI metadata generation needed a compact retry: ${detail}`);
      metadata = await this.requestJson(
        stagedMetadataRescuePrompt(options, entryPoint, messyCode),
        generatedMetadataSchema,
        this.config.timeoutMs,
        jsonSystemPrompt,
        2,
      );
    }

    const targetDifficulty = difficultyForProfile(options.profile, options.focusSkill);
    const rawChallenge = {
      ...metadata,
      difficulty: targetDifficulty,
      entryPoint,
      messyCode,
      referenceCode,
      testCases: normalizeGeneratedRuntimeCases(runtimeCases.testCases, parameterCount),
      visibleProblems: [],
    };

    return generatedChallengeSchema.parse(rawChallenge);
  }

  async coachSubmission(options: CoachFeedbackOptions): Promise<EvaluationFeedback> {
    const parsed = await this.requestJson(coachPrompt(options), coachSchema, 12_000);

    return {
      ...options.deterministicFeedback,
      coachNote: parsed.coachNote,
      improvements: parsed.improvements,
      missedIssues: parsed.missedIssues,
      nextRecommendation: parsed.nextRecommendation,
      regressions: parsed.regressions,
    };
  }

  async scoreSubmission(options: ScoreSubmissionOptions): Promise<EvaluationFeedback> {
    const parsed = await this.requestJson(scoreSubmissionPrompt(options), aiScoreSchema, 30_000);
    const score = normalizeScore(parsed.score);
    score.correctness = 100;
    const unchanged = isMostlyUnchanged(options.challenge.startingCode, options.submittedCode);
    const improvements = cleanFeedbackItems(parsed.improvements);
    const missedIssues = cleanFeedbackItems(parsed.missedIssues);
    const regressions = cleanFeedbackItems(parsed.regressions);
    const hasUnhelpfulRecommendation =
      nonCoachingFeedbackPattern.test(parsed.nextRecommendation) ||
      placeholderFeedbackPattern.test(parsed.nextRecommendation);
    const nextRecommendation = hasUnhelpfulRecommendation
      ? `Practice ${options.challenge.primarySkill} with behavior-preserving refactors.`
      : parsed.nextRecommendation.trim();

    if (unchanged) {
      capUnchangedScore(score);
      missedIssues.unshift(
        'The submitted code is still very close to the starting version; make a real behavior-preserving refactor before submitting.',
      );
      missedIssues.splice(5);
    }
    const hasUnhelpfulCoachNote =
      nonCoachingFeedbackPattern.test(parsed.coachNote) ||
      placeholderFeedbackPattern.test(parsed.coachNote);
    const coachNote = hasUnhelpfulCoachNote
      ? 'Output matched. The score reflects how much the submitted code improved the original structure.'
      : parsed.coachNote.trim();

    return {
      coachNote: coachNote || 'AI reviewed the refactor after the output matched.',
      improvements: improvements.length ? improvements : ['Kept the runtime output aligned with the original code.'],
      missedIssues,
      nextRecommendation: nextRecommendation || 'Keep practicing the current focus skill.',
      regressions,
      reviewAnnotations: [],
      runtimeEvaluation: options.runtimeEvaluation,
      score,
    };
  }

  async analyzeSnippet(source: string): Promise<CodeAnalysisResult> {
    return await this.requestJson(analysisPrompt(source), analysisSchema, 20_000);
  }

  private async requestJavaScript(prompt: string, maxAttempts = 2): Promise<string> {
    let repairNote = '';

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = await this.client.chat.completions.create(
        {
          messages: [
            {
              content: codeGenerationSystemPrompt,
              role: 'system',
            },
            { content: `${prompt}${repairNote}`, role: 'user' },
          ],
          model: this.config.model,
          temperature: this.config.model.includes('gemma') ? 0.2 : 0.35,
          top_p: 0.9,
        },
        { timeout: this.config.timeoutMs },
      );
      const code = codeCandidateFromResponse(response.choices[0]?.message?.content || '');
      const entryPoints = extractDefinedEntryPoints(code);
      const hasStub = INCOMPLETE_CODE_PATTERN.test(code);
      const hasValidSyntax = hasValidJavaScriptSyntax(code);

      if (code.length >= 80 && entryPoints.length && !hasStub && hasValidSyntax) {
        return code;
      }

      repairNote = `\nYour last response was incomplete or not valid runnable JavaScript. Return exactly one complete JavaScript function declaration, at least 80 characters, with no placeholders and no prose.`;
    }

    throw new Error('The model did not generate complete JavaScript code.');
  }

  private async requestJson<T>(
    prompt: string,
    schema: z.ZodType<T>,
    timeoutMs = this.config.timeoutMs,
    systemPrompt = jsonSystemPrompt,
    maxAttempts = 2,
  ): Promise<T> {
    let repairNote = '';
    let lastValidationDetail = 'The model did not return a JSON object.';

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = await this.client.chat.completions.create(
        {
          messages: [
            {
              content: systemPrompt,
              role: 'system',
            },
            { content: `${prompt}${repairNote}`, role: 'user' },
          ],
          model: this.config.model,
          response_format: { type: 'json_object' },
          temperature: this.config.model.includes('gemma') ? 0.2 : 0.35,
          top_p: 0.9,
        },
        { timeout: timeoutMs },
      );
      const content = response.choices[0]?.message?.content;

      if (!content) {
        lastValidationDetail = 'The model returned an empty message.';
        repairNote = '\nYour last response was empty. Return the requested JSON object.';
        continue;
      }

      try {
        return schema.parse(extractJsonObject(content));
      } catch (error) {
        const details =
          error instanceof z.ZodError
            ? error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
            : error instanceof Error
              ? error.message
              : 'Invalid JSON';
        lastValidationDetail = details;
        repairNote = `\nYour last JSON did not match the required shape: ${details}.
Your last response was:
${content.slice(0, 6000)}
Return a corrected JSON object only. Keep the same task, but fix the invalid fields. Arrays must be JSON arrays of strings or objects, never numeric counts.`;
      }
    }

    throw new Error(`The model did not return valid JSON for the requested task: ${lastValidationDetail}`);
  }
}
