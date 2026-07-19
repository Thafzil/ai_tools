import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  LucideAlertTriangle,
  LucideBarChart3,
  LucideBrain,
  LucideCheckCircle2,
  LucideChevronRight,
  LucideClock,
  LucideLightbulb,
  LucidePlay,
  LucideRotateCcw,
  LucideSend,
  LucideSparkles,
  LucideTarget,
  LucideX,
} from '@lucide/angular';
import { finalize } from 'rxjs';
import { NeatCodeApiService } from './neatcode-api.service';
import { labelize } from './neatcode-labels';
import {
  type Attempt,
  type Challenge,
  type ChallengeHint,
  type ChallengeSummary,
  type CodingLevel,
  type JsonValue,
  type PracticeStats,
  type PublicUser,
  type RuntimeCaseResult,
  type RuntimeEvaluation,
  type RuntimeExecutionOutcome,
  type SkillId,
  type UserProfile,
} from './neatcode.types';

type AuthMode = 'login' | 'signup';
type TimerState = 'idle' | 'running' | 'submitted';

interface SkillRow {
  label: string;
  skill: SkillId;
  value: number;
}

const emptyPracticeStats: PracticeStats = {
  acceptedSubmissions: 0,
  totalPracticeSeconds: 0,
  totalSubmissions: 0,
};

