export type SkillId =
  | 'architecture'
  | 'async-programming'
  | 'code-review'
  | 'complexity'
  | 'error-handling'
  | 'modularity'
  | 'naming'
  | 'performance'
  | 'readability'
  | 'restraint'
  | 'security'
  | 'testing';

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

export interface Challenge extends ChallengeSummary {
  contractVersion?: number;
  description: string;
  hintCount: number;
  hints: ChallengeHint[];
  instructions: string[];
  language: 'javascript';
  referenceCode: string;
  runtime?: ChallengeRuntime;
  startingCode: string;
  tags?: string[];
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

export interface PublicUser {
  createdAt: string;
  displayName: string;
  email: string;
  id: string;
  updatedAt: string;
}

export interface PracticeStats {
  acceptedSubmissions: number;
  totalPracticeSeconds: number;
  totalSubmissions: number;
}

export interface BootstrapPayload {
  challenges: ChallengeSummary[];
  lastAttempt: Attempt | null;
  profile: UserProfile;
  recommendedChallenge: Challenge;
  stats: PracticeStats;
  user: PublicUser;
}

export interface AuthResponse {
  token: string;
  user: PublicUser;
}

export interface SubmitResponse {
  accepted: boolean;
  attempt: Attempt;
  nextChallenge: Challenge | null;
  profile: UserProfile;
  stats: PracticeStats;
}

export interface RuntimeResponse {
  outcome: RuntimeExecutionOutcome;
}
