import type {
  ChannelOverviewItem,
  ConfirmResponse,
  ConnectErrorCode,
  DisconnectPreview,
  DisconnectResponse,
  OverviewResponse,
  SelectionResponse,
} from '@app/shared/platform_gateway';
import { AppError, can, currentAccountId, requireCustomer } from '../../../../core';
import { tenantTx } from '../../../../core/db';
import type { NotificationsPublicApi } from '../../../notifications';
import { withGatewayOp } from '../../../../core/gateways/op-log';
import type {
  AccountCheckResult,
  ChannelConnection,
  ChannelType,
  ExpiryInfo,
} from '../../public-api';
import type { ConnectionCandidate } from '../adapters/adapter';
import { getAdapter } from '../adapters/registry';
import { unknownError } from '../adapters/result-shapes';
import {
  ChannelOwnedByAnotherAccountError,
  ConnectionLimitError,
  ConnectionNotFoundError,
} from '../errors';
import type { FeatureGate } from '../features/feature-gate';
import { toChannelConnection, toChannelConnections } from '../gateway.service';
import type { GatewaySettings } from '../settings/gateway-settings';
import {
  credentialAad,
  revealCredential,
  type CredentialVault,
  type DecryptedCredential,
} from '../vault/credential-vault';
import type { ChannelAuditEntry, ChannelAuditSink } from './channel-audit';
import { blockCodeOf, callbackCodeOfBlock, reasonCodeOf } from './connect-errors';
import { connectionConsumers } from './consumers';
import type { ConnectionStore, StoredCandidate, StoredConnection } from './connection-store';
import { expiryFromJson, expiryToJson } from './connection-store';
import { limitReached, remainingSlots } from './limits';
import { hashOauthState, newOauthState, OAUTH_STATE_TTL_MS, SELECTION_TTL_MS } from './oauth-state';
import { emitNeedsReconnect } from '../notify/channel-notify';
import { recordConnect } from '../metrics';
import { toOverviewItem } from './overview-mapper';

// Luồng kết nối kênh (005 + 010 FR-001…FR-008, R6, R8): bắt đầu → trang ủy quyền của nền tảng → gọi lại (kiểm `state`
// gắn phiên + người dùng, dùng một lần) → phiên chọn Page (kèm kết quả kiểm tra điều kiện từng ứng viên) → xác nhận
// một hoặc nhiều Page (mỗi Page một giao dịch, giới hạn kiểm trong giao dịch). Kết nối lại giữ nguyên `connectionId`.
// Tài khoản luôn là tài khoản của phiên (tenantTx trong ngữ cảnh) – không bao giờ từ tham số (Hiến pháp I).

export type CallbackOutcome =
  | { kind: 'selection'; selectionId: string }
  | { kind: 'reconnected'; connectionId: string }
  | { kind: 'error'; code: ConnectErrorCode };

/** Phần cấu hình/phụ thuộc tùy chọn của 010 (bản dựng cũ và kiểm thử 005 không cần). */
export interface ConnectionsServiceExtras {
  features?: FeatureGate;
  settings?: GatewaySettings;
  /** Gói còn hạn? tài khoản đang bị xóa? (`account.getPublishingEligibility`). Thiếu ⇒ coi như còn hạn. */
  eligibility?: () => Promise<{ planActive: boolean; deletionRequested: boolean }>;
  /** Ghi kiểm toán thao tác kênh (FR-030). Thiếu ⇒ không ghi (bản dựng cũ/kiểm thử 005). */
  audit?: ChannelAuditSink;
  /** Thông báo gộp cho Instagram phụ thuộc khi Page bị ngắt (FR-042). Thiếu ⇒ không phát. */
  notifications?: NotificationsPublicApi;
}

/** Ngắt hàng loạt: song song tối đa 5 kết nối; thu hồi phía nền tảng chờ tối đa 5 giây mỗi kết nối. */
const DISCONNECT_PARALLEL = 5;
const REVOKE_TIMEOUT_MS = 5_000;

const DEFAULTS = {
  maxPerPlatform: 5,
  warnDays: 7,
  selectionTtlSec: SELECTION_TTL_MS / 1000,
} as const;

// ---------- lỗi nghiệp vụ (mỗi lỗi ≥ 1 hành động khắc phục – nguyên tắc VI) ----------

function selectionNotFound(): AppError {
  return new AppError({
    code: 'SELECTION_NOT_FOUND',
    httpStatus: 404,
    message: 'Phiên chọn trang đã hết hạn hoặc không tồn tại. Vui lòng kết nối lại từ đầu.',
    actions: [{ kind: 'retry', label: 'Thử kết nối lại' }],
  });
}

export function channelIneligible(messageVi: string): AppError {
  return new AppError({
    code: 'CHANNEL_INELIGIBLE',
    httpStatus: 422,
    message: messageVi,
    actions: [{ kind: 'retry', label: 'Chọn trang khác' }],
  });
}

export function connectionNotFound(): AppError {
  return new AppError({
    code: 'CONNECTION_NOT_FOUND',
    httpStatus: 404,
    message: 'Không tìm thấy kết nối kênh này.',
    actions: [{ kind: 'retry', label: 'Tải lại danh sách kênh' }],
  });
}

export function featureNotEnabled(): AppError {
  return new AppError({
    code: 'FEATURE_NOT_ENABLED',
    httpStatus: 403,
    message: 'Tính năng này chưa được mở cho tài khoản của bạn.',
    actions: [{ kind: 'navigate', label: 'Quay lại Kênh kết nối', href: '/channels' }],
  });
}

