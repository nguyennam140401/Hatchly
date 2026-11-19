import { ERROR_CODES } from '@app/shared/core';
import { AppError, currentAccountId } from '../../../../core';
import { tenantTx, type Db } from '../../../../core/db';
import type { NotificationsPublicApi } from '../../../notifications';
import type { AccountCheckResult, ClassifiedError, ExpiryInfo } from '../../public-api';
import { getAdapter } from '../adapters/registry';
import { unknownError } from '../adapters/result-shapes';
import type { FeatureGate } from '../features/feature-gate';
import { toStateInput } from '../gateway.service';
import type { GatewaySettings } from '../settings/gateway-settings';
import { credentialAad, type CredentialVault } from '../vault/credential-vault';
import type { ChannelAuditSink } from '../connections/channel-audit';
import { blockCodeOf, reasonCodeOf } from '../connections/connect-errors';
import { connectionConsumers } from '../connections/consumers';
import type {
  ConnectionPatch,
  ConnectionStore,
  StoredConnection,
} from '../connections/connection-store';
import { daysLeft, deriveState } from '../connections/connection-state';
import {
  emitNeedsReconnect,
  emitTokenExpiring,
  type NeedsReconnectReason,
  type TokenStage,
} from '../notify/channel-notify';

// Việc `check_connection` (010 T060, contracts/jobs-and-notifications.md 1.2) – kiểm tra/làm mới/nhắc hạn MỘT kết nối, chạy lại
// an toàn. Nguyên tắc: lời gọi nền tảng ở NGOÀI giao dịch (không giữ kết nối CSDL); ghi bằng cập nhật có điều kiện theo
// `version`; thông báo phát TRONG cùng giao dịch ghi trạng thái; CHỈ kết luận khẳng định mới đổi trạng thái (FR-012).

const DAY_MS = 86_400_000;
const PLATFORM_CALL_TIMEOUT_MS = 10_000;
const STAGE_RANK: Record<TokenStage | 'none', number> = { none: 0, d7: 1, d1: 2, expired: 3 };
const MAX_GROUP = 10;

export type CheckOutcome =
  /** Không có/đã ngắt. */
  | 'noop'
  /** Bỏ qua có chủ đích: gói hết hạn, công tắc TikTok tắt, Page nguồn hỏng. */
  | 'skipped'
  /** Kiểm tra xong, trạng thái giữ nguyên. */
  | 'ok'
  /** Kiểm tra xong và trạng thái lưu đã đổi. */
  | 'changed'
  /** Lỗi tạm thời/không xác định: không đổi trạng thái, không cập nhật `last_checked_at`. */
  | 'deferred'
  /** Bản ghi đã có quyền mới hơn (người dùng kết nối lại) hoặc bị ghi đè: bỏ kết quả của ta. */
  | 'lost_race';

export interface CheckConnectionDeps {
  store: ConnectionStore;
  vault: CredentialVault;
  settings: GatewaySettings;
  features: FeatureGate;
  notifications: NotificationsPublicApi;
  eligibility: () => Promise<{ planActive: boolean; deletionRequested: boolean }>;
  audit?: ChannelAuditSink;
  now?: () => Date;
}

const isConflict = (e: unknown): boolean =>
  e instanceof AppError && e.code === ERROR_CODES.VERSION_CONFLICT;

const sanitizeRaw = (raw: string): string => raw.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64);

