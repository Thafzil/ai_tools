import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import {
  type AuthResponse,
  type BootstrapPayload,
  type Challenge,
  type ChallengeHint,
  type CodingLevel,
  type JsonValue,
  type RuntimeResponse,
  type SubmitResponse,
} from './neatcode.types';

interface ChallengeResponse {
  challenge: Challenge;
}

interface HintResponse {
  hint: ChallengeHint;
}

interface SubmitRefactorRequest {
  challengeId: string;
  code: string;
  durationSeconds: number;
  explanation: string;
  hintsUsed: number;
}

const TOKEN_STORAGE_KEY = 'neatcode.auth.token';

@Injectable({ providedIn: 'root' })
export class NeatCodeApiService {
  private readonly baseUrl = '/api/neatcode';

  constructor(private readonly http: HttpClient) {}

  getToken(): string {
    try {
      return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  }

  setToken(token: string): void {
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } catch {
      // Ignore storage failures; the current in-memory session still works until reload.
    }
  }

  clearToken(): void {
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/auth/login`, { email, password });
  }

  signup(
    displayName: string,
    email: string,
    password: string,
    codingLevel: CodingLevel,
  ): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/auth/signup`, {
      codingLevel,
      displayName,
      email,
      password,
    });
  }

  bootstrap(): Observable<BootstrapPayload> {
    return this.http.get<BootstrapPayload>(`${this.baseUrl}/bootstrap`, {
      headers: this.authHeaders(),
    });
  }

  getChallenge(challengeId: string): Observable<Challenge> {
    return this.http
      .get<ChallengeResponse>(`${this.baseUrl}/challenges/${challengeId}`, {
        headers: this.authHeaders(),
      })
      .pipe(map((response) => response.challenge));
  }

  getHint(challengeId: string, level: number): Observable<ChallengeHint> {
    return this.http
      .post<HintResponse>(
        `${this.baseUrl}/challenges/${challengeId}/hints`,
        { level },
        { headers: this.authHeaders() },
      )
      .pipe(map((response) => response.hint));
  }

  submitRefactor(options: SubmitRefactorRequest): Observable<SubmitResponse> {
    return this.http.post<SubmitResponse>(
      `${this.baseUrl}/challenges/${options.challengeId}/submit`,
      {
        code: options.code,
        durationSeconds: options.durationSeconds,
        explanation: options.explanation,
        hintsUsed: options.hintsUsed,
      },
      { headers: this.authHeaders() },
    );
  }

  runCode(challengeId: string, code: string, args: JsonValue[]): Observable<RuntimeResponse> {
    return this.http.post<RuntimeResponse>(
      `${this.baseUrl}/challenges/${challengeId}/run`,
      { args, code },
      { headers: this.authHeaders() },
    );
  }

  private authHeaders(): HttpHeaders {
    const token = this.getToken();
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }
}