export function planExpired(): AppError {
  return new AppError({
    code: 'PLAN_EXPIRED',
    httpStatus: 403,
    message:
      'Gói dịch vụ đã hết hạn nên chưa thể kết nối kênh. Bạn vẫn xem và ngắt được các kênh hiện có.',
    actions: [
      { kind: 'navigate', label: 'Xem gói dịch vụ', href: '/plans' },
      { kind: 'navigate', label: 'Xem kênh hiện có', href: '/channels' },
    ],
  });
}

export function providerUnavailable(): AppError {
  return new AppError({
    code: 'PROVIDER_UNAVAILABLE',
    httpStatus: 503,
    message: 'Tính năng kết nối đang được chuẩn bị. Vui lòng thử lại sau hoặc liên hệ hỗ trợ.',
    actions: [{ kind: 'retry', label: 'Thử lại sau' }],
  });
}

const isLive = (c: StoredConnection): boolean => (c.rowStatus ?? c.status) !== 'disconnected';

/** Kết quả kiểm tra đọc lại từ JSON: ngày dạng chuỗi → Date. */
function reviveCheck(check: AccountCheckResult): AccountCheckResult {
  if (check.kind === 'eligible') {
    return { ...check, tokenExpiresAt: new Date(check.tokenExpiresAt) };
  }
  return check;
}

export class ConnectionsService {
  constructor(
    private readonly store: ConnectionStore,
    private readonly vault: CredentialVault,
    private readonly now: () => Date = () => new Date(),
    private readonly extras: ConnectionsServiceExtras = {},
  ) {}

  // ---------- cấu hình / điều kiện chung ----------

  private async cfg() {
    const s = await this.extras.settings?.get();
    return {
      maxPerPlatform: s?.maxPerPlatform ?? DEFAULTS.maxPerPlatform,
      warnDays: s?.expiryWarnDays ?? DEFAULTS.warnDays,
      selectionTtlSec: s?.selectionTtlSec ?? DEFAULTS.selectionTtlSec,
    };
  }

  private async tiktokEnabled(): Promise<boolean> {
    const accountId = currentAccountId();
    if (accountId === null) return false;
    return (await this.extras.features?.isEnabled(accountId, 'channel.tiktok')) ?? false;
  }

  /** Công tắc TikTok tắt ⇒ từ chối TRƯỚC khi chạm nền tảng (FR-036, 0 lời gọi mạng). */
  private async requireFeatureFor(channelType: ChannelType): Promise<void> {
    if ((channelType as string) === 'tiktok' && !(await this.tiktokEnabled())) {
      throw featureNotEnabled();
    }
  }

  /** Ghi kiểm toán kiểu "cố gắng hết sức": lỗi ghi không làm hỏng thao tác của khách (nhật ký kỹ thuật tách riêng). */
  private async audit(entry: ChannelAuditEntry): Promise<void> {
    if (this.extras.audit === undefined) return;
    try {
      await this.extras.audit(entry);
    } catch {
      // Không lộ chi tiết; việc ghi lỗi kiểm toán thuộc tầng giám sát.
    }
  }

  private async requirePlanActive(): Promise<void> {
    const e = await this.extras.eligibility?.();
    if (e !== undefined && (!e.planActive || e.deletionRequested)) throw planExpired();
  }

  // ---------- bắt đầu kết nối ----------

  /**
   * Bắt đầu kết nối hoặc kết nối lại (`reconnectConnectionId`): lưu băm `state` gắn tài khoản + người dùng, trả địa chỉ
   * ủy quyền của nền tảng. Gói hết hạn ⇒ 403 `PLAN_EXPIRED` (FR-033); đủ giới hạn ⇒ 409 `LIMIT_REACHED` (chỉ kết nối MỚI).
   */
  startConnect(
    channelType: ChannelType,
    redirectUri: string,
    opts: { reconnectConnectionId?: string | undefined } = {},
  ): Promise<{ authorizeUrl: string }> {
    return withGatewayOp(
      'platform_gateway',
      'startConnect',
      { channel_type: channelType },
      async () => {
        const actor = requireCustomer();
        await this.requireFeatureFor(channelType);
        await this.requirePlanActive();
        const cfg = await this.cfg();

        const reconnectId = opts.reconnectConnectionId;
        if (reconnectId !== undefined) {
          const existing = await this.store.getConnection(reconnectId);
          if (existing === null || !isLive(existing) || existing.channelType !== channelType) {
            throw connectionNotFound();
          }
        } else {
          const used = (await this.store.listConnections()).filter(
            (c) => c.channelType === channelType && isLive(c),
          ).length;
          if (remainingSlots(used, cfg.maxPerPlatform) < 1) {
            throw limitReached(used, cfg.maxPerPlatform);
          }
        }

        const adapter = getAdapter(channelType);
        const { state, hash } = newOauthState();
        let authorizeUrl: string;
        try {
          authorizeUrl = adapter.authorizeUrl(state, redirectUri, {
            rerequest: reconnectId !== undefined,
          });
        } catch {
          // Ứng dụng nền tảng chưa cấu hình/duyệt ⇒ "đang chuẩn bị" (không lộ chi tiết cấu hình).
          throw providerUnavailable();
        }
        await this.store.saveOauthState({
          stateHash: hash,
          userId: actor.userId,
          channelType,
          expiresAt: new Date(
            this.now().getTime() + Math.min(OAUTH_STATE_TTL_MS, cfg.selectionTtlSec * 1000),
          ),
          ...(reconnectId !== undefined ? { reconnectConnectionId: reconnectId } : {}),
        });
        return { authorizeUrl };
      },
    );
  }

  // ---------- lượt gọi lại ----------