/** Ngày theo lịch UTC+7 (YYYY-MM-DD) – "hết hạn ngày …" khớp con số người dùng thấy ở màn hình. */
function vnDate(t: Date): string {
  return new Date(t.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Mốc nhắc theo số ngày còn lại (UTC+7): ≤ 1 ⇒ d1; ≤ warnDays ⇒ d7; còn lại không nhắc. Đã quá hạn ⇒ expired. */
export function stageFor(expiresAt: Date, now: Date, warnDays: number): TokenStage | null {
  if (expiresAt.getTime() <= now.getTime()) return 'expired';
  const left = daysLeft(expiresAt, now);
  if (left <= 1) return 'd1';
  if (left <= warnDays) return 'd7';
  return null;
}

const reasonOf = (code: string | null | undefined): NeedsReconnectReason => {
  switch (code) {
    case 'TOKEN_EXPIRED':
      return 'token_expired';
    case 'TOKEN_REVOKED':
      return 'token_revoked';
    case 'SCOPE_MISSING':
      return 'scope_missing';
    case 'SOURCE_PAGE_LOST':
      return 'source_page_lost';
    default:
      return 'not_eligible';
  }
};

export function createCheckConnectionHandler(deps: CheckConnectionDeps) {
  const { store, vault } = deps;
  const clock = () => deps.now?.() ?? new Date();

  /**
   * Ghi `patch` có điều kiện theo `version` + chạy `extra` (phát thông báo…) TRONG cùng giao dịch. Xung đột ⇒ đọc lại: bản ghi đã
   * có `token_issued_at` MỚI HƠN ⇒ bỏ kết quả của ta (không ghi đè quyền mới bằng quyền cũ); ngược lại thử lại một lần.
   */
  async function commit(
    row: StoredConnection,
    patch: ConnectionPatch,
    extra?: (updated: StoredConnection, tx: Db) => Promise<void>,
  ): Promise<StoredConnection | 'lost_race'> {
    if (store.updateRow === undefined) return 'lost_race';
    const updateRow = store.updateRow.bind(store);
    const attempt = (r: StoredConnection) =>
      tenantTx(async (tx) => {
        const updated = await updateRow(r.id, r.version ?? 1, patch);
        if (extra !== undefined) await extra(updated, tx);
        return updated;
      });
    try {
      return await attempt(row);
    } catch (e) {
      if (!isConflict(e)) throw e;
      const fresh = await store.getConnection(row.id);
      if (fresh === null || (fresh.rowStatus ?? fresh.status) === 'disconnected')
        return 'lost_race';
      if ((fresh.tokenIssuedAt?.getTime() ?? 0) > (row.tokenIssuedAt?.getTime() ?? 0)) {
        return 'lost_race';
      }
      // Bên kia (Worker khác) đã ghi đúng mốc nhắc/đúng trạng thái này rồi ⇒ KHÔNG làm lại và KHÔNG phát thông báo lần hai.
      if (
        extra !== undefined &&
        ((patch.last_notified_stage != null &&
          STAGE_RANK[fresh.lastNotifiedStage ?? 'none'] >= STAGE_RANK[patch.last_notified_stage]) ||
          (patch.status !== undefined && (fresh.rowStatus ?? fresh.status) === patch.status))
      ) {
        return 'lost_race';
      }
      try {
        return await attempt(fresh);
      } catch (e2) {
        if (isConflict(e2)) return 'lost_race';
        throw e2;
      }
    }
  }

  /** Số bài đã lên lịch bị ảnh hưởng (số nguyên – không nội dung bài, không số tiền). */
  async function affectedPosts(ids: readonly string[]): Promise<number> {
    const impact = await connectionConsumers().scheduledImpact([...ids]);
    return [...impact.values()].reduce((n, v) => n + v.count, 0);
  }

  /** Thông báo "cần kết nối lại" GỘP Page + các Instagram phụ thuộc (FR-042), trong giao dịch `tx`. */
  async function notifyNeedsReconnect(
    conn: StoredConnection,
    tx: Db,
    reason: NeedsReconnectReason,
    now: Date,
  ): Promise<void> {
    const live = (await store.listLiveConnections?.()) ?? [];
    const dependents = live.filter((c) => c.sourceConnectionId === conn.id);
    const ids = [conn.id, ...dependents.map((d) => d.id)];
    await emitNeedsReconnect(deps.notifications, tx, {
      connectionIds: ids,
      channelNames: [conn.displayName, ...dependents.map((d) => d.displayName)],
      reason,
      affectedPosts: await affectedPosts(ids),
      now,
    });
  }

  /** Ghi kiểm toán đổi trạng thái – cố gắng hết sức, không làm hỏng việc. */
  async function auditChange(
    conn: StoredConnection,
    from: string,
    to: string,
    reasonCode: string | null,
  ): Promise<void> {
    if (deps.audit === undefined) return;
    try {
      await deps.audit({
        action: 'channel.state_changed',
        connectionId: conn.id,
        channelType: conn.channelType,
        result: `${from}->${to}`,
        reasonCode,
        actor: { type: 'system', id: 'channel_maintenance' },
      });
    } catch {
      // Không lộ chi tiết; lỗi kiểm toán thuộc tầng giám sát.
    }
  }

  return async function checkOne(connectionId: string): Promise<CheckOutcome> {
    const now = clock();
    const accountId = currentAccountId();
    if (accountId === null) throw new Error('Thiếu ngữ cảnh tài khoản khi kiểm tra kênh');
    if (store.updateRow === undefined || store.markAuthFailure === undefined) return 'noop';
    const updateRowFn = store.updateRow.bind(store);

    // 1. Đọc kết nối (không giữ giao dịch lúc gọi nền tảng).
    const existing = await store.getConnection(connectionId);
    if (existing === null) return 'noop';
    const before = existing.rowStatus ?? existing.status;
    if (before === 'disconnected') return 'noop';
    const cfg = await deps.settings.get();
    const warnDays = cfg.expiryWarnDays;

    // 2. Gói hết hạn/đang xóa ⇒ chỉ đánh dấu kiểm tra lại, KHÔNG gọi nền tảng, KHÔNG nhắc (FR-033).
    const elig = await deps.eligibility();
    if (!elig.planActive || elig.deletionRequested) {
      if (existing.recheckRequired !== true) await commit(existing, { recheck_required: true });
      return 'skipped';
    }
    // 3. TikTok khi công tắc tắt ⇒ tạm tắt, không gọi nền tảng (FR-038).
    if (
      (existing.channelType as string) === 'tiktok' &&
      !(await deps.features.isEnabled(accountId, 'channel.tiktok'))
    ) {
      return 'skipped';
    }
    // 4. Instagram có Page nguồn không còn dùng được ⇒ không gọi nền tảng vô ích (dẫn xuất SOURCE_PAGE_LOST).
    if (existing.channelType === 'instagram' && existing.sourceConnectionId != null) {
      const source = await store.getConnection(existing.sourceConnectionId);
      const st =
        source === null
          ? null
          : deriveState(toStateInput(source), { now, warnDays, featureEnabled: true }).state;
      if (st !== 'active' && st !== 'expiring') return 'skipped';
    }

    // 5. Giải mã (vault) → làm mới khi sắp hết hạn → kiểm tra điều kiện.
    const adapter = getAdapter(existing.channelType);
    const aad = (purpose: 'token' | 'refresh') =>
      credentialAad(accountId, purpose, existing.channelType, existing.externalId);
    const ctx = { connectionId: existing.id, externalId: existing.externalId };
    let row = existing;
    let cred = await vault.decrypt(existing.tokenCiphertext, aad('token'));
    let refreshed = false;
    let refreshError: ClassifiedError | undefined;

    const inWindow =
      existing.tokenExpiresAt !== null &&
      existing.tokenExpiresAt.getTime() < now.getTime() + (warnDays + 1) * DAY_MS;
    if (
      before === 'active' &&
      inWindow &&
      adapter.capabilities.tokenRefresh &&
      adapter.renewToken !== undefined &&
      existing.refreshCiphertext != null
    ) {
      const refreshCred = await vault.decrypt(existing.refreshCiphertext, aad('refresh'));
      const renewed = await adapter
        .renewToken(refreshCred, ctx, AbortSignal.timeout(PLATFORM_CALL_TIMEOUT_MS))
        .catch(() => ({
          kind: 'failed' as const,
          error: unknownError(existing.channelType, 'REFRESH_FAILED'),
        }));
      if (renewed.kind === 'renewed') {
        const tokenCt = await vault.encrypt(renewed.accessToken, aad('token'));
        const refreshCt =
          renewed.refreshToken === undefined
            ? existing.refreshCiphertext
            : await vault.encrypt(renewed.refreshToken, aad('refresh'));
        const written = await commit(existing, {
          token_ciphertext: tokenCt,
          refresh_ciphertext: refreshCt,
          token_issued_at: now,
          expiry_kind: renewed.expiry.kind === 'none' ? 'none' : renewed.expiry.kind,
          token_expires_at: renewed.expiry.kind === 'none' ? null : renewed.expiry.expiresAt,
          last_refreshed_at: now,
          last_notified_stage: null, // hạn mới ⇒ cảnh báo cũ không còn áp dụng
        });
        if (written === 'lost_race') return 'lost_race';
        row = written;
        cred = await vault.decrypt(tokenCt, aad('token'));
        refreshed = true;
      } else {
        refreshError = renewed.error;
      }
    }

    const check: AccountCheckResult = await adapter.checkAccount(cred, ctx).catch(() => ({
      kind: 'ineligible' as const,
      error: unknownError(existing.channelType, 'CHECK_FAILED'),
    }));

    // Làm mới bị thu hồi/hết hạn (khẳng định) ⇒ coi như kết luận khẳng định "cần kết nối lại".
    const definitiveFailure: ClassifiedError | undefined =
      check.kind === 'ineligible'
        ? check.error
        : refreshError?.category === 'user_action'
          ? refreshError
          : undefined;

    // ---- kết luận khẳng định không đủ điều kiện ----
    if (definitiveFailure?.category === 'user_action') {
      const needsReconnect =
        blockCodeOf(definitiveFailure.rawCode) === 'SCOPE_MISSING' ||
        definitiveFailure.remedies.some((r) => r.action === 'reconnect') ||
        check.kind === 'eligible';
      if (needsReconnect) {
        const code =
          blockCodeOf(definitiveFailure.rawCode) === 'SCOPE_MISSING'
            ? 'SCOPE_MISSING'
            : /REVOK/i.test(definitiveFailure.rawCode)
              ? 'TOKEN_REVOKED'
              : 'TOKEN_EXPIRED';
        const changed = await store.markAuthFailure(
          row.id,
          { reasonCode: code, rawCode: sanitizeRaw(definitiveFailure.rawCode) },
          (conn, tx) => notifyNeedsReconnect(conn, tx, reasonOf(code), now),
        );
        if (changed) await auditChange(row, before, 'needs_reconnect', code);
        return changed ? 'changed' : 'ok';
      }
      const reason = reasonCodeOf(definitiveFailure.rawCode);
      const result = await commit(
        row,
        {
          status: 'ineligible',
          reason_code: reason,
          last_error_code: sanitizeRaw(definitiveFailure.rawCode),
          last_checked_at: now,
        },
        before === 'ineligible'
          ? undefined
          : (conn, tx) => notifyNeedsReconnect(conn, tx, 'not_eligible', now),
      );
      if (result === 'lost_race') return 'lost_race';
      if (before !== 'ineligible') await auditChange(row, before, 'ineligible', reason);
      return before === 'ineligible' ? 'ok' : 'changed';
    }

    // ---- tạm thời / không xác định: giữ nguyên, chỉ ghi mã lỗi (FR-012) ----
    if (check.kind === 'ineligible') {
      const expired =
        before === 'active' && row.tokenExpiresAt !== null && row.tokenExpiresAt <= now;
      if (!expired) {
        const code = sanitizeRaw(check.error.rawCode);
        if (row.lastErrorCode !== code) await commit(row, { last_error_code: code });
        return 'deferred';
      }
      // Quá hạn thật vẫn đi nhánh "expired" bên dưới dù chưa kiểm tra được.
    }

    // ---- đủ điều kiện (hoặc quá hạn thật): cập nhật + nhắc hạn ----
    let expiry: ExpiryInfo | undefined;
    if (check.kind === 'eligible') {
      expiry = refreshed
        ? undefined
        : (check.expiry ?? (await adapter.expiryOf(cred, ctx).catch(() => undefined)));
    }
    const patch: ConnectionPatch = {};
    if (check.kind === 'eligible') {
      Object.assign(patch, {
        status: 'active',
        reason_code: null,
        last_error_code: null,
        recheck_required: false,
        account_type: check.accountType,
        granted_scopes: check.grantedScopes,
        quota_remaining: check.quotaRemaining,
        last_checked_at: now,
      } satisfies ConnectionPatch);
    }
    if (expiry !== undefined) {
      patch.expiry_kind = expiry.kind;
      patch.token_expires_at = expiry.kind === 'none' ? null : expiry.expiresAt;
    }
    const expiresAt =
      expiry !== undefined
        ? expiry.kind === 'none'
          ? null
          : expiry.expiresAt
        : row.tokenExpiresAt;

    // Nhắc hạn: chỉ khi còn hiệu lực/đang trong cửa sổ và làm mới KHÔNG thành công; chỉ phát khi mốc > mốc đã báo.
    const stage = refreshed || expiresAt === null ? null : stageFor(expiresAt, now, warnDays);
    const lastRank = STAGE_RANK[row.lastNotifiedStage ?? 'none'];
    let extra: ((updated: StoredConnection, tx: Db) => Promise<void>) | undefined;
    let becameExpired = false;
    if (stage !== null && STAGE_RANK[stage] > lastRank) {
      patch.last_notified_stage = stage;
      if (stage === 'expired') {
        becameExpired = true;
        patch.status = 'needs_reconnect';
        patch.reason_code = 'TOKEN_EXPIRED';
      }
      const expiresOn = vnDate(expiresAt ?? now);
      extra = async (updated, tx) => {
        // Gom MỘT thông báo cho các kênh cùng tài khoản cùng mốc (Edge Case): giành quyền báo cho từng kênh anh em.
        const group: StoredConnection[] = [updated];
        const live = (await store.listLiveConnections?.()) ?? [];
        for (const sib of live) {
          if (group.length >= MAX_GROUP) break;
          if (sib.id === row.id || (sib.rowStatus ?? sib.status) !== 'active') continue;
          if (sib.tokenExpiresAt === null) continue;
          if (stageFor(sib.tokenExpiresAt, now, warnDays) !== stage) continue;
          if (STAGE_RANK[sib.lastNotifiedStage ?? 'none'] >= STAGE_RANK[stage]) continue;
          try {
            const claimed = await updateRowFn(
              sib.id,
              sib.version ?? 1,
              stage === 'expired'
                ? {
                    last_notified_stage: stage,
                    status: 'needs_reconnect',
                    reason_code: 'TOKEN_EXPIRED',
                  }
                : { last_notified_stage: stage },
            );
            group.push(claimed);
          } catch (e) {
            if (!isConflict(e)) throw e; // anh em đang được Worker khác xử lý ⇒ họ tự báo
          }
        }
        await emitTokenExpiring(deps.notifications, tx, {
          connectionIds: group.map((g) => g.id),
          channelNames: group.map((g) => g.displayName),
          expiresOn,
          stage,
          affectedPosts: await affectedPosts(group.map((g) => g.id)),
        });
      };
    } else if (refreshed || (expiresAt !== null && stage === null)) {
      // Hạn mới/xa hơn cửa sổ nhắc ⇒ xóa mốc đã báo để chu kỳ nhắc sau bắt đầu lại.
      if (row.lastNotifiedStage != null) patch.last_notified_stage = null;
    }

    if (Object.keys(patch).length === 0) return 'ok';
    const result = await commit(row, patch, extra);
    if (result === 'lost_race') return 'lost_race';
    const to = becameExpired ? 'needs_reconnect' : check.kind === 'eligible' ? 'active' : before;
    if (to !== before) {
      await auditChange(row, before, to, to === 'needs_reconnect' ? 'TOKEN_EXPIRED' : null);
      return 'changed';
    }
    return 'ok';
  };
}
