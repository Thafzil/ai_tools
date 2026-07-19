import vm from 'node:vm';
import {
  type Challenge,
  type CodeAnalysisScore,
  type CodeAnalysisResult,
  type CodeIssue,
  type CodeReviewAnnotation,
  type EvaluationFeedback,
  type RuntimeEvaluation,
  type ScoreBreakdown,
  type SkillId,
} from './domain';
import { splitLines } from './text';

interface CodeMetrics {
  antiPatternHits: number;
  averageLineLength: number;
  consoleLogs: number;
  functionCount: number;
  hasResponseCheck: boolean;
  hasTryCatch: boolean;
  lineCount: number;
  maxIndentDepth: number;
  preferredTermHits: number;
  syntaxValid: boolean;
  vagueNames: number;
}

interface EvaluateOptions {
  durationSeconds: number;
  explanation: string;
  hintsUsed: number;
  runtimeEvaluation?: RuntimeEvaluation;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function includesTerm(source: string, term: string): boolean {
  return source.toLowerCase().includes(term.toLowerCase());
}

function checkSyntax(source: string): boolean {
  try {
    // This validates parseability without invoking submitted functions.
    new vm.Script(source);
    return true;
  } catch {
    return false;
  }
}

function getMaxIndentDepth(lines: string[]): number {
  return lines.reduce((maxDepth, line) => {
    if (!line.trim()) {
      return maxDepth;
    }

    const leadingSpaces = line.match(/^\s*/)?.[0].replace(/\t/g, '  ').length ?? 0;
    return Math.max(maxDepth, Math.floor(leadingSpaces / 2));
  }, 0);
}

function getCodeMetrics(source: string, challenge: Challenge): CodeMetrics {
  const lines = splitLines(source);
  const nonEmptyLines = lines.filter((line) => line.trim());
  const antiPatternHits = challenge.evaluation.antiPatterns.filter((term) =>
    includesTerm(source, term),
  ).length;
  const preferredTermHits = challenge.evaluation.preferredTerms.filter((term) =>
    includesTerm(source, term),
  ).length;

  return {
    antiPatternHits,
    averageLineLength:
      nonEmptyLines.reduce((total, line) => total + line.length, 0) /
      Math.max(nonEmptyLines.length, 1),
    consoleLogs: countMatches(source, /\bconsole\.(log|debug|info|warn|error)\s*\(/g),
    functionCount: countMatches(
      source,
      /\bfunction\s+[a-zA-Z_$][\w$]*\s*\(|=>|const\s+[a-zA-Z_$][\w$]*\s*=\s*(async\s*)?\(/g,
    ),
    hasResponseCheck: /\bresponse\.ok\b|\bstatus\s*[!=]==?\s*2\d\d|\bthrow\s+new\s+Error/.test(
      source,
    ),
    hasTryCatch: /\btry\s*{[\s\S]*\bcatch\s*\(/.test(source),
    lineCount: nonEmptyLines.length,
    maxIndentDepth: getMaxIndentDepth(lines),
    preferredTermHits,
    syntaxValid: checkSyntax(source),
    vagueNames: countMatches(source, /\b(x|y|z|t|tmp|obj|arr|val|data)\b/g),
  };
}

function scoreCorrectness(
  source: string,
  challenge: Challenge,
  metrics: CodeMetrics,
  runtimeEvaluation: RuntimeEvaluation | undefined,
): number {
  if (runtimeEvaluation?.total) {
    return clamp((runtimeEvaluation.passedCount / runtimeEvaluation.total) * 88 + Number(metrics.syntaxValid) * 12);
  }

  const missingExpectedTerms = challenge.evaluation.expectedTerms.filter(
    (term) => !includesTerm(source, term),
  ).length;
  const syntaxPenalty = metrics.syntaxValid ? 0 : 35;

  return clamp(100 - missingExpectedTerms * 12 - syntaxPenalty);
}

function scoreNaming(metrics: CodeMetrics, challenge: Challenge): number {
  const extraVagueNames = Math.max(0, metrics.vagueNames - challenge.evaluation.maxVagueNames);
  return clamp(96 - extraVagueNames * 14);
}

function scoreModularity(metrics: CodeMetrics, challenge: Challenge): number {
  const missingFunctions = Math.max(0, challenge.evaluation.minFunctionCount - metrics.functionCount);
  return clamp(92 - missingFunctions * 18);
}

function scoreErrorHandling(challenge: Challenge, metrics: CodeMetrics): number {
  const caresAboutErrors =
    challenge.primarySkill === 'error-handling' ||
    challenge.secondarySkills.includes('error-handling') ||
    challenge.primarySkill === 'security';

  if (!caresAboutErrors) {
    return clamp(72 + Number(metrics.hasTryCatch) * 8 + Number(metrics.hasResponseCheck) * 8);
  }

  return clamp(44 + Number(metrics.hasTryCatch) * 24 + Number(metrics.hasResponseCheck) * 24);
}

function scoreReasoning(explanation: string, fallbackScore: number): number {
  if (!explanation.trim()) {
    return fallbackScore;
  }

  const words = explanation.trim().split(/\s+/).filter(Boolean).length;
  const mentionsTradeoff = /\b(trade-?off|because|test|behavior|responsib|failure|risk)\b/i.test(
    explanation,
  );

  return clamp(42 + Math.min(words, 45) + (mentionsTradeoff ? 16 : 0));
}

function scoreRestraint(source: string, challenge: Challenge, metrics: CodeMetrics): number {
  const growthRatio = source.length / Math.max(challenge.startingCode.length, 1);
  const overExtractionPenalty = Math.max(0, metrics.functionCount - 6) * 8;
  const sizePenalty = growthRatio > 2.3 ? 20 : growthRatio > 1.8 ? 9 : 0;

  return clamp(92 - overExtractionPenalty - sizePenalty);
}

function buildScore(
  source: string,
  challenge: Challenge,
  metrics: CodeMetrics,
  options: EvaluateOptions,
): ScoreBreakdown {
  const correctness = scoreCorrectness(source, challenge, metrics, options.runtimeEvaluation);
  const naming = scoreNaming(metrics, challenge);
  const modularity = scoreModularity(metrics, challenge);
  const errorHandling = scoreErrorHandling(challenge, metrics);
  const complexity = clamp(100 - Math.max(0, metrics.maxIndentDepth - 2) * 14);
  const codeQuality = clamp(
    58 +
      metrics.preferredTermHits * 5 -
      metrics.antiPatternHits * 8 -
      metrics.consoleLogs * 6 -
      Math.max(0, metrics.averageLineLength - 82) * 0.4,
  );
  const runtimeSignal = options.runtimeEvaluation?.total
    ? (options.runtimeEvaluation.passedCount / options.runtimeEvaluation.total) * 100
    : Number(source.includes('return')) * 100;
  const testability = clamp((modularity + complexity + runtimeSignal) / 3);
  const independence = clamp(100 - options.hintsUsed * 8);
  const reasoning = scoreReasoning(options.explanation, clamp((codeQuality + modularity + naming) / 3));
  const restraint = scoreRestraint(source, challenge, metrics);
  const total = clamp(
    correctness * 0.28 +
      codeQuality * 0.16 +
      modularity * 0.12 +
      errorHandling * 0.12 +
      naming * 0.08 +
      complexity * 0.08 +
      testability * 0.06 +
      reasoning * 0.05 +
      independence * 0.03 +
      restraint * 0.02,
  );

  return {
    codeQuality,
    complexity,
    correctness,
    errorHandling,
    independence,
    modularity,
    naming,
    reasoning,
    restraint,
    testability,
    total,
  };
}

function buildImprovements(
  metrics: CodeMetrics,
  score: ScoreBreakdown,
  runtimeEvaluation?: RuntimeEvaluation,
): string[] {
  const improvements: string[] = [];

  if (runtimeEvaluation?.total && runtimeEvaluation.passed) {
    improvements.push('Preserved the same observable behavior as the original code.');
  }

  if (score.modularity >= 76) {
    improvements.push('Separated behavior into smaller, easier-to-review units.');
  }

  if (score.naming >= 82) {
    improvements.push('Reduced vague naming and made intent easier to scan.');
  }

  if (score.complexity >= 84) {
    improvements.push('Reduced nesting and improved the main reading path.');
  }

  if (score.errorHandling >= 76) {
    improvements.push('Added clearer failure handling for risky operations.');
  }

  if (!metrics.consoleLogs) {
    improvements.push('Removed debug logging from the production path.');
  }

  return improvements.length ? improvements : ['Submitted a refactor that is ready for review.'];
}

function buildConcerns(
  challenge: Challenge,
  metrics: CodeMetrics,
  score: ScoreBreakdown,
  runtimeEvaluation?: RuntimeEvaluation,
): { missedIssues: string[]; regressions: string[] } {
  const missedIssues: string[] = [];
  const regressions: string[] = [];

  if (!metrics.syntaxValid) {
    regressions.push('The submitted code has a syntax issue and may not run.');
  }

  if (runtimeEvaluation?.total && !runtimeEvaluation.passed) {
    regressions.push('The submitted code does not match the original behavior for every runtime check.');
  }

  if (score.correctness < 82) {
    regressions.push('Some expected behavior signals are missing from the submission.');
  }

  if (metrics.antiPatternHits > 0) {
    missedIssues.push('Some original code smells are still visible in the refactor.');
  }

  if (score.errorHandling < 70 && challenge.primarySkill !== 'readability') {
    missedIssues.push('Failure handling still needs a clearer path.');
  }

  if (score.modularity < 70) {
    missedIssues.push('The solution still combines too many responsibilities.');
  }

  if (score.restraint < 70) {
    missedIssues.push('The refactor may be larger than the problem requires.');
  }

  return { missedIssues, regressions };
}

function firstCodeLine(lines: string[]): number {
  const index = lines.findIndex((line) => line.trim());
  return index >= 0 ? index + 1 : 1;
}

function lineForPattern(lines: string[], pattern: RegExp): number | null {
  const index = lines.findIndex((line) => pattern.test(line));
  return index >= 0 ? index + 1 : null;
}

function lineForTerms(lines: string[], terms: string[]): number | null {
  const normalizedTerms = terms.map((term) => term.toLowerCase()).filter(Boolean);
  const index = lines.findIndex((line) => {
    const normalizedLine = line.toLowerCase();
    return normalizedTerms.some((term) => normalizedLine.includes(term));
  });

  return index >= 0 ? index + 1 : null;
}

function buildReviewAnnotations(
  source: string,
  challenge: Challenge,
  metrics: CodeMetrics,
  score: ScoreBreakdown,
): CodeReviewAnnotation[] {
  const lines = splitLines(source);
  const fallbackLine = firstCodeLine(lines);
  const annotations: CodeReviewAnnotation[] = [];
  const addAnnotation = (annotation: CodeReviewAnnotation): void => {
    const lineNumber = Math.min(Math.max(annotation.lineNumber, 1), Math.max(lines.length, 1));
    const alreadyAdded = annotations.some(
      (item) => item.lineNumber === lineNumber && item.title === annotation.title,
    );

    if (!alreadyAdded) {
      annotations.push({ ...annotation, lineNumber });
    }
  };

  if (score.modularity >= 76) {
    addAnnotation({
      detail: 'This line shows a clearer unit of behavior instead of one large mixed block.',
      lineNumber: lineForPattern(lines, /\bfunction\b|=>|const\s+[a-zA-Z_$][\w$]*\s*=/) ?? fallbackLine,
      title: 'Mastered structure',
      type: 'mastered',
    });
  }

  if (score.naming >= 82) {
    addAnnotation({
      detail: 'The naming here gives the reader useful domain intent.',
      lineNumber: lineForTerms(lines, challenge.evaluation.preferredTerms) ?? fallbackLine,
      title: 'Mastered naming',
      type: 'mastered',
    });
  }

  if (score.errorHandling >= 76) {
    addAnnotation({
      detail: 'Risky work has a visible response, error, or validation path.',
      lineNumber: lineForPattern(lines, /\btry\b|\bcatch\b|\bthrow\b|\bresponse\.ok\b/) ?? fallbackLine,
      title: 'Mastered failure path',
      type: 'mastered',
    });
  }

  if (score.complexity >= 84) {
    addAnnotation({
      detail: 'The main reading path stays shallow enough to verify quickly.',
      lineNumber: fallbackLine,
      title: 'Mastered flow',
      type: 'mastered',
    });
  }

  if (!metrics.syntaxValid) {
    addAnnotation({
      detail: 'Fix parsing first so the behavior can be evaluated reliably.',
      lineNumber: 1,
      title: 'Syntax issue',
      type: 'improvement',
    });
  }

  if (score.correctness < 82) {
    addAnnotation({
      detail: 'The runtime result does not yet match the original behavior for every check.',
      lineNumber: fallbackLine,
      title: 'Behavior changed',
      type: 'improvement',
    });
  }

  if (metrics.antiPatternHits > 0) {
    addAnnotation({
      detail: 'One of the original code smells is still present in this area.',
      lineNumber: lineForTerms(lines, challenge.evaluation.antiPatterns) ?? fallbackLine,
      title: 'Original smell remains',
      type: 'improvement',
    });
  }

  if (score.errorHandling < 70) {
    addAnnotation({
      detail: 'Make the failure path explicit before polishing smaller details.',
      lineNumber: lineForPattern(lines, /\bfetch\b|\bawait\b|\bthrow\b|\bresponse\b/) ?? fallbackLine,
      title: 'Clarify failure handling',
      type: 'improvement',
    });
  }

  if (score.modularity < 70) {
    addAnnotation({
      detail: 'Separate one responsibility into a focused helper so it is easier to test.',
      lineNumber: lineForPattern(lines, /\bfunction\b|=>|const\s+[a-zA-Z_$][\w$]*\s*=/) ?? fallbackLine,
      title: 'Split responsibility',
      type: 'improvement',
    });
  }

  if (score.restraint < 70) {
    addAnnotation({
      detail: 'Trim any extra structure that does not directly serve this refactor.',
      lineNumber: fallbackLine,
      title: 'Keep it tighter',
      type: 'improvement',
    });
  }

  return annotations.slice(0, 6);
}

export function evaluateSubmission(
  challenge: Challenge,
  submittedCode: string,
  options: EvaluateOptions,
): EvaluationFeedback {
  const metrics = getCodeMetrics(submittedCode, challenge);
  const score = buildScore(submittedCode, challenge, metrics, options);
  const improvements = buildImprovements(metrics, score, options.runtimeEvaluation);
  const { missedIssues, regressions } = buildConcerns(
    challenge,
    metrics,
    score,
    options.runtimeEvaluation,
  );
  const focusSkill = score.errorHandling < 70 ? 'error handling' : challenge.primarySkill;

  return {
    coachNote:
      score.total >= 82
        ? 'Strong refactor. The behavior signals are preserved and the design is easier to discuss.'
        : 'Good iteration. Keep tightening the highest-risk responsibility before polishing smaller details.',
    improvements,
    missedIssues,
    nextRecommendation: `Practice another challenge that stresses ${focusSkill}.`,
    regressions,
    reviewAnnotations: buildReviewAnnotations(submittedCode, challenge, metrics, score),
    runtimeEvaluation: options.runtimeEvaluation,
    score,
  };
}

function issue(
  category: SkillId,
  severity: CodeIssue['severity'],
  title: string,
  detail: string,
): CodeIssue {
  return { category, detail, severity, title };
}

function analysisScore(skill: SkillId, value: number, rationale: string): CodeAnalysisScore {
  return { rationale, skill, value: clamp(value) };
}

function buildAnalysisScores(metrics: CodeMetrics): CodeAnalysisScore[] {
  return [
    analysisScore(
      'readability',
      88 - metrics.antiPatternHits * 8 - metrics.consoleLogs * 5 - Math.max(0, metrics.averageLineLength - 88) * 0.5,
      metrics.antiPatternHits ? 'Some cleanup signals are still visible.' : 'The snippet has a readable surface.',
    ),
    analysisScore(
      'complexity',
      96 - Math.max(0, metrics.maxIndentDepth - 2) * 16,
      metrics.maxIndentDepth > 3 ? 'Nested paths make the main flow harder to scan.' : 'The main flow stays reasonably shallow.',
    ),
    analysisScore(
      'naming',
      92 - metrics.vagueNames * 10,
      metrics.vagueNames ? 'A few names hide intent.' : 'Names give the reader useful intent.',
    ),
    analysisScore(
      'modularity',
      46 + Math.min(metrics.functionCount, 4) * 12,
      metrics.functionCount < 2 ? 'There may be room for focused helper functions.' : 'Behavior is separated into reviewable units.',
    ),
    analysisScore(
      'error-handling',
      48 + Number(metrics.hasTryCatch) * 22 + Number(metrics.hasResponseCheck) * 22,
      metrics.hasTryCatch || metrics.hasResponseCheck
        ? 'A failure path is visible.'
        : 'Risky paths would benefit from explicit failure handling.',
    ),
    analysisScore(
      'testing',
      52 + Math.min(metrics.functionCount, 3) * 10 + Number(!metrics.consoleLogs) * 10,
      metrics.functionCount > 1 ? 'Smaller units are easier to test.' : 'A single large unit may be harder to test.',
    ),
  ];
}

function buildAnalysisStrengths(metrics: CodeMetrics, scores: CodeAnalysisScore[]): string[] {
  const strengths: string[] = [];

  if (metrics.syntaxValid) {
    strengths.push('Parses as JavaScript.');
  }

  if (metrics.functionCount > 1) {
    strengths.push('Has more than one reviewable unit.');
  }

  if (!metrics.consoleLogs) {
    strengths.push('No debug logging found in the main path.');
  }

  const strongestScore = [...scores].sort((left, right) => right.value - left.value)[0];
  if (strongestScore && strongestScore.value >= 80) {
    strengths.push(`${strongestScore.skill} is currently the strongest signal.`);
  }

  return strengths.slice(0, 4);
}

export function analyzeSnippet(source: string): CodeAnalysisResult {
  const fakeChallenge: Challenge = {
    applicationContext: 'Ad hoc analysis',
    createdAt: new Date().toISOString(),
    description: '',
    difficulty: 'beginner',
    estimateMinutes: 0,
    evaluation: {
      antiPatterns: ['console.log', 'var ', 'tmp', '==', 'if ('],
      expectedTerms: [],
      maxVagueNames: 0,
      minFunctionCount: 1,
      preferredTerms: ['try', 'catch', 'return', 'validate', 'normalize'],
      requiredBehavior: [],
    },
    hiddenTargets: {
      insertedProblems: [],
      primarySkill: 'readability',
      requiredBehavior: [],
      secondarySkills: [],
    },
    hints: [],
    id: 'snippet',
    instructions: [],
    language: 'javascript',
    primarySkill: 'readability',
    referenceCode: '',
    secondarySkills: [],
    slug: 'snippet',
    startingCode: source,
    title: 'Snippet',
    type: 'find-the-problems',
    visibleProblems: [],
  };
  const metrics = getCodeMetrics(source, fakeChallenge);
  const scores = buildAnalysisScores(metrics);
  const issues: CodeIssue[] = [];

  if (!metrics.syntaxValid) {
    issues.push(issue('testing', 'high', 'Syntax issue', 'The snippet does not parse cleanly.'));
  }

  if (metrics.maxIndentDepth >= 4) {
    issues.push(
      issue('complexity', 'high', 'Deep nesting', 'Nested paths make behavior harder to verify.'),
    );
  }

  if (metrics.vagueNames > 2) {
    issues.push(
      issue('naming', 'medium', 'Vague names', 'Names like data, tmp, x, y, or z hide intent.'),
    );
  }

  if (metrics.consoleLogs > 0) {
    issues.push(
      issue('readability', 'low', 'Debug logging', 'Debug logging should not live in core logic.'),
    );
  }

  if (!metrics.hasTryCatch && /\bfetch\s*\(|\bawait\b/.test(source)) {
    issues.push(
      issue(
        'error-handling',
        'high',
        'Async failure path',
        'Async or network work should have an explicit failure strategy.',
      ),
    );
  }

  if (metrics.functionCount < 2 && metrics.lineCount > 28) {
    issues.push(
      issue(
        'modularity',
        'medium',
        'Large unit',
        'This code may benefit from one or two focused helper functions.',
      ),
    );
  }

  const recommendedSkill = issues[0]?.category ?? 'readability';

  return {
    issues,
    recommendedSkill,
    scores,
    strengths: buildAnalysisStrengths(metrics, scores),
    summary: issues.length
      ? `Found ${issues.length} coaching signal${issues.length === 1 ? '' : 's'}.`
      : 'No major coaching signals found in this snippet.',
  };
}

export function getScoreForSkill(feedback: EvaluationFeedback, skill: SkillId): number {
  switch (skill) {
    case 'architecture':
      return Math.round((feedback.score.modularity + feedback.score.restraint) / 2);
    case 'async-programming':
      return feedback.score.errorHandling;
    case 'code-review':
      return feedback.score.reasoning;
    case 'complexity':
      return feedback.score.complexity;
    case 'error-handling':
      return feedback.score.errorHandling;
    case 'modularity':
      return feedback.score.modularity;
    case 'naming':
      return feedback.score.naming;
    case 'performance':
      return feedback.score.codeQuality;
    case 'readability':
      return feedback.score.codeQuality;
    case 'restraint':
      return feedback.score.restraint;
    case 'security':
      return Math.round((feedback.score.errorHandling + feedback.score.correctness) / 2);
    case 'testing':
      return feedback.score.testability;
  }
}
