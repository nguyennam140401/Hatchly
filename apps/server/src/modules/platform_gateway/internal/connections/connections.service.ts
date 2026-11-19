import type {
  ChannelOverviewItem,
  ConfirmResponse,
  ConnectErrorCode,
  OverviewResponse,
  SelectionResponse,
} from '@app/shared/platform_gateway';
import { AppError, can, currentAccountId, requireCustomer } from '../../../../core';
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
import { credentialAad, type CredentialVault } from '../vault/credential-vault';
import { blockCodeOf, callbackCodeOfBlock, reasonCodeOf } from './connect-errors';
import { connectionConsumers } from './consumers';
import type { ConnectionStore, StoredCandidate, StoredConnection } from './connection-store';
import { expiryFromJson, expiryToJson } from './connection-store';
import { limitReached, remainingSlots } from './limits';
import { hashOauthState, newOauthState, OAUTH_STATE_TTL_MS, SELECTION_TTL_MS } from './oauth-state';
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
}

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
  handleCallback(
    channelType: ChannelType,
    q: { state?: string | undefined; code?: string | undefined; error?: string | undefined },
    /** Địa chỉ quay về đã dùng ở bước ủy quyền (Meta/TikTok yêu cầu khớp khi đổi `code`); bản giả bỏ qua. */
    redirectUri = '',
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
      const live = (await this.store.listConnections()).filter(
        (c) => c.channelType === sel.channelType && isLive(c),
      );
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
            live,
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
        : (live.find((c) => c.externalId === candidate.sourceExternalId)?.id ?? null);
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

        const unavailable = async () => ({
          connection: await this.itemOf(existing, now, cfg.warnDays),
          result: 'unavailable' as const,
          messageVi: 'Chưa kiểm tra được, thử lại sau.',
        });

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
        return {
          connection: await this.itemOf(updated, now, cfg.warnDays),
          result: before === nextStatus ? ('ok' as const) : ('changed' as const),
        };
      },
    );
  }

  async disconnect(connectionId: string): Promise<void> {
    const ok = await this.store.disconnect(connectionId);
    if (!ok) {
      const existing = await this.store.getConnection(connectionId);
      if (existing === null) throw new ConnectionNotFoundError();
    }
  }
}