  /**
   * Lượt gọi lại: `state` sai / hết hạn / đã dùng / của tài khoản hay người dùng khác / khác loại kênh ⇒ STATE_INVALID
   * (không tạo gì, không lộ lý do). Người dùng hủy ⇒ CONNECT_CANCELLED. Kết nối lại cùng kênh ⇒ cập nhật tại chỗ.
   */
  async handleCallback(
    channelType: ChannelType,
    q: { state?: string | undefined; code?: string | undefined; error?: string | undefined },
    /** Địa chỉ quay về đã dùng ở bước ủy quyền (Meta/TikTok yêu cầu khớp khi đổi `code`); bản giả bỏ qua. */
    redirectUri = '',
  ): Promise<CallbackOutcome> {
    const outcome = await this.handleCallbackCore(channelType, q, redirectUri);
    if (outcome.kind === 'reconnected') {
      await this.audit({
        action: 'channel.reconnect',
        connectionId: outcome.connectionId,
        channelType,
        result: 'ok',
      });
      recordConnect(channelType, 'reconnected');
    } else if (outcome.kind === 'error') {
      await this.audit({ action: 'channel.connect_failed', channelType, result: outcome.code });
      recordConnect(channelType, outcome.code);
    }
    return outcome;
  }

  private handleCallbackCore(
    channelType: ChannelType,
    q: { state?: string | undefined; code?: string | undefined; error?: string | undefined },
    redirectUri: string,
  ): Promise<CallbackOutcome> {
    return withGatewayOp(
      'platform_gateway',
      'handleCallback',
      { channel_type: channelType },
      async (): Promise<CallbackOutcome> => {
        const actor = requireCustomer();
        if (q.state === undefined || q.state === '')
          return { kind: 'error', code: 'STATE_INVALID' };
        const consumed = await this.store.consumeOauthState(hashOauthState(q.state), this.now());
        if (consumed?.userId !== actor.userId || consumed.channelType !== channelType) {
          return { kind: 'error', code: 'STATE_INVALID' };
        }
        if (q.error !== undefined) return { kind: 'error', code: 'CONNECT_CANCELLED' };
        if ((channelType as string) === 'tiktok' && !(await this.tiktokEnabled())) {
          return { kind: 'error', code: 'FEATURE_NOT_ENABLED' };
        }

        const adapter = getAdapter(channelType);
        let candidates: ConnectionCandidate[];
        try {
          ({ candidates } = await adapter.exchangeCallback({
            code: q.code,
            error: q.error,
            redirectUri,
          }));
        } catch {
          return { kind: 'error', code: 'PROVIDER_UNAVAILABLE' };
        }
        if (candidates.length === 0) return { kind: 'error', code: 'NO_CANDIDATES' };

        const stored: StoredCandidate[] = [];
        for (const c of candidates) stored.push(await this.prepareCandidate(channelType, c));

        const reconnectId = consumed.reconnectConnectionId ?? null;
        if (reconnectId !== null) return this.reconnectInPlace(reconnectId, stored);

        const cfg = await this.cfg();
        const selectionId = await this.store.createSelection({
          channelType,
          userId: actor.userId,
          candidates: stored,
          expiresAt: new Date(this.now().getTime() + cfg.selectionTtlSec * 1000),
        });
        return { kind: 'selection', selectionId };
      },
    );
  }

  /** Mã hóa mã quyền của ứng viên (mỗi ứng viên một bản mã) + kiểm tra điều kiện ngay (không giữ giao dịch). */
  private async prepareCandidate(
    channelType: ChannelType,
    c: ConnectionCandidate,
  ): Promise<StoredCandidate> {
    const adapter = getAdapter(channelType);
    const accountId = currentAccountId();
    if (accountId === null) throw new Error('Thiếu ngữ cảnh tài khoản khi mã hóa mã quyền');
    const aadToken = credentialAad(accountId, 'token', channelType, c.externalId);
    const ciphertext = await this.vault.encrypt(c.accessToken, aadToken);
    const refreshCiphertext =
      c.refreshToken === undefined
        ? null
        : await this.vault.encrypt(
            c.refreshToken,
            credentialAad(accountId, 'refresh', channelType, c.externalId),
          );
    const check: AccountCheckResult = await adapter
      .checkAccount(await this.vault.decrypt(ciphertext, aadToken), {
        connectionId: `candidate:${c.externalId}`,
        externalId: c.externalId,
      })
      .catch(() => ({
        kind: 'ineligible' as const,
        error: unknownError(channelType, 'CHECK_FAILED'),
      }));
    const expiry: ExpiryInfo =
      c.expiry ??
      (c.tokenExpiresAt === null
        ? { kind: 'none' }
        : { kind: 'token', expiresAt: c.tokenExpiresAt });
    return {
      externalId: c.externalId,
      displayName: c.displayName.slice(0, 120),
      tokenCiphertextB64: ciphertext.toString('base64'),
      tokenExpiresAt: expiry.kind === 'none' ? null : expiry.expiresAt.toISOString(),
      check,
      avatarUrl: c.avatarUrl ?? null,
      accountType: c.accountType ?? null,
      sourceExternalId: c.sourceExternalId ?? null,
      refreshCiphertextB64: refreshCiphertext?.toString('base64') ?? null,
      expiry: expiryToJson(expiry),
    };
  }

