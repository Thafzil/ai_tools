import mongoose, { Schema } from 'mongoose';
import {
  createDefaultSkillScores,
  type Attempt,
  type Challenge,
  type CodingLevel,
  type ChallengeSummary,
  type SkillId,
  skillIds,
  type UserAccount,
  type UserProfile,
} from './domain';

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

export interface RepositoryHealth {
  connected: boolean;
  detail: string;
  mode: 'memory' | 'mongo';
}

export interface NeatCodeRepository {
  createUser(account: UserAccount): Promise<UserAccount>;
  findUserByEmail(email: string): Promise<UserAccount | null>;
  findUserById(userId: string): Promise<UserAccount | null>;
  getChallenge(userId: string, challengeId: string): Promise<Challenge | null>;
  getHealth(): RepositoryHealth;
  getLastAttempt(userId: string): Promise<Attempt | null>;
  getProfile(userId: string): Promise<UserProfile>;
  listAttempts(userId: string, limit?: number): Promise<Attempt[]>;
  listChallenges(userId: string): Promise<Challenge[]>;
  saveAttempt(attempt: Attempt): Promise<Attempt>;
  saveChallenge(challenge: Challenge): Promise<Challenge>;
  saveProfile(profile: UserProfile): Promise<UserProfile>;
}

interface CreateRepositoryOptions {
  allowMemoryFallback: boolean;
  mongoDbName: string;
  mongoUri: string;
}

const challengeSchema = new Schema<Challenge>(
  {
    id: { type: String, required: true, unique: true },
  },
  { strict: false, versionKey: false },
);

const attemptSchema = new Schema<Attempt>(
  {
    challengeId: { type: String, index: true, required: true },
    createdAt: { type: String, index: true, required: true },
    id: { type: String, required: true, unique: true },
    userId: { type: String, index: true, required: true },
  },
  { strict: false, versionKey: false },
);

const profileSchema = new Schema<UserProfile>(
  {
    userId: { type: String, required: true, unique: true },
  },
  { strict: false, versionKey: false },
);

const userSchema = new Schema<UserAccount>(
  {
    email: { type: String, index: true, required: true, unique: true },
    id: { type: String, required: true, unique: true },
  },
  { strict: false, versionKey: false },
);