@Component({
  selector: 'neatcode-academy',
  imports: [
    CommonModule,
    FormsModule,
    LucideAlertTriangle,
    LucideBarChart3,
    LucideBrain,
    LucideCheckCircle2,
    LucideChevronRight,
    LucideClock,
    LucideLightbulb,
    LucidePlay,
    LucideRotateCcw,
    LucideSend,
    LucideSparkles,
    LucideTarget,
    LucideX,
  ],
  templateUrl: './neatcode-academy.component.html',
  styleUrl: './neatcode-academy.component.scss',
})
export class NeatCodeAcademyComponent implements OnInit {
  private readonly api = inject(NeatCodeApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly authCodingLevel = signal<CodingLevel>('beginner');
  protected readonly authDisplayName = signal('');
  protected readonly authEmail = signal('');
  protected readonly authError = signal('');
  protected readonly authLoading = signal(false);
  protected readonly authMode = signal<AuthMode>('login');
  protected readonly authPassword = signal('');
  protected readonly challenges = signal<ChallengeSummary[]>([]);
  protected readonly code = signal('');
  protected readonly currentUser = signal<PublicUser | null>(null);
  protected readonly elapsedSeconds = signal(0);
  protected readonly error = signal('');
  protected readonly formatting = signal(false);
  protected readonly hints = signal<ChallengeHint[]>([]);
  protected readonly lastAttempt = signal<Attempt | null>(null);
  protected readonly loading = signal(true);
  protected readonly nextChallenge = signal<Challenge | null>(null);
  protected readonly profile = signal<UserProfile | null>(null);
  protected readonly runtimeLoading = signal(false);
  protected readonly runInput = signal('[]');
  protected readonly runInputError = signal('');
  protected readonly runResult = signal<RuntimeExecutionOutcome | null>(null);
  protected readonly selectedChallenge = signal<Challenge | null>(null);
  protected readonly stats = signal<PracticeStats>(emptyPracticeStats);
  protected readonly status = signal('Preparing practice workspace');
  protected readonly submitting = signal(false);
  protected readonly timerState = signal<TimerState>('idle');
  protected readonly behaviorResult = computed<RuntimeEvaluation | null>(
    () => this.lastAttempt()?.feedback.runtimeEvaluation ?? null,
  );
  protected readonly isAuthenticated = computed(() => !!this.currentUser());
  protected readonly hasProfileSignals = computed(() => (this.profile()?.totalAttempts ?? 0) > 0);
  protected readonly averageScore = computed(() => this.calculateAverageScore(this.profile()));
  protected readonly currentAttempt = computed(() => {
    const attempt = this.lastAttempt();
    const challenge = this.selectedChallenge();

    return attempt && challenge && attempt.challengeId === challenge.id ? attempt : null;
  });
  protected readonly levelLabel = computed(() => this.labelForLevel(this.profile()?.startingLevel));
  protected readonly practiceTimeLabel = computed(() =>
    this.formatDuration(
      this.stats().totalPracticeSeconds +
        (this.timerState() === 'running' ? this.elapsedSeconds() : 0),
    ),
  );
  protected readonly solvedCount = computed(() => this.stats().acceptedSubmissions);
  protected readonly totalSubmissions = computed(() => this.stats().totalSubmissions);

  protected readonly skillRows = computed<SkillRow[]>(() => {
    const scores = this.profile()?.skillScores;

    if (!scores || !this.hasProfileSignals()) {
      return [];
    }

    return (Object.entries(scores) as Array<[SkillId, number]>)
      .map(([skill, value]) => ({ label: labelize(skill), skill, value }))
      .sort((left, right) => left.value - right.value);
  });

  private savedElapsedSeconds = 0;
  private errorHideTimer = 0;
  private solveStartedAt = 0;

  ngOnInit(): void {
    if (this.api.getToken()) {
      this.loadWorkspace();
    } else {
      this.loading.set(false);
      this.status.set('Sign in to start practice');
    }

    const timerId = window.setInterval(() => this.refreshTimer(), 1000);

    this.destroyRef.onDestroy(() => {
      window.clearInterval(timerId);
      this.clearErrorTimer();
    });
  }

  protected logout(): void {
    this.api.clearToken();
    this.clearError();
    this.currentUser.set(null);
    this.profile.set(null);
    this.stats.set(emptyPracticeStats);
    this.challenges.set([]);
    this.selectedChallenge.set(null);
    this.lastAttempt.set(null);
    this.nextChallenge.set(null);
    this.runResult.set(null);
    this.runInputError.set('');
    this.runtimeLoading.set(false);
    this.hints.set([]);
    this.authPassword.set('');
    this.resetSolveTimer();
    this.status.set('Signed out');
  }

  protected setAuthMode(mode: AuthMode): void {
    this.authMode.set(mode);
    this.authError.set('');
  }

  protected submitAuth(): void {
    if (this.authLoading()) {
      return;
    }

    const email = this.authEmail().trim();
    const password = this.authPassword();
    const displayName = this.authDisplayName().trim();

    if (!email || !password || (this.authMode() === 'signup' && !displayName)) {
      this.authError.set('Fill in the required account fields.');
      return;
    }

    this.authLoading.set(true);
    this.authError.set('');
    this.status.set(this.authMode() === 'signup' ? 'Creating account' : 'Signing in');

    const request =
      this.authMode() === 'signup'
        ? this.api.signup(displayName, email, password, this.authCodingLevel())
        : this.api.login(email, password);

    request.pipe(finalize(() => this.authLoading.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        this.api.setToken(response.token);
        this.currentUser.set(response.user);
        this.clearError();
        this.authPassword.set('');
        this.loadWorkspace();
      },
      error: (error: unknown) => {
        this.authError.set(this.readApiMessage(error, 'Account request failed'));
        this.status.set('Account action needed');
      },
    });
  }