  /**
   * Kết nối lại (FR-008): ứng viên có `external_id` BẰNG kênh gốc ⇒ cập nhật quyền TẠI CHỖ (giữ `id`, bài đã lên lịch
   * không đứt); khác ⇒ WRONG_CHANNEL và kênh cũ KHÔNG đổi.
   */
  private async reconnectInPlace(
    connectionId: string,
    stored: StoredCandidate[],
  ): Promise<CallbackOutcome> {
    const existing = await this.store.getConnection(connectionId);
    if (existing === null || !isLive(existing)) return { kind: 'error', code: 'STATE_INVALID' };
    const match = stored.find((c) => c.externalId === existing.externalId);
    if (match === undefined) return { kind: 'error', code: 'WRONG_CHANNEL' };
    const check = reviveCheck(match.check);
    if (check.kind === 'ineligible') {
      return { kind: 'error', code: callbackCodeOfBlock(blockCodeOf(check.error.rawCode)) };
    }
    if (this.store.updateRow === undefined) return { kind: 'error', code: 'PROVIDER_UNAVAILABLE' };
    const expiry = match.expiry === undefined ? undefined : expiryFromJson(match.expiry);
    const now = this.now();
    await this.store.updateRow(connectionId, existing.version ?? 1, {
      token_ciphertext: Buffer.from(match.tokenCiphertextB64, 'base64'),
      refresh_ciphertext:
        match.refreshCiphertextB64 === null || match.refreshCiphertextB64 === undefined
          ? null
          : Buffer.from(match.refreshCiphertextB64, 'base64'),
      token_issued_at: now,
      expiry_kind: expiry?.kind ?? 'token',
      token_expires_at: expiry === undefined || expiry.kind === 'none' ? null : expiry.expiresAt,
      status: 'active',
      reason_code: null,
      last_error_code: null,
      recheck_required: false,
      last_notified_stage: null,
      last_checked_at: now,
      account_type: check.accountType,
      granted_scopes: check.grantedScopes,
      quota_remaining: check.quotaRemaining,
    });
    return { kind: 'reconnected', connectionId };
  }

  // ---------- phiên chọn ----------

  /** Người khác (không phải người khởi động) / hết hạn / đã dùng ⇒ 404 `SELECTION_NOT_FOUND`. */
  async getSelection(selectionId: string): Promise<SelectionResponse> {
    const actor = requireCustomer();
    const sel = await this.store.getSelection(selectionId, this.now());
    if (sel?.userId !== actor.userId) throw selectionNotFound();
    const cfg = await this.cfg();
    const live = (await this.store.listConnections()).filter(
      (c) => c.channelType === sel.channelType && isLive(c),
    );
    const connected = new Set(live.map((c) => c.externalId));
    return {
      channelType: sel.channelType,
      remainingSlots: remainingSlots(live.length, cfg.maxPerPlatform),
      limit: cfg.maxPerPlatform,
      candidates: sel.candidates.map((c) => {
        const check = reviveCheck(c.check);
        let blocked: SelectionResponse['candidates'][number]['blocked'] = null;
        if (connected.has(c.externalId)) {
          blocked = {
            code: 'ALREADY_CONNECTED',
            messageVi: 'Kênh này đã được kết nối.',
            remedies: [{ action: 'check_on_platform', labelVi: 'Xem kênh đã kết nối' }],
          };
        } else if (check.kind === 'ineligible') {
          blocked = {
            code: blockCodeOf(check.error.rawCode),
            messageVi: check.error.messageVi,
            remedies: check.error.remedies.map((r) => ({ action: r.action, labelVi: r.labelVi })),
          };
        }
        return {
          externalId: c.externalId,
          displayName: c.displayName,
          avatarUrl: c.avatarUrl ?? null,
          accountType: check.kind === 'eligible' ? check.accountType : (c.accountType ?? null),
          selectable: blocked === null,
          blocked,
        };
      }),
    };
  }

  /**
   * Xác nhận một hoặc nhiều ứng viên (FR-007, R8). Chọn NHIỀU HƠN chỗ còn lại ⇒ 409 `LIMIT_REACHED` TRƯỚC khi tạo bất cứ
   * kết nối nào. Mỗi ứng viên xử lý độc lập (một giao dịch riêng): một ứng viên lỗi không ảnh hưởng ứng viên khác.
   */
  confirm(selectionId: string, externalIds: readonly string[]): Promise<ConfirmResponse> {
    return withGatewayOp('platform_gateway', 'confirm', {}, async () => {
      const actor = requireCustomer();
      const sel = await this.store.getSelection(selectionId, this.now());
      if (sel?.userId !== actor.userId) throw selectionNotFound();
      await this.requirePlanActive();
      if ((sel.channelType as string) === 'tiktok' && !(await this.tiktokEnabled())) {
        // Công tắc tắt giữa chừng ⇒ hủy phiên, không tạo kết nối (Edge Case).
        await this.dropSelection(selectionId);
        throw featureNotEnabled();
      }
      const cfg = await this.cfg();
      const ids = [...new Set(externalIds)];
      const allLive = (await this.store.listConnections()).filter((c) => isLive(c));
      const live = allLive.filter((c) => c.channelType === sel.channelType);
      const connected = new Set(live.map((c) => c.externalId));
      const wouldCreate = ids.filter((id) => {
        const cand = sel.candidates.find((c) => c.externalId === id);
        return (
          cand !== undefined && reviveCheck(cand.check).kind === 'eligible' && !connected.has(id)
        );
      }).length;
      if (wouldCreate > remainingSlots(live.length, cfg.maxPerPlatform)) {
        throw limitReached(live.length, cfg.maxPerPlatform);
      }

      const results: ConfirmResponse['results'] = [];
      const now = this.now();
      for (const externalId of ids) {
        const candidate = sel.candidates.find((c) => c.externalId === externalId);
        if (candidate === undefined) {
          results.push({
            externalId,
            outcome: 'not_in_selection',
            error: {
              messageVi: 'Kênh này không có trong danh sách đã chọn. Hãy kết nối lại từ đầu.',
              remedies: [{ action: 'reconnect', labelVi: 'Kết nối lại' }],
            },
          });
          continue;
        }
        const check = reviveCheck(candidate.check);
        if (check.kind === 'ineligible') {
          results.push({
            externalId,
            outcome: 'ineligible',
            error: {
              messageVi: check.error.messageVi,
              remedies: check.error.remedies.map((r) => ({ action: r.action, labelVi: r.labelVi })),
            },
          });
          continue;
        }
        try {
          const { connection, created } = await this.insertCandidate(
            sel.channelType,
            candidate,
            check,
            cfg.maxPerPlatform,
            allLive, // Page nguồn của Instagram nằm ở loại kênh KHÁC nên phải tra trong mọi kết nối còn hiệu lực (T045)
          );
          results.push({
            externalId,
            outcome: created ? 'created' : 'already_connected',
            connection: await this.itemOf(connection, now, cfg.warnDays),
          });
        } catch (err) {
          if (err instanceof ConnectionLimitError) {
            results.push({
              externalId,
              outcome: 'limit_reached',
              error: {
                messageVi: `Bạn đã kết nối tối đa ${err.limit} kênh cho nền tảng này. Hãy ngắt bớt kênh không dùng.`,
                remedies: [{ action: 'check_on_platform', labelVi: 'Ngắt bớt kênh' }],
              },
            });
          } else if (err instanceof ChannelOwnedByAnotherAccountError) {
            results.push({
              externalId,
              outcome: 'owned_by_another_account',
              error: {
                messageVi:
                  'Kênh này đang được kết nối ở một tài khoản khác. Hãy ngắt ở tài khoản đó trước hoặc liên hệ hỗ trợ.',
                remedies: [{ action: 'contact_support', labelVi: 'Liên hệ hỗ trợ' }],
              },
            });
          } else {
            throw err;
          }
        }
      }
      // Ứng viên không được chọn bị hủy cùng dòng phiên (mã quyền của chúng không được giữ lại).
      await this.dropSelection(selectionId);
      for (const r of results) {
        recordConnect(sel.channelType, r.outcome);
        await this.audit({
          action: r.outcome === 'created' ? 'channel.connect' : 'channel.connect_failed',
          connectionId: r.connection?.connectionId ?? null,
          channelType: sel.channelType,
          result: r.outcome,
        });
      }
      return { results };
    });
  }

