import { randomUUID } from 'crypto';
import type { EbayEnvironment } from '@/config/environment.js';
import type { StoredTokenData } from '@/types/ebay.js';
import { CloudflareKVStore } from '@/auth/kv-store.js';

export interface OAuthConfigRecord {
  source: 'server-default' | 'dynamic-client';
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}

export interface OAuthStateRecord {
  state: string;
  environment: EbayEnvironment;
  createdAt: string;
  returnTo?: string;
  oauthConfig: OAuthConfigRecord;
}

export interface UserTokenRecord {
  userId: string;
  environment: EbayEnvironment;
  tokenData: StoredTokenData;
  oauthConfig: OAuthConfigRecord;
  updatedAt: string;
}

export interface SessionRecord {
  sessionToken: string;
  userId: string;
  environment: EbayEnvironment;
  createdAt: string;
  lastUsedAt: string;
  revokedAt?: string;
}

export interface HandoffRecord {
  handoffToken: string;
  sessionToken: string;
  userId: string;
  environment: EbayEnvironment;
  createdAt: string;
}

export class MultiUserAuthStore {
  private kv = new CloudflareKVStore();

  private stateKey(state: string): string {
    return `oauth_state:${state}`;
  }

  private userTokenKey(userId: string, environment: EbayEnvironment): string {
    return `user:${userId}:env:${environment}:tokens`;
  }

  private sessionKey(sessionToken: string): string {
    return `session:${sessionToken}`;
  }

  private handoffKey(handoffToken: string): string {
    return `handoff:${handoffToken}`;
  }

  async createOAuthState(
    environment: EbayEnvironment,
    oauthConfig: OAuthConfigRecord,
    returnTo?: string
  ): Promise<OAuthStateRecord> {
    const state = randomUUID();
    const record: OAuthStateRecord = {
      state,
      environment,
      createdAt: new Date().toISOString(),
      returnTo,
      oauthConfig,
    };
    await this.kv.put(this.stateKey(state), record, 15 * 60);
    return record;
  }

  async consumeOAuthState(state: string): Promise<OAuthStateRecord | null> {
    const key = this.stateKey(state);
    const record = await this.kv.get<OAuthStateRecord>(key);
    if (record) {
      await this.kv.delete(key);
    }
    return record;
  }

  async saveUserTokens(
    userId: string,
    environment: EbayEnvironment,
    tokenData: StoredTokenData,
    oauthConfig: OAuthConfigRecord
  ): Promise<void> {
    const record: UserTokenRecord = {
      userId,
      environment,
      tokenData,
      oauthConfig,
      updatedAt: new Date().toISOString(),
    };
    await this.kv.put(this.userTokenKey(userId, environment), record);
  }

  async getUserTokens(userId: string, environment: EbayEnvironment): Promise<UserTokenRecord | null> {
    return await this.kv.get<UserTokenRecord>(this.userTokenKey(userId, environment));
  }

  async createSession(userId: string, environment: EbayEnvironment): Promise<SessionRecord> {
    const sessionToken = randomUUID() + randomUUID();
    const now = new Date().toISOString();
    const record: SessionRecord = {
      sessionToken,
      userId,
      environment,
      createdAt: now,
      lastUsedAt: now,
    };
    await this.kv.put(this.sessionKey(sessionToken), record);
    return record;
  }

  async getSession(sessionToken: string): Promise<SessionRecord | null> {
    return await this.kv.get<SessionRecord>(this.sessionKey(sessionToken));
  }

  async touchSession(sessionToken: string): Promise<void> {
    const record = await this.getSession(sessionToken);
    if (!record || record.revokedAt) {
      return;
    }
    record.lastUsedAt = new Date().toISOString();
    await this.kv.put(this.sessionKey(sessionToken), record);
  }

  async revokeSession(sessionToken: string): Promise<void> {
    const record = await this.getSession(sessionToken);
    if (!record) {
      return;
    }
    record.revokedAt = new Date().toISOString();
    await this.kv.put(this.sessionKey(sessionToken), record);
  }

  async deleteSession(sessionToken: string): Promise<void> {
    await this.kv.delete(this.sessionKey(sessionToken));
  }

  async createHandoff(sessionToken: string, userId: string, environment: EbayEnvironment): Promise<HandoffRecord> {
    const handoffToken = randomUUID() + randomUUID();
    const record: HandoffRecord = {
      handoffToken,
      sessionToken,
      userId,
      environment,
      createdAt: new Date().toISOString(),
    };
    await this.kv.put(this.handoffKey(handoffToken), record, 5 * 60);
    return record;
  }

  async consumeHandoff(handoffToken: string): Promise<HandoffRecord | null> {
    const key = this.handoffKey(handoffToken);
    const record = await this.kv.get<HandoffRecord>(key);
    if (record) {
      await this.kv.delete(key);
    }
    return record;
  }
}