  protected loadChallenge(challengeId: string): void {
    if (this.selectedChallenge()?.id === challengeId) {
      return;
    }

    this.status.set('Loading challenge');
    this.api
      .getChallenge(challengeId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (challenge) => {
          this.clearError();
          this.setChallenge(challenge, { clearAttempt: true });
        },
        error: (error: unknown) => this.showApiError('Could not load that challenge', error),
      });
  }

  protected resetCode(): void {
    const challenge = this.selectedChallenge();

    if (!challenge) {
      return;
    }

    this.code.set(challenge.startingCode);
    this.hints.set([]);
    this.lastAttempt.set(null);
    this.nextChallenge.set(null);
    this.runResult.set(null);
    this.runInputError.set('');
    this.clearError();
    this.challenges.set([this.summaryFromChallenge(challenge)]);
    this.runInput.set(this.defaultRunInputFor(challenge));
    this.status.set('Code reset');
  }

  protected showNextHint(): void {
    const challenge = this.selectedChallenge();

    if (!challenge || this.hints().length >= challenge.hintCount) {
      return;
    }

    const nextLevel = this.hints().length + 1;
    this.status.set(`Unlocking hint ${nextLevel}`);
    this.api
      .getHint(challenge.id, nextLevel)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (hint) => {
          this.clearError();
          this.hints.update((current) => [...current, hint]);
          this.status.set(`Hint ${nextLevel} unlocked`);
        },
        error: (error: unknown) => this.showApiError('Could not unlock that hint', error),
      });
  }

  protected runCode(): void {
    const challenge = this.selectedChallenge();

    if (!challenge || this.runtimeLoading()) {
      return;
    }

    const args = this.parseRunInput();

    if (!args) {
      return;
    }

    this.runtimeLoading.set(true);
    this.status.set(`Running ${challenge.runtime?.entryPoint || 'function'}`);
    this.api
      .runCode(challenge.id, this.code(), args)
      .pipe(
        finalize(() => this.runtimeLoading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (response) => {
          this.clearError();
          this.runResult.set(response.outcome);
          this.status.set(response.outcome.status === 'threw' ? 'Function returned an error' : 'Function run complete');
        },
        error: (error: unknown) => this.showApiError('Could not run the code', error),
      });
  }

  protected async formatCode(): Promise<void> {
    const source = this.code();

    if (!source.trim() || this.formatting()) {
      return;
    }

    this.formatting.set(true);
    this.status.set('Formatting code');

    try {
      const [prettier, babelPlugin, estreePlugin] = await Promise.all([
        import('prettier/standalone'),
        import('prettier/plugins/babel'),
        import('prettier/plugins/estree'),
      ]);
      const formatted = await prettier.format(source, {
        parser: 'babel',
        plugins: [babelPlugin.default, estreePlugin.default],
        printWidth: 92,
        semi: true,
        singleQuote: true,
        trailingComma: 'all',
      });

      this.code.set(formatted.trimEnd());
      this.runResult.set(null);
      this.startSolveTimer();
      this.status.set('Code formatted');
    } catch {
      this.status.set('Could not format this JavaScript yet');
    } finally {
      this.formatting.set(false);
    }
  }

  protected submitRefactor(): void {
    const challenge = this.selectedChallenge();

    if (!challenge || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    const durationSeconds = this.stopSolveTimer('submitted');
    this.status.set('Evaluating refactor');
    this.api
      .submitRefactor({
        challengeId: challenge.id,
        code: this.code(),
        durationSeconds,
        explanation: '',
        hintsUsed: this.hints().length,
      })
      .pipe(
        finalize(() => this.submitting.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (response) => {
          this.clearError();
          this.profile.set(response.profile);
          this.stats.set(response.stats);
          this.lastAttempt.set(response.attempt);
          this.nextChallenge.set(response.nextChallenge);
          this.runResult.set(null);
          this.challenges.set([this.summaryFromChallenge(challenge)]);
          this.status.set(
            response.accepted
              ? response.nextChallenge
                ? `AI scored ${response.attempt.feedback.score.total}/100 · next question ready`
                : `AI scored ${response.attempt.feedback.score.total}/100 · prepare the next question`
              : 'Output changed. Match the original behavior before AI scoring.',
          );
        },
        error: (error: unknown) => this.showApiError('Could not submit the refactor', error),
      });
  }

  protected startNextChallenge(): void {
    const challenge = this.nextChallenge();

    if (!challenge) {
      return;
    }

    this.nextChallenge.set(null);
    this.challenges.set([this.summaryFromChallenge(challenge)]);
    this.setChallenge(challenge, { clearAttempt: true });
    this.status.set('Next adaptive question ready');
  }

  protected dismissError(): void {
    this.clearError();
  }

  protected prepareNextChallenge(): void {
    if (this.loading()) {
      return;
    }

    this.status.set('Preparing next adaptive question');
    this.loadWorkspace();
  }

  protected updateAuthDisplayName(value: string): void {
    this.authDisplayName.set(value);
  }

  protected updateAuthCodingLevel(value: string): void {
    if (value === 'beginner' || value === 'intermediate' || value === 'advanced' || value === 'expert') {
      this.authCodingLevel.set(value);
    }
  }

  protected updateAuthEmail(value: string): void {
    this.authEmail.set(value);
  }

  protected updateAuthPassword(value: string): void {
    this.authPassword.set(value);
  }

  protected updateCode(value: string): void {
    this.code.set(value);
    this.runResult.set(null);
    this.startSolveTimer();
  }

  protected updateRunInput(value: string): void {
    this.runInput.set(value);
    this.runInputError.set('');
    this.runResult.set(null);
  }

  protected labelForSkill(skill: SkillId | string | undefined): string {
    return skill ? labelize(skill) : 'Practice';
  }

  protected labelsForSkills(skills: SkillId[]): string {
    return skills.map((skill) => this.labelForSkill(skill)).join(', ');
  }

  protected challengeTagLabels(challenge: Challenge): string[] {
    const tags = challenge.tags?.length
      ? challenge.tags
      : [challenge.primarySkill, ...challenge.secondarySkills];

    return tags.map((tag) => this.labelForSkill(tag));
  }

  protected labelForLevel(level: CodingLevel | string | undefined): string {
    return this.labelForSkill(level || 'beginner');
  }

  protected formatOutcome(outcome: RuntimeExecutionOutcome): string {
    if (outcome.status === 'threw') {
      return `Error: ${outcome.error || 'Unknown runtime error'}`;
    }

    return this.formatRuntimeValue(outcome.value);
  }

  protected formatRuntimeValue(value: unknown): string {
    if (value === undefined) {
      return 'undefined';
    }

    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  protected isBehaviorBlocked(attempt: Attempt): boolean {
    const runtime = attempt.feedback.runtimeEvaluation;
    return Boolean(runtime?.total && !runtime.passed);
  }

  protected failedRuntimeCases(attempt: Attempt): RuntimeCaseResult[] {
    return (attempt.feedback.runtimeEvaluation?.cases ?? [])
      .filter((testCase) => !testCase.passed)
      .slice(0, 3);
  }

  protected improvementAreas(attempt: Attempt): string[] {
    const feedback = attempt.feedback;
    const areas = [...feedback.missedIssues, ...feedback.regressions]
      .map((item) => item.trim())
      .filter(Boolean);

    if (areas.length) {
      return areas.slice(0, 4);
    }

    return feedback.nextRecommendation ? [feedback.nextRecommendation] : [];
  }

  private loadWorkspace(): void {
    this.loading.set(true);
    this.status.set('Preparing current question');
    this.api
      .bootstrap()
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (payload) => {
          this.clearError();
          this.challenges.set(payload.challenges);
          this.currentUser.set(payload.user);
          this.profile.set(payload.profile);
          this.stats.set(payload.stats);
          this.lastAttempt.set(
            payload.lastAttempt?.challengeId === payload.recommendedChallenge.id
              ? payload.lastAttempt
              : null,
          );
          this.nextChallenge.set(null);
          this.setChallenge(payload.recommendedChallenge);
          this.status.set('Ready for practice');
        },
        error: (error: unknown) => this.showApiError('NEATCODE API is unavailable', error),
      });
  }

  private setChallenge(challenge: Challenge, options: { clearAttempt?: boolean } = {}): void {
    this.selectedChallenge.set(challenge);
    this.code.set(challenge.startingCode);
    this.hints.set([]);
    this.nextChallenge.set(null);
    this.runInput.set(this.defaultRunInputFor(challenge));
    this.runInputError.set('');
    this.runResult.set(null);
    if (options.clearAttempt) {
      this.lastAttempt.set(null);
    }
    this.resetSolveTimer();
  }

  private summaryFromChallenge(challenge: Challenge): ChallengeSummary {
    return {
      applicationContext: challenge.applicationContext,
      difficulty: challenge.difficulty,
      estimateMinutes: challenge.estimateMinutes,
      id: challenge.id,
      primarySkill: challenge.primarySkill,
      secondarySkills: challenge.secondarySkills,
      slug: challenge.slug,
      title: challenge.title,
      type: challenge.type,
    };
  }

  private currentElapsedSeconds(): number {
    if (this.timerState() !== 'running' || !this.solveStartedAt) {
      return this.savedElapsedSeconds;
    }

    return this.savedElapsedSeconds + Math.floor((Date.now() - this.solveStartedAt) / 1000);
  }

  private refreshTimer(): void {
    if (this.timerState() === 'running') {
      this.elapsedSeconds.set(this.currentElapsedSeconds());
    }
  }

  private resetSolveTimer(): void {
    this.savedElapsedSeconds = 0;
    this.solveStartedAt = 0;
    this.elapsedSeconds.set(0);
    this.timerState.set('idle');
  }

  private startSolveTimer(): void {
    if (!this.selectedChallenge() || this.submitting()) {
      return;
    }

    if (this.timerState() === 'running') {
      return;
    }

    if (this.timerState() === 'submitted') {
      this.savedElapsedSeconds = 0;
      this.elapsedSeconds.set(0);
      this.lastAttempt.set(null);
      this.nextChallenge.set(null);
      this.runResult.set(null);
      const challenge = this.selectedChallenge();
      if (challenge) {
        this.challenges.set([this.summaryFromChallenge(challenge)]);
      }
      this.status.set('Refining solution');
    }

    this.solveStartedAt = Date.now();
    this.timerState.set('running');
  }

  private stopSolveTimer(nextState: TimerState): number {
    this.savedElapsedSeconds = this.currentElapsedSeconds();
    this.solveStartedAt = 0;
    this.elapsedSeconds.set(this.savedElapsedSeconds);
    this.timerState.set(nextState);
    return this.savedElapsedSeconds;
  }

  private calculateAverageScore(profile: UserProfile | null): number {
    if (!profile || profile.totalAttempts === 0) {
      return 0;
    }

    const values = Object.values(profile.skillScores);
    const total = values.reduce((sum, score) => sum + score, 0);
    return Math.round(total / Math.max(values.length, 1));
  }

  private formatDuration(seconds: number): string {
    const minutes = Math.max(0, Math.round(seconds / 60));

    if (minutes < 60) {
      return `${minutes} min`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  private defaultRunInputFor(challenge: Challenge): string {
    const args = challenge.runtime?.testCases?.[0]?.args ?? [];
    return JSON.stringify(args, null, 2);
  }

  private parseRunInput(): JsonValue[] | null {
    const rawInput = this.runInput().trim();

    try {
      const parsed = JSON.parse(rawInput || '[]') as JsonValue;

      if (!Array.isArray(parsed)) {
        this.runInputError.set('Input must be a JSON array of function arguments.');
        return null;
      }

      this.runInputError.set('');
      return parsed;
    } catch {
      this.runInputError.set('Input must be valid JSON, for example ["active", 3].');
      return null;
    }
  }

  private showApiError(message: string, error?: unknown): void {
    this.error.set(this.readApiMessage(error, `${message}. The practice workspace is unavailable right now.`));
    this.scheduleErrorAutoHide();
    this.status.set('Connection needed');
  }

  private clearError(): void {
    this.error.set('');
    this.clearErrorTimer();
  }

  private clearErrorTimer(): void {
    if (!this.errorHideTimer) {
      return;
    }

    window.clearTimeout(this.errorHideTimer);
    this.errorHideTimer = 0;
  }

  private scheduleErrorAutoHide(): void {
    this.clearErrorTimer();
    this.errorHideTimer = window.setTimeout(() => {
      this.error.set('');
      this.errorHideTimer = 0;
    }, 8000);
  }

  private readApiMessage(error: unknown, fallback: string): string {
    const candidate = error as { error?: { message?: unknown }; status?: number } | null;
    const message = candidate?.error?.message;

    if (candidate?.status === 401) {
      this.api.clearToken();
      this.currentUser.set(null);
      return 'Please sign in again to continue.';
    }

    return typeof message === 'string' && message.trim() ? message : fallback;
  }
}
