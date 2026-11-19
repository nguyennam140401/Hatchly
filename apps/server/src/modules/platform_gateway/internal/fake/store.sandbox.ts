import { and, asc, between, count, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { tenantTx } from '../../../../core/db';
import { uuidV7 } from '../../../../core/ids/uuid-v7';
import { requireFakeAccount } from '../../../../dev/fake-components';
import {
  pgFakeConnections,
  pgFakeOauthStates,
  pgFakePosts,
  pgFakeSelections,
} from '../../../../dev/sandbox/schema';
import type { ChannelType } from '../../public-api';
import type {
  NewConnection,
  StoredCandidate,
  StoredConnection,
  StoredSelection,
} from '../connections/connection-store';
import type { FakePlatformStore, FakePost, NewFakePost } from './post-store';

// Kho giả lập Cổng nền tảng chế độ `sandbox` (005, research R10) – bảng `sandbox.pg_fake_*` qua tenantTx
// (RLS): API và Worker thấy chung trạng thái. Chuyển trạng thái bằng cập nhật có điều kiện.

type ConnRow = typeof pgFakeConnections.$inferSelect;
type PostRow = typeof pgFakePosts.$inferSelect;

function toConnection(r: ConnRow): StoredConnection {
  return {
    id: r.id,
    channelType: r.channel_type as ChannelType,
    externalId: r.external_id,
    displayName: r.display_name,
    tokenCiphertext: r.token_ciphertext,
    tokenExpiresAt: r.token_expires_at,
    status: r.status,
    connectedAt: r.connected_at,
  };
}

function toPost(r: PostRow): FakePost {
  return {
    id: r.id,
    connectionId: r.connection_id,
    platformPostId: r.platform_post_id,
    contentHash: r.content_hash,
    storedTextHash: r.stored_text_hash,
    permalink: r.permalink,
    state: r.state,
    processingId: r.processing_id,
    processingOutcome: r.processing_outcome,
    publishedAt: r.published_at,
    createdAt: r.created_at,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SandboxFakePlatformStore implements FakePlatformStore {
  async getConnection(id: string): Promise<StoredConnection | null> {
    if (!UUID.test(id)) return null;
    const [row] = await tenantTx((db) =>
      db.select().from(pgFakeConnections).where(eq(pgFakeConnections.id, id)).limit(1),
    );
    return row === undefined ? null : toConnection(row);
  }

  async listConnections(): Promise<StoredConnection[]> {
    const rows = await tenantTx((db) =>
      db.select().from(pgFakeConnections).orderBy(asc(pgFakeConnections.connected_at)),
    );
    return rows.map(toConnection);
  }

  insertConnection(c: NewConnection): Promise<{ connection: StoredConnection; created: boolean }> {
    const accountId = requireFakeAccount();
    return tenantTx(async (db) => {
      const inserted = await db
        .insert(pgFakeConnections)
        .values({
          id: uuidV7(),
          account_id: accountId,
          channel_type: c.channelType,
          external_id: c.externalId,
          display_name: c.displayName,
          token_ciphertext: c.tokenCiphertext,
          // Bản giả luôn có ngày hết hạn; `null` (Meta không hạn cố định) chỉ có ở bản thật.
          token_expires_at: c.tokenExpiresAt ?? new Date(Date.now() + 3650 * 86_400_000),
        })
        .onConflictDoNothing({
          target: [
            pgFakeConnections.account_id,
            pgFakeConnections.channel_type,
            pgFakeConnections.external_id,
          ],
          where: sql`status <> 'disconnected'`,
        })
        .returning();
      if (inserted[0] !== undefined)
        return { connection: toConnection(inserted[0]), created: true };
      const [live] = await db
        .select()
        .from(pgFakeConnections)
        .where(
          and(
            eq(pgFakeConnections.channel_type, c.channelType),
            eq(pgFakeConnections.external_id, c.externalId),
            ne(pgFakeConnections.status, 'disconnected'),
          ),
        )
        .limit(1);
      if (live === undefined) throw new Error('Kết nối trùng nhưng không đọc lại được');
      return { connection: toConnection(live), created: false };
    });
  }

  async disconnect(id: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const rows = await tenantTx((db) =>
      db
        .update(pgFakeConnections)
        .set({ status: 'disconnected', disconnected_at: new Date() })
        .where(and(eq(pgFakeConnections.id, id), eq(pgFakeConnections.status, 'active')))
        .returning({ id: pgFakeConnections.id }),
    );
    return rows.length > 0;
  }

  async updateTokenExpiry(id: string, expiresAt: Date): Promise<void> {
    await tenantTx((db) =>
      db
        .update(pgFakeConnections)
        .set({ token_expires_at: expiresAt })
        .where(eq(pgFakeConnections.id, id)),
    );
  }

  async saveOauthState(s: {
    stateHash: Buffer;
    userId: string;
    channelType: ChannelType;
    expiresAt: Date;
  }): Promise<void> {
    const accountId = requireFakeAccount();
    await tenantTx((db) =>
      db.insert(pgFakeOauthStates).values({
        account_id: accountId,
        state_hash: s.stateHash,
        user_id: s.userId,
        channel_type: s.channelType,
        expires_at: s.expiresAt,
      }),
    );
  }

  async consumeOauthState(
    stateHash: Buffer,
    now: Date,
  ): Promise<{ userId: string; channelType: ChannelType } | null> {
    const [row] = await tenantTx((db) =>
      db
        .update(pgFakeOauthStates)
        .set({ used_at: now })
        .where(
          and(
            eq(pgFakeOauthStates.state_hash, stateHash),
            isNull(pgFakeOauthStates.used_at),
            gt(pgFakeOauthStates.expires_at, now),
          ),
        )
        .returning({
          userId: pgFakeOauthStates.user_id,
          channelType: pgFakeOauthStates.channel_type,
        }),
    );
    return row === undefined
      ? null
      : { userId: row.userId, channelType: row.channelType as ChannelType };
  }

  async createSelection(s: {
    channelType: ChannelType;
    userId: string;
    candidates: StoredCandidate[];
    expiresAt: Date;
  }): Promise<string> {
    const accountId = requireFakeAccount();
    const id = uuidV7();
    await tenantTx((db) =>
      db.insert(pgFakeSelections).values({
        id,
        account_id: accountId,
        channel_type: s.channelType,
        user_id: s.userId,
        candidates: s.candidates,
        expires_at: s.expiresAt,
      }),
    );
    return id;
  }

  async getSelection(id: string, now: Date): Promise<StoredSelection | null> {
    if (!UUID.test(id)) return null;
    const [row] = await tenantTx((db) =>
      db
        .select()
        .from(pgFakeSelections)
        .where(
          and(
            eq(pgFakeSelections.id, id),
            isNull(pgFakeSelections.used_at),
            gt(pgFakeSelections.expires_at, now),
          ),
        )
        .limit(1),
    );
    if (row === undefined) return null;
    return {
      id: row.id,
      channelType: row.channel_type as ChannelType,
      userId: row.user_id,
      candidates: row.candidates as StoredCandidate[],
    };
  }

  async consumeSelection(id: string, now: Date): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const rows = await tenantTx((db) =>
      db
        .update(pgFakeSelections)
        .set({ used_at: now })
        .where(
          and(
            eq(pgFakeSelections.id, id),
            isNull(pgFakeSelections.used_at),
            gt(pgFakeSelections.expires_at, now),
          ),
        )
        .returning({ id: pgFakeSelections.id }),
    );
    return rows.length > 0;
  }

  async insertPost(p: NewFakePost): Promise<FakePost> {
    const accountId = requireFakeAccount();
    const [row] = await tenantTx((db) =>
      db
        .insert(pgFakePosts)
        .values({
          id: uuidV7(),
          account_id: accountId,
          connection_id: p.connectionId,
          platform_post_id: p.platformPostId,
          content_hash: p.contentHash,
          stored_text_hash: p.storedTextHash,
          permalink: p.permalink,
          state: p.state,
          processing_id: p.processingId,
          processing_outcome: p.processingOutcome,
          published_at: p.publishedAt,
        })
        .returning(),
    );
    if (row === undefined) throw new Error('Không đọc lại được bài giả vừa ghi');
    return toPost(row);
  }

  async findByProcessingId(processingId: string): Promise<FakePost | null> {
    const [row] = await tenantTx((db) =>
      db.select().from(pgFakePosts).where(eq(pgFakePosts.processing_id, processingId)).limit(1),
    );
    return row === undefined ? null : toPost(row);
  }

  async updatePost(
    id: string,
    patch: Partial<Pick<FakePost, 'state' | 'processingOutcome' | 'publishedAt'>>,
  ): Promise<void> {
    await tenantTx((db) =>
      db
        .update(pgFakePosts)
        .set({
          ...(patch.state !== undefined ? { state: patch.state } : {}),
          ...(patch.processingOutcome !== undefined
            ? { processing_outcome: patch.processingOutcome }
            : {}),
          ...(patch.publishedAt !== undefined ? { published_at: patch.publishedAt } : {}),
        })
        .where(eq(pgFakePosts.id, id)),
    );
  }

  async findPublishedByStoredHash(
    connectionId: string,
    storedTextHash: string,
    from: Date,
    to: Date,
  ): Promise<FakePost | null> {
    const [row] = await tenantTx((db) =>
      db
        .select()
        .from(pgFakePosts)
        .where(
          and(
            eq(pgFakePosts.connection_id, connectionId),
            eq(pgFakePosts.stored_text_hash, storedTextHash),
            eq(pgFakePosts.state, 'published'),
            between(pgFakePosts.published_at, from, to),
          ),
        )
        .orderBy(asc(pgFakePosts.published_at))
        .limit(1),
    );
    return row === undefined ? null : toPost(row);
  }

  async listPosts(connectionId?: string): Promise<FakePost[]> {
    const rows = await tenantTx((db) =>
      db
        .select()
        .from(pgFakePosts)
        .where(connectionId === undefined ? undefined : eq(pgFakePosts.connection_id, connectionId))
        .orderBy(asc(pgFakePosts.created_at)),
    );
    return rows.map(toPost);
  }

  async publishedCount(contentHash: string): Promise<number> {
    const [row] = await tenantTx((db) =>
      db
        .select({ n: count() })
        .from(pgFakePosts)
        .where(and(eq(pgFakePosts.content_hash, contentHash), eq(pgFakePosts.state, 'published'))),
    );
    return row?.n ?? 0;
  }

  async reset(): Promise<void> {
    await tenantTx(async (db) => {
      await db.delete(pgFakePosts);
      await db.delete(pgFakeSelections);
      await db.delete(pgFakeOauthStates);
      await db.delete(pgFakeConnections);
    });
  }
}