  private async dropSelection(selectionId: string): Promise<void> {
    if (this.store.deleteSelection !== undefined) await this.store.deleteSelection(selectionId);
    else await this.store.consumeSelection(selectionId, this.now());
  }

  private insertCandidate(
    channelType: ChannelType,
    candidate: StoredCandidate,
    check: Extract<AccountCheckResult, { kind: 'eligible' }>,
    maxPerPlatform: number,
    live: StoredConnection[],
  ): Promise<{ connection: StoredConnection; created: boolean }> {
    const expiry: ExpiryInfo | undefined =
      candidate.expiry === undefined ? undefined : expiryFromJson(candidate.expiry);
    const sourceId =
      candidate.sourceExternalId === null || candidate.sourceExternalId === undefined
        ? null
        : (live.find(
            (c) => c.channelType === 'facebook_page' && c.externalId === candidate.sourceExternalId,
          )?.id ?? null);
    let tokenExpiresAt: Date | null;
    if (expiry !== undefined) tokenExpiresAt = expiry.kind === 'none' ? null : expiry.expiresAt;
    else
      tokenExpiresAt =
        candidate.tokenExpiresAt === null ? null : new Date(candidate.tokenExpiresAt);
    return this.store.insertConnection({
      channelType,
      externalId: candidate.externalId,
      displayName: candidate.displayName,
      tokenCiphertext: Buffer.from(candidate.tokenCiphertextB64, 'base64'),
      tokenExpiresAt,
      expiryKind: expiry?.kind ?? 'token',
      refreshCiphertext:
        candidate.refreshCiphertextB64 === null || candidate.refreshCiphertextB64 === undefined
          ? null
          : Buffer.from(candidate.refreshCiphertextB64, 'base64'),
      avatarUrl: candidate.avatarUrl ?? null,
      accountType: check.accountType,
      grantedScopes: check.grantedScopes,
      quotaRemaining: check.quotaRemaining,
      sourceConnectionId: sourceId,
      sourceExternalId: candidate.sourceExternalId ?? null,
      maxPerPlatform,
    });
  }

  private async itemOf(
    c: StoredConnection,
    now: Date,
    warnDays: number,
  ): Promise<ChannelOverviewItem> {
    const source =
      c.sourceConnectionId === undefined || c.sourceConnectionId === null
        ? undefined
        : await this.store.getConnection(c.sourceConnectionId);
    return toOverviewItem(c, { now, warnDays, featureEnabled: true, source });
  }

  // ---------- 005: lưu MỘT ứng viên (giữ để tương thích) ----------

  /** `POST /channels` của 005: lưu một Page đã chọn. Ứng viên không đủ điều kiện ⇒ 422 `CHANNEL_INELIGIBLE`. */
  saveConnection(
    selectionId: string,
    externalId: string,
  ): Promise<{ connection: ChannelConnection; created: boolean }> {
    return withGatewayOp('platform_gateway', 'saveConnection', {}, async () => {
      const actor = requireCustomer();
      const sel = await this.store.getSelection(selectionId, this.now());
      if (sel?.userId !== actor.userId) throw selectionNotFound();
      await this.requirePlanActive();
      const candidate = sel.candidates.find((c) => c.externalId === externalId);
      if (candidate === undefined) {
        throw new AppError({
          code: 'CANDIDATE_NOT_FOUND',
          httpStatus: 404,
          message: 'Không tìm thấy trang đã chọn trong danh sách. Vui lòng chọn lại.',
          actions: [{ kind: 'retry', label: 'Chọn lại' }],
        });
      }
      const check = reviveCheck(candidate.check);
      if (check.kind === 'ineligible') throw channelIneligible(check.error.messageVi);
      const cfg = await this.cfg();
      const live = (await this.store.listConnections()).filter((c) => isLive(c));
      try {
        const { connection, created } = await this.insertCandidate(
          sel.channelType,
          candidate,
          check,
          cfg.maxPerPlatform,
          live,
        );
        await this.dropSelection(selectionId);
        return { connection: toChannelConnection(connection), created };
      } catch (err) {
        if (err instanceof ConnectionLimitError) throw limitReached(err.used, err.limit);
        if (err instanceof ChannelOwnedByAnotherAccountError) {
          throw new AppError({
            code: 'OWNED_BY_ANOTHER_ACCOUNT',
            httpStatus: 409,
            message:
              'Kênh này đang được kết nối ở một tài khoản khác. Hãy ngắt ở tài khoản đó trước hoặc liên hệ hỗ trợ.',
            actions: [{ kind: 'navigate', label: 'Liên hệ hỗ trợ', href: '/support' }],
          });
        }
        throw err;
      }
    });
  }

