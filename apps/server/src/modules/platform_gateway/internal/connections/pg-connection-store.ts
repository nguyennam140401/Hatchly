import { and, asc, eq, gt, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { currentAccountId, tenantTx, updateVersioned } from '../../../../core/db';
import { TenantContextError } from '../../../../core/db/errors';
import { uuidV7 } from '../../../../core/ids/uuid-v7';
import type { ChannelType } from '../../public-api';
import { ChannelOwnedByAnotherAccountError, ConnectionLimitError } from '../errors';
import { channelConnections, connectSelections, connectStates } from '../db/schema';
import type { Db } from '../../../../core/db';
import type {
  AuthFailure,
  ConnectionPatch,
  ConnectionStore,
  NewConnection,
  StoredCandidate,
  StoredConnection,
  StoredSelection,
} from './connection-store';
import { lockAndCountUsed, remainingSlots } from './limits';

// Kho kết nối THẬT (010 T016): bảng `platform_gateway.channel_connections`, `connect_states`, `connect_selections`
// qua `tenantTx` (RLS) – tài khoản luôn là tài khoản của ngữ cảnh, KHÔNG nhận từ tham số (Hiến pháp I).
// Mã quyền chỉ là bản mã (CredentialVault đã mã hóa trước khi tới đây). Mọi chuyển trạng thái là cập nhật có điều kiện.

type ConnRow = typeof channelConnections.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireAccount(): string {
  const accountId = currentAccountId();
  if (accountId === null) throw new TenantContextError('TENANT_CONTEXT_MISSING');
  return accountId;
}

/** Hàng CSDL → kết nối của Cổng. Hàng đã ngắt không còn bản mã nên trả bộ đệm rỗng (không bao giờ dùng để giải mã). */
export function toStoredConnection(r: ConnRow): StoredConnection {
  return {
    id: r.id,
    channelType: r.channel_type as ChannelType,
    externalId: r.external_id,
    displayName: r.display_name,
    tokenCiphertext: r.token_ciphertext ?? Buffer.alloc(0),
    tokenExpiresAt: r.token_expires_at,
    status: r.status === 'disconnected' ? 'disconnected' : 'active',
    connectedAt: r.connected_at,
    rowStatus: r.status,
    reasonCode: r.reason_code,
    expiryKind: r.expiry_kind,
    sourceConnectionId: r.source_connection_id,
    avatarUrl: r.avatar_url,
    accountType: r.account_type,
    grantedScopes: r.granted_scopes,
    quotaRemaining: r.quota_remaining,
    refreshCiphertext: r.refresh_ciphertext,
    tokenIssuedAt: r.token_issued_at,
    lastErrorCode: r.last_error_code,
    lastCheckedAt: r.last_checked_at,
    lastRefreshedAt: r.last_refreshed_at,
    lastManualCheckAt: r.last_manual_check_at,
    recheckRequired: r.recheck_required,
    lastNotifiedStage: r.last_notified_stage,
    disconnectedAt: r.disconnected_at,
    version: r.version,
  };
}

export class PgConnectionStore implements ConnectionStore {
  async getConnection(id: string): Promise<StoredConnection | null> {
    if (!UUID.test(id)) return null;
    const [row] = await tenantTx((db) =>
      db.select().from(channelConnections).where(eq(channelConnections.id, id)).limit(1),
    );
    return row === undefined ? null : toStoredConnection(row);
  }

  async listConnections(): Promise<StoredConnection[]> {
    const rows = await tenantTx((db) =>
      db.select().from(channelConnections).orderBy(asc(channelConnections.connected_at)),
    );
    return rows.map(toStoredConnection);
  }

  /**
   * Chèn kết nối mới trong MỘT giao dịch: (1) đã có kết nối còn hiệu lực của chính tài khoản → trả lại, `created:false`;
   * (2) vượt giới hạn → `ConnectionLimitError`; (3) chèn `ON CONFLICT DO NOTHING` trên chỉ mục duy nhất toàn cục –
   * không chèn được mà tài khoản này không thấy dòng nào ⇒ tài khoản khác đang giữ (`ChannelOwnedByAnotherAccountError`).
   */
  insertConnection(c: NewConnection): Promise<{ connection: StoredConnection; created: boolean }> {
    const accountId = requireAccount();
    return tenantTx(async (db) => {
      const liveWhere = and(
        eq(channelConnections.channel_type, c.channelType),
        eq(channelConnections.external_id, c.externalId),
        ne(channelConnections.status, 'disconnected'),
      );
      const [own] = await db.select().from(channelConnections).where(liveWhere).limit(1);
      if (own !== undefined) return { connection: toStoredConnection(own), created: false };

      if (c.maxPerPlatform !== undefined) {
        const used = await lockAndCountUsed(db, accountId, c.channelType);
        if (remainingSlots(used, c.maxPerPlatform) < 1) {
          throw new ConnectionLimitError(used, c.maxPerPlatform);
        }
      }

      const now = new Date();
      const inserted = await db
        .insert(channelConnections)
        .values({
          id: uuidV7(),
          account_id: accountId,
          channel_type: c.channelType,
          external_id: c.externalId,
          display_name: c.displayName.slice(0, 120),
          avatar_url: c.avatarUrl ?? null,
          account_type: c.accountType ?? null,
          granted_scopes: c.grantedScopes ?? [],
          quota_remaining: c.quotaRemaining ?? null,
          source_connection_id: c.sourceConnectionId ?? null,
          source_external_id: c.sourceExternalId ?? null,
          token_ciphertext: c.tokenCiphertext,
          refresh_ciphertext: c.refreshCiphertext ?? null,
          token_issued_at: now,
          expiry_kind: c.expiryKind ?? 'token',
          token_expires_at: c.tokenExpiresAt,
          connected_at: now,
        })
        .onConflictDoNothing({
          target: [channelConnections.channel_type, channelConnections.external_id],
          where: sql`status <> 'disconnected'`,
        })
        .returning();
      if (inserted[0] !== undefined) {
        // T045: Page vừa được kết nối ⇒ gắn các Instagram đã kết nối trước đó (chưa có Page nguồn) vào Page này, cùng giao dịch.
        if (c.channelType === 'facebook_page') {
          await db
            .update(channelConnections)
            .set({ source_connection_id: inserted[0].id })
            .where(
              and(
                eq(channelConnections.channel_type, 'instagram'),
                eq(channelConnections.source_external_id, c.externalId),
                isNull(channelConnections.source_connection_id),
                ne(channelConnections.status, 'disconnected'),
              ),
            );
        }
        return { connection: toStoredConnection(inserted[0]), created: true };
      }
      // Không chèn được: đua với chính tài khoản này (đọc lại) hoặc tài khoản khác đang giữ (RLS che dòng đó).
      const [live] = await db.select().from(channelConnections).where(liveWhere).limit(1);
      if (live !== undefined) return { connection: toStoredConnection(live), created: false };
      throw new ChannelOwnedByAnotherAccountError();
    });
  }

  /**
   * Ngắt: `status='disconnected'`, `disconnected_at`, XÓA hai bản mã (FR-017) trong cùng một câu lệnh có điều kiện.
   * `false` khi không có/đã ngắt.
   */
  async disconnect(id: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const rows = await tenantTx((db) =>
      db
        .update(channelConnections)
        .set({
          status: 'disconnected',
          disconnected_at: new Date(),
          token_ciphertext: null,
          refresh_ciphertext: null,
          recheck_required: false,
          version: sql`${channelConnections.version} + 1`,
        })
        .where(and(eq(channelConnections.id, id), ne(channelConnections.status, 'disconnected')))
        .returning({ id: channelConnections.id }),
    );
    return rows.length > 0;
  }

  async updateTokenExpiry(id: string, expiresAt: Date): Promise<void> {
    await tenantTx((db) =>
      db
        .update(channelConnections)
        .set({
          token_expires_at: expiresAt,
          expiry_kind: 'token',
          version: sql`${channelConnections.version} + 1`,
        })
        .where(and(eq(channelConnections.id, id), ne(channelConnections.status, 'disconnected'))),
    );
  }

  async markAuthFailure(
    id: string,
    failure: AuthFailure,
    within?: (connection: StoredConnection, tx: Db) => Promise<void>,
  ): Promise<boolean> {
    if (!UUID.test(id)) return false;
    return tenantTx(async (db) => {
      const [row] = await db
        .update(channelConnections)
        .set({
          status: 'needs_reconnect',
          reason_code: failure.reasonCode,
          last_error_code: failure.rawCode,
          version: sql`${channelConnections.version} + 1`,
        })
        .where(and(eq(channelConnections.id, id), eq(channelConnections.status, 'active')))
        .returning();
      if (row === undefined) return false;
      if (within !== undefined) await within(toStoredConnection(row), db);
      return true;
    });
  }

  async claimManualCheck(
    id: string,
    now: Date,
    cooldownSec: number,
  ): Promise<{ claimed: true } | { claimed: false; retryAfterSec: number }> {
    if (!UUID.test(id)) return { claimed: false, retryAfterSec: 0 };
    return tenantTx(async (db) => {
      const threshold = new Date(now.getTime() - cooldownSec * 1000);
      const [won] = await db
        .update(channelConnections)
        .set({ last_manual_check_at: now })
        .where(
          and(
            eq(channelConnections.id, id),
            ne(channelConnections.status, 'disconnected'),
            or(
              isNull(channelConnections.last_manual_check_at),
              lt(channelConnections.last_manual_check_at, threshold),
            ),
          ),
        )
        .returning({ id: channelConnections.id });
      if (won !== undefined) return { claimed: true as const };
      const [row] = await db
        .select({ at: channelConnections.last_manual_check_at })
        .from(channelConnections)
        .where(eq(channelConnections.id, id));
      const waitMs = row?.at == null ? 0 : row.at.getTime() + cooldownSec * 1000 - now.getTime();
      return { claimed: false as const, retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)) };
    });
  }

  async listLiveConnections(): Promise<StoredConnection[]> {
    const rows = await tenantTx((db) =>
      db
        .select()
        .from(channelConnections)
        .where(ne(channelConnections.status, 'disconnected'))
        .orderBy(asc(channelConnections.connected_at)),
    );
    return rows.map(toStoredConnection);
  }

  /** Cập nhật có điều kiện theo `version`; xung đột → `VERSION_CONFLICT` (409). Trả hàng mới. */
  async updateRow(id: string, expectedVersion: number, patch: ConnectionPatch) {
    const row = await tenantTx((db) =>
      updateVersioned(db, channelConnections, { id, expectedVersion }, patch),
    );
    return toStoredConnection(row);
  }

  async saveOauthState(s: {
    stateHash: Buffer;
    userId: string;
    channelType: ChannelType;
    expiresAt: Date;
    reconnectConnectionId?: string | null;
  }): Promise<void> {
    const accountId = requireAccount();
    await tenantTx((db) =>
      db.insert(connectStates).values({
        id: uuidV7(),
        account_id: accountId,
        state_hash: s.stateHash,
        user_id: s.userId,
        channel_type: s.channelType,
        reconnect_connection_id: s.reconnectConnectionId ?? null,
        expires_at: s.expiresAt,
      }),
    );
  }

  /** Dùng một lần bằng MỘT câu lệnh: `used_at IS NULL AND expires_at > now` → đánh dấu; còn lại → null. */
  async consumeOauthState(
    stateHash: Buffer,
    now: Date,
  ): Promise<{
    userId: string;
    channelType: ChannelType;
    reconnectConnectionId: string | null;
  } | null> {
    const [row] = await tenantTx((db) =>
      db
        .update(connectStates)
        .set({ used_at: now })
        .where(
          and(
            eq(connectStates.state_hash, stateHash),
            isNull(connectStates.used_at),
            gt(connectStates.expires_at, now),
          ),
        )
        .returning({
          userId: connectStates.user_id,
          channelType: connectStates.channel_type,
          reconnectConnectionId: connectStates.reconnect_connection_id,
        }),
    );
    return row === undefined
      ? null
      : {
          userId: row.userId,
          channelType: row.channelType as ChannelType,
          reconnectConnectionId: row.reconnectConnectionId,
        };
  }

  async createSelection(s: {
    channelType: ChannelType;
    userId: string;
    candidates: StoredCandidate[];
    expiresAt: Date;
  }): Promise<string> {
    const accountId = requireAccount();
    const id = uuidV7();
    await tenantTx((db) =>
      db.insert(connectSelections).values({
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
        .from(connectSelections)
        .where(
          and(
            eq(connectSelections.id, id),
            isNull(connectSelections.used_at),
            gt(connectSelections.expires_at, now),
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
        .update(connectSelections)
        .set({ used_at: now })
        .where(
          and(
            eq(connectSelections.id, id),
            isNull(connectSelections.used_at),
            gt(connectSelections.expires_at, now),
          ),
        )
        .returning({ id: connectSelections.id }),
    );
    return rows.length > 0;
  }

  /** Xóa HẲN dòng phiên chọn (mã quyền của ứng viên không được chọn bị hủy cùng dòng). */
  async deleteSelection(id: string): Promise<void> {
    if (!UUID.test(id)) return;
    await tenantTx((db) => db.delete(connectSelections).where(eq(connectSelections.id, id)));
  }
}
