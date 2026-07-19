export const skillIds = [
  'naming',
  'readability',
  'complexity',
  'modularity',
  'testing',
  'error-handling',
  'security',
  'performance',
  'architecture',
  'async-programming',
  'restraint',
  'code-review',
] as const;

export type SkillId = (typeof skillIds)[number];
export type ChallengeDifficulty = 'beginner' | 'intermediate' | 'advanced' | 'expert';
export type CodingLevel = ChallengeDifficulty;
export type ChallengeType =
  | 'add-tests-before-refactoring'
  | 'find-the-problems'
  | 'refactor-preserve-behavior'
  | 'security-refactor';

export type SkillScores = Record<SkillId, number>;

export interface ChallengeHint {
  body: string;
  level: number;
  title: string;
}

export type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface ChallengeFetchMock {
  json?: JsonValue;
  ok?: boolean;
  status?: number;
  text?: string;
}

export interface ChallengeRuntimeCase {
  args: JsonValue[];
  fetchMocks?: ChallengeFetchMock[];
  name: string;
}

export interface ChallengeRuntime {
  entryPoint: string;
  testCases: ChallengeRuntimeCase[];
  timeoutMs?: number;
}

export interface ChallengeEvaluationRule {
  antiPatterns: string[];
  expectedTerms: string[];
  maxVagueNames: number;
  minFunctionCount: number;
  preferredTerms: string[];
  requiredBehavior: string[];
}

export interface HiddenSkillTargets {
  insertedProblems: string[];
  primarySkill: SkillId;
  requiredBehavior: string[];
  secondarySkills: SkillId[];
}

export interface Challenge {
  applicationContext: string;
  contractVersion?: number;
  createdAt: string;
  description: string;
  difficulty: ChallengeDifficulty;
  estimateMinutes: number;
  evaluation: ChallengeEvaluationRule;
  hiddenTargets: HiddenSkillTargets;
  hints: ChallengeHint[];
  id: string;
  instructions: string[];
  language: 'javascript';
  generatedBy?: 'ollama' | 'openai';
  generationReason?: string;
  ownerUserId?: string;
  primarySkill: SkillId;
  referenceCode: string;
  runtime?: ChallengeRuntime;
  secondarySkills: SkillId[];
  slug: string;
  startingCode: string;
  tags?: string[];
  title: string;
  type: ChallengeType;
  visibleProblems: string[];
}

export interface ScoreBreakdown {
  codeQuality: number;
  complexity: number;
  correctness: number;
  errorHandling: number;
  independence: number;
  modularity: number;
  naming: number;
  reasoning: number;
  restraint: number;
  testability: number;
  total: number;
}

export interface CodeReviewAnnotation {
  detail: string;
  lineNumber: number;
  title: string;
  type: 'improvement' | 'mastered';
}

export interface RuntimeFetchCall {
  body?: string;
  method?: string;
  url: string;
}

export interface RuntimeExecutionOutcome {
  error?: string;
  fetchCalls: RuntimeFetchCall[];
  status: 'returned' | 'threw';
  value?: JsonValue;
}

export interface RuntimeCaseResult {
  args: JsonValue[];
  baseline: RuntimeExecutionOutcome;
  name: string;
  passed: boolean;
  reference?: RuntimeExecutionOutcome;
  submitted: RuntimeExecutionOutcome;
}

export interface RuntimeEvaluation {
  cases: RuntimeCaseResult[];
  entryPoint?: string;
  message: string;
  passed: boolean;
  passedCount: number;
  total: number;
}

export interface EvaluationFeedback {
  coachNote: string;
  improvements: string[];
  missedIssues: string[];
  nextRecommendation: string;
  regressions: string[];
  reviewAnnotations: CodeReviewAnnotation[];
  runtimeEvaluation?: RuntimeEvaluation;
  score: ScoreBreakdown;
}

export interface Attempt {
  challengeId: string;
  createdAt: string;
  durationSeconds: number;
  explanation: string;
  feedback: EvaluationFeedback;
  hintsUsed: number;
  id: string;
  submittedCode: string;
  userId: string;
}

export interface UserProfile {
  completedChallenges: string[];
  currentFocus: SkillId;
  displayName: string;
  skillScores: SkillScores;
  startingLevel: CodingLevel;
  totalAttempts: number;
  updatedAt: string;
  userId: string;
}

export interface UserAccount {
  createdAt: string;
  displayName: string;
  email: string;
  id: string;
  passwordHash: string;
  passwordSalt: string;
  updatedAt: string;
}

export interface PublicUser {
  createdAt: string;
  displayName: string;
  email: string;
  id: string;
  updatedAt: string;
}

export interface ChallengeSummary {
  applicationContext: string;
  difficulty: ChallengeDifficulty;
  estimateMinutes: number;
  id: string;
  primarySkill: SkillId;
  secondarySkills: SkillId[];
  slug: string;
  title: string;
  type: ChallengeType;
}

export interface DashboardPayload {
  challenges: ChallengeSummary[];
  lastAttempt: Attempt | null;
  profile: UserProfile;
  recommendedChallenge: Challenge;
}

export interface CodeIssue {
  category: SkillId;
  detail: string;
  severity: 'low' | 'medium' | 'high';
  title: string;
}

export interface CodeAnalysisScore {
  rationale: string;
  skill: SkillId;
  value: number;
}

export interface CodeAnalysisResult {
  issues: CodeIssue[];
  recommendedSkill: SkillId;
  scores: CodeAnalysisScore[];
  strengths: string[];
  summary: string;
}

export function createDefaultSkillScores(baseScore = 50): SkillScores {
  return {
    architecture: baseScore,
    'async-programming': baseScore,
    'code-review': baseScore,
    complexity: baseScore,
    'error-handling': baseScore,
    modularity: baseScore,
    naming: baseScore,
    performance: baseScore,
    readability: baseScore,
    restraint: baseScore,
    security: baseScore,
    testing: baseScore,
  };
}