  // ---------- đọc ----------

  async listConnections(): Promise<ChannelConnection[]> {
    const rows = await this.store.listConnections();
    const cfg = await this.cfg();
    return toChannelConnections(rows, { warnDays: cfg.warnDays, now: this.now() });
  }

  /** Dữ liệu cho màn hình "Kênh kết nối": CHỈ đọc dữ liệu đã lưu, không gọi nền tảng (FR-028). */
  async overview(): Promise<OverviewResponse> {
    const cfg = await this.cfg();
    const now = this.now();
    const rows = (await this.store.listConnections()).filter(isLive);
    const tiktokOn = await this.tiktokEnabled();
    const eligibility = await this.extras.eligibility?.();
    const planActive =
      eligibility === undefined ? true : eligibility.planActive && !eligibility.deletionRequested;
    const viewerCanManage = can('channel.manage');
    const impact = await connectionConsumers().scheduledImpact(rows.map((r) => r.id));
    const byId = new Map(rows.map((r) => [r.id, r]));

    const connections = rows
      .filter((r) => (r.channelType as string) !== 'tiktok' || tiktokOn)
      .map((r) => {
        const source =
          r.sourceConnectionId === undefined || r.sourceConnectionId === null
            ? undefined
            : (byId.get(r.sourceConnectionId) ?? null);
        return toOverviewItem(r, {
          now,
          warnDays: cfg.warnDays,
          featureEnabled: tiktokOn,
          source,
          scheduledImpact: impact.get(r.id),
        });
      });
    const rank = (s: ChannelOverviewItem['state']) =>
      s === 'needs_reconnect'
        ? 0
        : s === 'ineligible'
          ? 1
          : s === 'expiring'
            ? 2
            : s === 'suspended'
              ? 4
              : 3;
    connections.sort(
      (a, b) =>
        a.channelType.localeCompare(b.channelType) ||
        rank(a.state) - rank(b.state) ||
        a.connectedAt.localeCompare(b.connectedAt),
    );

    const types = tiktokOn
      ? (['facebook_page', 'instagram', 'tiktok'] as const)
      : (['facebook_page', 'instagram'] as const);
    const platforms = types.map((channelType) => {
      const used = rows.filter((r) => r.channelType === channelType).length;
      return {
        channelType,
        used,
        limit: cfg.maxPerPlatform,
        canAdd: used < cfg.maxPerPlatform && planActive && viewerCanManage,
        ...(channelType === 'tiktok' ? { experimental: true, note: 'TikTok chỉ đăng video' } : {}),
      };
    });

    const attention = connections.flatMap((c) =>
      c.state === 'expiring' || c.state === 'needs_reconnect' || c.state === 'ineligible'
        ? [
            {
              connectionId: c.connectionId,
              kind: c.state,
              ...(c.expiry.daysLeft !== null ? { daysLeft: c.expiry.daysLeft } : {}),
            },
          ]
        : [],
    );
    return {
      features: { tiktok: tiktokOn },
      limits: { perPlatform: cfg.maxPerPlatform },
      platforms,
      connections,
      attention,
      planActive,
      viewerCanManage,
    };
  }

