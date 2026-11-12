import { uuidV7 } from '../../../../core/ids/uuid-v7';
import { requireFakeAccount } from '../../../../dev/fake-components';
import { syncPromise } from '../../../../dev/scenarios';
import type { ChannelType } from '../../public-api';
import type {
  NewConnection,
  StoredCandidate,
  StoredConnection,
  StoredSelection,
} from '../connections/connection-store';
import type { FakePlatformStore, FakePost, NewFakePost } from './post-store';

// Kho giả lập Cổng nền tảng chế độ `memory` (005) – theo tài khoản của ngữ cảnh, đồng bộ trong một lượt
// vòng lặp sự kiện (nguyên tử trong tiến trình).

interface OauthState {
  stateHash: string;
  userId: string;
  channelType: ChannelType;
  expiresAt: Date;
  usedAt: Date | null;
}

interface Selection extends StoredSelection {
  expiresAt: Date;
  usedAt: Date | null;
}

interface AccountState {
  connections: StoredConnection[];
  states: OauthState[];
  selections: Selection[];
  posts: FakePost[];
}

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryFakePlatformStore implements FakePlatformStore {
  private readonly accounts = new Map<string, AccountState>();

  private state(): AccountState {
    const accountId = requireFakeAccount();
    let s = this.accounts.get(accountId);
    if (s === undefined) {
      s = { connections: [], states: [], selections: [], posts: [] };
      this.accounts.set(accountId, s);
    }
    return s;
  }

  getConnection(id: string): Promise<StoredConnection | null> {
    return syncPromise(() => {
      const c = this.state().connections.find((x) => x.id === id);
      return c === undefined ? null : clone(c);
    });
  }

  listConnections(): Promise<StoredConnection[]> {
    return syncPromise(() => this.state().connections.map(clone));
  }

  insertConnection(c: NewConnection): Promise<{ connection: StoredConnection; created: boolean }> {
    return syncPromise(() => {
      const s = this.state();
      const live = s.connections.find(
        (x) =>
          x.channelType === c.channelType &&
          x.externalId === c.externalId &&
          x.status !== 'disconnected',
      );
      if (live !== undefined) return { connection: clone(live), created: false };
      const row: StoredConnection = {
        ...c,
        id: uuidV7(),
        status: 'active',
        connectedAt: new Date(),
      };
      s.connections.push(row);
      return { connection: clone(row), created: true };
    });
  }

  disconnect(id: string): Promise<boolean> {
    return syncPromise(() => {
      const c = this.state().connections.find((x) => x.id === id && x.status === 'active');
      if (c === undefined) return false;
      c.status = 'disconnected';
      return true;
    });
  }

  updateTokenExpiry(id: string, expiresAt: Date): Promise<void> {
    return syncPromise(() => {
      const c = this.state().connections.find((x) => x.id === id);
      if (c !== undefined) c.tokenExpiresAt = new Date(expiresAt);
    });
  }

  saveOauthState(s: {
    stateHash: Buffer;
    userId: string;
    channelType: ChannelType;
    expiresAt: Date;
  }): Promise<void> {
    return syncPromise(() => {
      this.state().states.push({
        stateHash: s.stateHash.toString('hex'),
        userId: s.userId,
        channelType: s.channelType,
        expiresAt: s.expiresAt,
        usedAt: null,
      });
    });
  }

  consumeOauthState(
    stateHash: Buffer,
    now: Date,
  ): Promise<{ userId: string; channelType: ChannelType } | null> {
    return syncPromise(() => {
      const hex = stateHash.toString('hex');
      const s = this.state().states.find(
        (x) => x.stateHash === hex && x.usedAt === null && x.expiresAt > now,
      );
      if (s === undefined) return null;
      s.usedAt = now;
      return { userId: s.userId, channelType: s.channelType };
    });
  }

  createSelection(s: {
    channelType: ChannelType;
    userId: string;
    candidates: StoredCandidate[];
    expiresAt: Date;
  }): Promise<string> {
    return syncPromise(() => {
      const id = uuidV7();
      this.state().selections.push({ ...clone(s), id, usedAt: null });
      return id;
    });
  }

  getSelection(id: string, now: Date): Promise<StoredSelection | null> {
    return syncPromise(() => {
      const sel = this.state().selections.find(
        (x) => x.id === id && x.usedAt === null && x.expiresAt > now,
      );
      if (sel === undefined) return null;
      return clone({
        id: sel.id,
        channelType: sel.channelType,
        userId: sel.userId,
        candidates: sel.candidates,
      });
    });
  }

  consumeSelection(id: string, now: Date): Promise<boolean> {
    return syncPromise(() => {
      const sel = this.state().selections.find(
        (x) => x.id === id && x.usedAt === null && x.expiresAt > now,
      );
      if (sel === undefined) return false;
      sel.usedAt = now;
      return true;
    });
  }

  insertPost(p: NewFakePost): Promise<FakePost> {
    return syncPromise(() => {
      const row: FakePost = { ...clone(p), id: uuidV7(), createdAt: new Date() };
      this.state().posts.push(row);
      return clone(row);
    });
  }

  findByProcessingId(processingId: string): Promise<FakePost | null> {
    return syncPromise(() => {
      const p = this.state().posts.find((x) => x.processingId === processingId);
      return p === undefined ? null : clone(p);
    });
  }

  updatePost(
    id: string,
    patch: Partial<Pick<FakePost, 'state' | 'processingOutcome' | 'publishedAt'>>,
  ): Promise<void> {
    return syncPromise(() => {
      const p = this.state().posts.find((x) => x.id === id);
      if (p !== undefined) Object.assign(p, patch);
    });
  }

  findPublishedByStoredHash(
    connectionId: string,
    storedTextHash: string,
    from: Date,
    to: Date,
  ): Promise<FakePost | null> {
    return syncPromise(() => {
      const p = this.state().posts.find(
        (x) =>
          x.connectionId === connectionId &&
          x.storedTextHash === storedTextHash &&
          x.state === 'published' &&
          x.publishedAt !== null &&
          x.publishedAt >= from &&
          x.publishedAt <= to,
      );
      return p === undefined ? null : clone(p);
    });
  }

  listPosts(connectionId?: string): Promise<FakePost[]> {
    return syncPromise(() =>
      this.state()
        .posts.filter((p) => connectionId === undefined || p.connectionId === connectionId)
        .map(clone),
    );
  }

  publishedCount(contentHash: string): Promise<number> {
    return syncPromise(
      () =>
        this.state().posts.filter((p) => p.contentHash === contentHash && p.state === 'published')
          .length,
    );
  }

  reset(): Promise<void> {
    return syncPromise(() => {
      this.accounts.delete(requireFakeAccount());
    });
  }
}