function toSummary(challenge: Challenge): ChallengeSummary {
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

export function summarizeChallenges(challenges: Challenge[]): ChallengeSummary[] {
  return challenges.map(toSummary);
}

function scoreForLevel(level: CodingLevel): number {
  switch (level) {
    case 'beginner':
      return 42;
    case 'intermediate':
      return 58;
    case 'advanced':
      return 76;
    case 'expert':
      return 88;
  }
}

export function createDefaultProfile(
  userId: string,
  displayName = 'Practice Developer',
  startingLevel: CodingLevel = 'beginner',
): UserProfile {
  return {
    completedChallenges: [],
    currentFocus: 'readability',
    displayName,
    skillScores: createDefaultSkillScores(scoreForLevel(startingLevel)),
    startingLevel,
    totalAttempts: 0,
    updatedAt: new Date().toISOString(),
    userId,
  };
}

export function chooseRecommendedChallenge(
  profile: UserProfile,
  challenges: Challenge[],
): Challenge {
  if (!challenges.length) {
    throw new Error('No practice challenges are available for this user.');
  }

  const skillPriority =
    profile.totalAttempts === 0
      ? starterSkillOrder.map((skill) => ({ skill, score: profile.skillScores[skill] }))
      : skillIds
          .map((skill) => ({ skill, score: profile.skillScores[skill] }))
          .sort((left, right) => left.score - right.score);

  for (const { skill } of skillPriority) {
    const unsolvedMatch = challenges.find(
      (challenge) =>
        !profile.completedChallenges.includes(challenge.id) &&
        (challenge.primarySkill === skill || challenge.secondarySkills.includes(skill)),
    );

    if (unsolvedMatch) {
      return unsolvedMatch;
    }
  }

  return challenges[0];
}

export function updateProfileAfterAttempt(
  profile: UserProfile,
  challenge: Challenge,
  scoreBySkill: (skill: SkillId) => number,
): UserProfile {
  const nextScores = { ...profile.skillScores };
  const practicedSkills = [challenge.primarySkill, ...challenge.secondarySkills];

  for (const skill of practicedSkills) {
    nextScores[skill] = Math.round(nextScores[skill] * 0.72 + scoreBySkill(skill) * 0.28);
  }

  const currentFocus = skillIds
    .map((skill) => ({ skill, score: nextScores[skill] }))
    .sort((left, right) => left.score - right.score)[0].skill;

  return {
    ...profile,
    completedChallenges: Array.from(new Set([...profile.completedChallenges, challenge.id])),
    currentFocus,
    skillScores: nextScores,
    totalAttempts: profile.totalAttempts + 1,
    updatedAt: new Date().toISOString(),
  };
}

class MemoryRepository implements NeatCodeRepository {
  private readonly attempts = new Map<string, Attempt>();
  private readonly challenges = new Map<string, Challenge>();
  private readonly profiles = new Map<string, UserProfile>();
  private readonly users = new Map<string, UserAccount>();

  constructor(private readonly detail = 'Using in-memory development store') {}

  getHealth(): RepositoryHealth {
    return { connected: true, detail: this.detail, mode: 'memory' };
  }

  async createUser(account: UserAccount): Promise<UserAccount> {
    const emailExists = Array.from(this.users.values()).some((user) => user.email === account.email);

    if (emailExists) {
      throw new Error('A user with that email already exists.');
    }

    this.users.set(account.id, account);
    return account;
  }

  async findUserByEmail(email: string): Promise<UserAccount | null> {
    return Array.from(this.users.values()).find((user) => user.email === email) ?? null;
  }

  async findUserById(userId: string): Promise<UserAccount | null> {
    return this.users.get(userId) ?? null;
  }

  async getChallenge(userId: string, challengeId: string): Promise<Challenge | null> {
    const challenge = this.challenges.get(challengeId);

    if (!challenge || (challenge.ownerUserId && challenge.ownerUserId !== userId)) {
      return null;
    }

    return challenge;
  }

  async getLastAttempt(userId: string): Promise<Attempt | null> {
    const attempts = await this.listAttempts(userId, 1);
    return attempts[0] ?? null;
  }

  async getProfile(userId: string): Promise<UserProfile> {
    const existingProfile = this.profiles.get(userId);

    if (existingProfile) {
      return existingProfile;
    }

    const profile = createDefaultProfile(userId);
    this.profiles.set(userId, profile);
    return profile;
  }

  async listAttempts(userId: string, limit = 8): Promise<Attempt[]> {
    return Array.from(this.attempts.values())
      .filter((attempt) => attempt.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async listChallenges(userId: string): Promise<Challenge[]> {
    return Array.from(this.challenges.values())
      .filter((challenge) => challenge.ownerUserId === userId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async saveAttempt(attempt: Attempt): Promise<Attempt> {
    this.attempts.set(attempt.id, attempt);
    return attempt;
  }

  async saveChallenge(challenge: Challenge): Promise<Challenge> {
    this.challenges.set(challenge.id, challenge);
    return challenge;
  }

  async saveProfile(profile: UserProfile): Promise<UserProfile> {
    this.profiles.set(profile.userId, profile);
    return profile;
  }
}

class MongoRepository implements NeatCodeRepository {
  private readonly AttemptModel = mongoose.model<Attempt>('NeatCodeAttempt', attemptSchema);
  private readonly ChallengeModel = mongoose.model<Challenge>('NeatCodeChallenge', challengeSchema);
  private readonly ProfileModel = mongoose.model<UserProfile>('NeatCodeProfile', profileSchema);
  private readonly UserModel = mongoose.model<UserAccount>('NeatCodeUser', userSchema);

  constructor(private readonly detail: string) {}

  static async create(mongoUri: string, mongoDbName: string): Promise<MongoRepository> {
    await mongoose.connect(mongoUri, { dbName: mongoDbName });
    return new MongoRepository(`Mongo connected to database "${mongoDbName}"`);
  }

  getHealth(): RepositoryHealth {
    return {
      connected: mongoose.connection.readyState === 1,
      detail: this.detail,
      mode: 'mongo',
    };
  }

  async createUser(account: UserAccount): Promise<UserAccount> {
    await this.UserModel.create(account);
    return account;
  }

  async findUserByEmail(email: string): Promise<UserAccount | null> {
    const user = await this.UserModel.findOne({ email }).lean();
    return user ? (user as unknown as UserAccount) : null;
  }

  async findUserById(userId: string): Promise<UserAccount | null> {
    const user = await this.UserModel.findOne({ id: userId }).lean();
    return user ? (user as unknown as UserAccount) : null;
  }

  async getChallenge(userId: string, challengeId: string): Promise<Challenge | null> {
    const challenge = await this.ChallengeModel.findOne({
      id: challengeId,
      $or: [{ ownerUserId: userId }, { ownerUserId: { $exists: false } }],
    }).lean();
    return challenge ? (challenge as unknown as Challenge) : null;
  }

  async getLastAttempt(userId: string): Promise<Attempt | null> {
    const attempt = await this.AttemptModel.findOne({ userId }).sort({ createdAt: -1 }).lean();
    return attempt ? (attempt as unknown as Attempt) : null;
  }

  async getProfile(userId: string): Promise<UserProfile> {
    const profile = await this.ProfileModel.findOne({ userId }).lean();

    if (profile) {
      return profile as unknown as UserProfile;
    }

    const nextProfile = createDefaultProfile(userId);
    await this.ProfileModel.create(nextProfile);
    return nextProfile;
  }

  async listAttempts(userId: string, limit = 8): Promise<Attempt[]> {
    const attempts = await this.AttemptModel.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return attempts as unknown as Attempt[];
  }

  async listChallenges(userId: string): Promise<Challenge[]> {
    const challenges = await this.ChallengeModel.find({ ownerUserId: userId })
      .sort({ createdAt: 1 })
      .lean();
    return challenges as unknown as Challenge[];
  }

  async saveAttempt(attempt: Attempt): Promise<Attempt> {
    await this.AttemptModel.create(attempt);
    return attempt;
  }

  async saveChallenge(challenge: Challenge): Promise<Challenge> {
    await this.ChallengeModel.updateOne({ id: challenge.id }, challenge, { upsert: true });
    return challenge;
  }

  async saveProfile(profile: UserProfile): Promise<UserProfile> {
    await this.ProfileModel.updateOne({ userId: profile.userId }, profile, { upsert: true });
    return profile;
  }

}

export async function createRepository(
  options: CreateRepositoryOptions,
): Promise<NeatCodeRepository> {
  if (!options.mongoUri) {
    if (!options.allowMemoryFallback) {
      throw new Error('MONGO_URI is required when ALLOW_MEMORY_FALLBACK is false.');
    }

    return new MemoryRepository('MONGO_URI is not set; using memory store for local development.');
  }

  try {
    return await MongoRepository.create(options.mongoUri, options.mongoDbName);
  } catch (error) {
    if (!options.allowMemoryFallback) {
      throw error;
    }

    const detail = error instanceof Error ? error.message : 'Unknown Mongo connection error';
    return new MemoryRepository(`Mongo unavailable; using memory store. ${detail}`);
  }
}