  /**
   * "Kiểm tra lại" (FR-011, FR-012): giới hạn tần suất bằng cập nhật có điều kiện, gọi nền tảng NGOÀI giao dịch, rồi
   * ghi có khóa lạc quan. CHỈ kết quả khẳng định mới đổi trạng thái; lỗi tạm thời/mã lạ ⇒ `unavailable`, giữ nguyên.
   */
  recheck(connectionId: string): Promise<{
    connection: ChannelOverviewItem;
    result: 'ok' | 'changed' | 'unavailable';
    messageVi?: string;
  }> {
    return withGatewayOp(
      'platform_gateway',
      'recheck',
      { connection_id: connectionId },
      async () => {
        requireCustomer();
        const existing = await this.store.getConnection(connectionId);
        if (existing === null || !isLive(existing)) throw connectionNotFound();
        if (this.store.claimManualCheck === undefined || this.store.updateRow === undefined) {
          throw providerUnavailable();
        }
        const cfg = await this.cfg();
        const cooldown = (await this.extras.settings?.get())?.manualCheckCooldownSec ?? 20;
        const now = this.now();
        const claim = await this.store.claimManualCheck(connectionId, now, cooldown);
        if (!claim.claimed) {
          throw new AppError({
            code: 'RECHECK_TOO_SOON',
            httpStatus: 429,
            message: 'Bạn vừa kiểm tra xong, hãy thử lại sau ít giây.',
            actions: [{ kind: 'retry', label: `Chờ ${claim.retryAfterSec} giây` }],
            retryAfterSeconds: claim.retryAfterSec,
            extra: { retryAfterSec: claim.retryAfterSec },
          });
        }

        const accountId = currentAccountId();
        if (accountId === null) throw new Error('Thiếu ngữ cảnh tài khoản khi kiểm tra lại');
        const adapter = getAdapter(existing.channelType);
        // Ngoài giao dịch: lời gọi mạng không giữ kết nối CSDL.
        const check: AccountCheckResult = await this.vault
          .decrypt(
            existing.tokenCiphertext,
            credentialAad(accountId, 'token', existing.channelType, existing.externalId),
          )
          .then((cred) =>
            adapter.checkAccount(cred, {
              connectionId: existing.id,
              externalId: existing.externalId,
            }),
          )
          .catch(() => ({
            kind: 'ineligible' as const,
            error: unknownError(existing.channelType, 'CHECK_FAILED'),
          }));

        const unavailable = async () => {
          await this.audit({
            action: 'channel.recheck',
            connectionId: existing.id,
            channelType: existing.channelType,
            result: 'unavailable',
          });
          return {
            connection: await this.itemOf(existing, now, cfg.warnDays),
            result: 'unavailable' as const,
            messageVi: 'Chưa kiểm tra được, thử lại sau.',
          };
        };

        let patch: Parameters<NonNullable<ConnectionStore['updateRow']>>[2];
        let nextStatus: 'active' | 'needs_reconnect' | 'ineligible';
        if (check.kind === 'eligible') {
          nextStatus = 'active';
          patch = {
            status: 'active',
            reason_code: null,
            last_error_code: null,
            recheck_required: false,
            account_type: check.accountType,
            granted_scopes: check.grantedScopes,
            quota_remaining: check.quotaRemaining,
            last_checked_at: now,
          };
        } else if (check.error.category !== 'user_action') {
          return unavailable(); // tạm thời / không xác định ⇒ KHÔNG đổi trạng thái, KHÔNG ghi `last_checked_at`
        } else if (
          blockCodeOf(check.error.rawCode) === 'SCOPE_MISSING' ||
          check.error.remedies.some((r) => r.action === 'reconnect')
        ) {
          // Thiếu quyền hoặc mã hỏng: chỉ "Kết nối lại" (cấp lại quyền) mới sửa được ⇒ needs_reconnect.
          nextStatus = 'needs_reconnect';
          patch = {
            status: 'needs_reconnect',
            reason_code:
              blockCodeOf(check.error.rawCode) === 'SCOPE_MISSING'
                ? 'SCOPE_MISSING'
                : /REVOK/i.test(check.error.rawCode)
                  ? 'TOKEN_REVOKED'
                  : 'TOKEN_EXPIRED',
            last_error_code: check.error.rawCode.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64),
            last_checked_at: now,
          };
        } else {
          nextStatus = 'ineligible';
          patch = {
            status: 'ineligible',
            reason_code: reasonCodeOf(check.error.rawCode),
            last_error_code: check.error.rawCode.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64),
            last_checked_at: now,
          };
        }
        const before = existing.rowStatus ?? existing.status;
        const updated = await this.store.updateRow(existing.id, existing.version ?? 1, patch);
        const result = before === nextStatus ? ('ok' as const) : ('changed' as const);
        await this.audit({
          action: 'channel.recheck',
          connectionId: existing.id,
          channelType: existing.channelType,
          result,
          reasonCode: patch.reason_code ?? null,
        });
        if (result === 'changed') {
          await this.audit({
            action: 'channel.state_changed',
            connectionId: existing.id,
            channelType: existing.channelType,
            result: `${before}->${nextStatus}`,
            reasonCode: patch.reason_code ?? null,
          });
        }
        return {
          connection: await this.itemOf(updated, now, cfg.warnDays),
          result,
        };
      },
    );
  }

  // ---------- ngắt kết nối (FR-017, FR-029, US7) ----------

  /** Hậu quả của việc ngắt (T073): số bài đã lên lịch cho RIÊNG kênh này + Instagram liên kết qua Page này (FR-042). */
  async disconnectPreview(connectionId: string): Promise<DisconnectPreview> {
    const existing = await this.store.getConnection(connectionId);
    if (existing === null || !isLive(existing)) throw connectionNotFound();
    const live = (await this.store.listLiveConnections?.()) ?? [];
    const dependents = live.filter((c) => c.sourceConnectionId === existing.id);
    const impact = (await connectionConsumers().scheduledImpact([existing.id])).get(existing.id);
    return {
      connectionId: existing.id,
      displayName: existing.displayName,
      scheduledImpact: {
        count: impact?.count ?? 0,
        nextAt: impact?.nextAt?.toISOString() ?? null,
      },
      dependents: dependents.map((d) => ({
        connectionId: d.id,
        displayName: d.displayName,
        channelType: 'instagram' as const,
      })),
    };
  }

  /** Ngắt một kết nối của khách (idempotent: đã ngắt ⇒ vẫn `disconnected:true`). */
  disconnect(connectionId: string): Promise<DisconnectResponse> {
    return this.disconnectOne(connectionId, 'user');
  }

  /**
   * Ngắt MỌI kết nối của tài khoản trong ngữ cảnh (T074 – việc `disconnect_all` khi xóa tài khoản). Song song ≤ 5, thu hồi
   * phía nền tảng ≤ 5 giây/kết nối và lỗi không chặn; chạy lại ⇒ không còn gì để làm.
   */
  async disconnectAll(): Promise<{ disconnected: number }> {
    const live = (await this.store.listLiveConnections?.()) ?? [];
    let disconnected = 0;
    const revokedUsers = new Set<string>(); // một mã người dùng chỉ thu hồi một lần
    for (let i = 0; i < live.length; i += DISCONNECT_PARALLEL) {
      const batch = live.slice(i, i + DISCONNECT_PARALLEL);
      const results = await Promise.all(
        batch.map((c) => this.disconnectOne(c.id, 'account_deletion', { revokedUsers, all: true })),
      );
      disconnected += results.length;
    }
    return { disconnected };
  }

  private async disconnectOne(
    connectionId: string,
    reason: 'user' | 'account_deletion',
    opts: { revokedUsers?: Set<string>; all?: boolean } = {},
  ): Promise<DisconnectResponse> {
    const accountId = currentAccountId();
    if (accountId === null) throw new Error('Thiếu ngữ cảnh tài khoản khi ngắt kết nối');
    const existing = await this.store.getConnection(connectionId);
    if (existing === null) throw new ConnectionNotFoundError();
    if (!isLive(existing)) return { disconnected: true, revoked: 'skipped', cancelledAttempts: 0 };
    const live = (await this.store.listLiveConnections?.()) ?? [];
    const isMeta = (t: string) => t === 'facebook_page' || t === 'instagram';

    // Đọc mã MỘT LẦN ngay trước khi xóa (bản trong bộ nhớ dùng để thu hồi sau); mã hỏng vẫn không chặn việc ngắt.
    let revokeCred: DecryptedCredential | undefined;
    let userKey: string | undefined;
    try {
      const token = await this.vault.decrypt(
        existing.tokenCiphertext,
        credentialAad(accountId, 'token', existing.channelType, existing.externalId),
      );
      revokeCred = token;
      if (existing.refreshCiphertext != null) {
        revokeCred = await this.vault.decrypt(
          existing.refreshCiphertext,
          credentialAad(accountId, 'refresh', existing.channelType, existing.externalId),
        );
        userKey = revealCredential(revokeCred);
      }
    } catch {
      revokeCred = undefined;
    }

    // Một giao dịch: hủy lượt chưa gửi + xóa bản mã + (khi do khách ngắt) thông báo gộp cho Instagram phụ thuộc.
    const dependents = live.filter((c) => c.sourceConnectionId === existing.id);
    let cancelled = 0;
    let done: boolean;
    if (this.store.listLiveConnections === undefined) {
      done = await this.store.disconnect(connectionId); // bản giả: không có giao dịch thật
    } else {
      const outcome = await tenantTx(async (tx) => {
        const c = (await connectionConsumers().onDisconnect(tx, existing.id)).cancelled;
        const ok = await this.store.disconnect(existing.id);
        if (ok && reason === 'user' && dependents.length > 0 && this.extras.notifications) {
          await emitNeedsReconnect(this.extras.notifications, tx, {
            connectionIds: dependents.map((d) => d.id),
            channelNames: dependents.map((d) => d.displayName),
            reason: 'source_page_lost',
            now: this.now(),
          });
        }
        return { cancelled: c, ok };
      });
      cancelled = outcome.cancelled;
      done = outcome.ok;
    }
    if (!done) return { disconnected: true, revoked: 'skipped', cancelledAttempts: 0 }; // đua: bên kia đã ngắt

    // Thu hồi phía nền tảng SAU khi đã xóa (≤ 5 giây, lỗi không chặn). Chỉ thu hồi khi đây là kết nối Meta CUỐI CÙNG:
    // quyền của Meta gắn với người dùng + ứng dụng nên thu hồi sẽ làm hỏng mọi Page khác còn kết nối.
    const othersLiveMeta =
      !opts.all && live.some((c) => c.id !== existing.id && isMeta(c.channelType));
    let revoked: DisconnectResponse['revoked'] = 'skipped';
    let hintVi: string | undefined;
    const alreadyRevoked = userKey !== undefined && opts.revokedUsers?.has(userKey) === true;
    if (revokeCred !== undefined && !othersLiveMeta && !alreadyRevoked) {
      if (userKey !== undefined) opts.revokedUsers?.add(userKey);
      revoked = await this.revokeAtPlatform(existing, revokeCred);
    }
    if (revoked !== 'done') {
      hintVi = isMeta(existing.channelType)
        ? othersLiveMeta
          ? 'Quyền vẫn đang dùng cho kênh Meta khác của bạn. Khi ngắt kênh cuối cùng, bạn có thể gỡ ứng dụng trong cài đặt Facebook.'
          : 'Bạn có thể gỡ ứng dụng trong cài đặt Facebook (Cài đặt → Ứng dụng và trang web) để thu hồi hoàn toàn quyền.'
        : 'Bạn có thể gỡ ứng dụng trong cài đặt của nền tảng để thu hồi hoàn toàn quyền.';
    }
    await this.audit({
      action: 'channel.disconnect',
      connectionId,
      channelType: existing.channelType,
      result: 'ok',
      reasonCode: reason,
      ...(reason === 'account_deletion'
        ? { actor: { type: 'system' as const, id: 'disconnect_all' } }
        : {}),
    });
    return {
      disconnected: true,
      revoked,
      ...(hintVi !== undefined ? { hintVi } : {}),
      cancelledAttempts: cancelled,
    };
  }

  /** `adapter.revoke` với thời gian chờ 5 giây; không bao giờ ném. `unsupported` ⇒ `skipped`. */
  private async revokeAtPlatform(
    conn: StoredConnection,
    cred: DecryptedCredential,
  ): Promise<DisconnectResponse['revoked']> {
    try {
      const adapter = getAdapter(conn.channelType);
      const timeout = new Promise<'failed'>((resolve) => {
        setTimeout(() => {
          resolve('failed');
        }, REVOKE_TIMEOUT_MS).unref();
      });
      const result = await Promise.race([
        adapter.revoke(cred, { connectionId: conn.id, externalId: conn.externalId }),
        timeout,
      ]);
      if (result === 'done') return 'done';
      return result === 'unsupported' ? 'skipped' : 'failed';
    } catch {
      return 'failed';
    }
  }
}
