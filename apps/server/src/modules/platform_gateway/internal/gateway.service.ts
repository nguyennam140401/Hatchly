import { currentAccountId, tenantTx } from '../../../core/db';
import { TenantContextError } from '../../../core/db/errors';
import { withGatewayOp } from '../../../core/gateways/op-log';
import {
  MAX_POST_TEXT_LENGTH,
  type AccountCheckResult,
  type ChannelCapabilities,
  type ChannelConnection,
  type ChannelConnectionStatus,
  type ChannelType,
  type CheckStatusResult,
  type ExpiryInfo,
  type ClassifiedError,
  type MediaRules,
  type PlatformGatewayPublicApi,
  type ReconcileRequest,
  type ReconcileResult,
  type RefreshTokenResult,
  type SubmitRequest,
  type SubmitResult,
} from '../public-api';
import type { NotificationsPublicApi } from '../../notifications';
import type { PlatformAdapter } from './adapters/adapter';
import { getAdapter } from './adapters/registry';
import {
  AccountCheckShape,
  assertResultShape,
  RefreshTokenShape,
  unknownError,
} from './adapters/result-shapes';
import {
  deriveState,
  toLegacyStatus,
  type DerivedResult,
  type StateInput,
} from './connections/connection-state';
import type { ConnectionStore, StoredConnection } from './connections/connection-store';
import { connectionConsumers } from './connections/consumers';
import { ConnectionNotFoundError, InvalidRequestError } from './errors';
import type { FeatureGate } from './features/feature-gate';
import { emitNeedsReconnect } from './notify/channel-notify';
import type { GatewaySettings } from './settings/gateway-settings';
import type { CredentialVault, DecryptedCredential } from './vault/credential-vault';

// Tầng công khai của Cổng nền tảng (005, contracts/platform-gateway.md mục 1): connectionId → kết nối của
// tài khoản trong ngữ cảnh → bộ chuyển đổi theo loại kênh → giải mã quyền → gọi. Rẽ nhánh CHỈ theo
// `capabilities`, không theo tên nền tảng. Cổng không bao giờ tự thử lại `submit`.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Đầu vào của `deriveState` từ hàng kết nối (bản giả chỉ có `status` 2 giá trị + ngày hết hạn). */
export function toStateInput(c: StoredConnection): StateInput {
  return {
    channelType: c.channelType,
    status: c.rowStatus ?? c.status,
    tokenExpiresAt: c.tokenExpiresAt,
    reasonCode: c.reasonCode ?? null,
    sourceConnectionId: c.sourceConnectionId ?? null,
  };
}

export interface StateOptions {
  now?: Date;
  /** Số ngày báo trước hết hạn (mặc định 7). */
  warnDays?: number;
  /** Công tắc `channel.tiktok` đã tính; mặc định `true` (chỉ ảnh hưởng TikTok). */
  featureEnabled?: boolean;
  /** Hàng Page nguồn của Instagram: `null` = không tìm thấy (đã xóa); `undefined` = không cần. */
  source?: StoredConnection | null | undefined;
}

export function connectionState(c: StoredConnection, opts: StateOptions = {}): DerivedResult {
  return deriveState(toStateInput(c), {
    now: opts.now ?? new Date(),
    warnDays: opts.warnDays ?? 7,
    featureEnabled: opts.featureEnabled ?? true,
    source:
      opts.source === undefined || opts.source === null ? opts.source : toStateInput(opts.source),
  });
}

/** `status` công khai (4 giá trị cũ): `expiring` = còn < `warnDays`; hết hạn/hỏng → `expired`; ngắt/tạm tắt → `disconnected`. */
export function connectionStatus(
  c: StoredConnection,
  now = new Date(),
  opts: Omit<StateOptions, 'now'> = {},
): ChannelConnectionStatus {
  return toLegacyStatus(connectionState(c, { ...opts, now }).state);
}

function expiryOfRow(c: StoredConnection): ExpiryInfo {
  if (c.tokenExpiresAt === null || c.expiryKind === 'none') return { kind: 'none' };
  return { kind: c.expiryKind ?? 'token', expiresAt: c.tokenExpiresAt };
}

export function toChannelConnection(
  c: StoredConnection,
  opts: StateOptions = {},
): ChannelConnection {
  const derived = connectionState(c, opts);
  return {
    connectionId: c.id,
    channelType: c.channelType,
    displayName: c.displayName.slice(0, 120),
    externalId: c.externalId,
    status: toLegacyStatus(derived.state),
    tokenExpiresAt: c.tokenExpiresAt,
    connectedAt: c.connectedAt,
    state: derived.state,
    reasonCode: derived.reasonCode,
    expiry: expiryOfRow(c),
    sourceConnectionId: c.sourceConnectionId ?? null,
  };
}

/** Danh sách kết nối của tài khoản: Instagram tự tìm Page nguồn trong chính danh sách (FR-042). */
export function toChannelConnections(
  rows: StoredConnection[],
  opts: Omit<StateOptions, 'source'> = {},
): ChannelConnection[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows.map((r) =>
    toChannelConnection(r, {
      ...opts,
      source:
        r.sourceConnectionId === undefined || r.sourceConnectionId === null
          ? undefined
          : (byId.get(r.sourceConnectionId) ?? null),
    }),
  );
}

export interface PlatformGatewayOptions {
  store: ConnectionStore;
  vault: CredentialVault;
  /** Hết thời gian chờ phản hồi `submit` → `failed/unknown` (mặc định 30 000). */
  submitTimeoutMs: number;
  // ----- 010 (tùy chọn – bản dựng cũ/kiểm thử không cần) -----
  /** Công tắc theo tài khoản; thiếu ⇒ mọi công tắc TẮT (an toàn). */
  features?: FeatureGate;
  /** Cấu hình dùng chung (số ngày báo hết hạn…); thiếu ⇒ mặc định trong mã. */
  settings?: GatewaySettings;
  /** Phát thông báo "cần kết nối lại" trong giao dịch ghi trạng thái; thiếu ⇒ không phát. */
  notifications?: NotificationsPublicApi;
  now?: () => Date;
}

/** Mã lỗi gốc chỉ được ghi dạng đã lọc `[A-Za-z0-9_.:-]{1,64}` (chống rò chuỗi lạ vào cột/nhật ký). */
export function sanitizeRawCode(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 64);
  return cleaned === '' ? 'UNKNOWN' : cleaned;
}

const AUTH_FAILURE_REASON = {
  token_expired: { code: 'TOKEN_EXPIRED', reason: 'token_expired' },
  token_revoked: { code: 'TOKEN_REVOKED', reason: 'token_revoked' },
  scope_missing: { code: 'SCOPE_MISSING', reason: 'scope_missing' },
} as const;

interface Resolved {
  connection: StoredConnection;
  adapter: PlatformAdapter;
}

export class PlatformGatewayService implements PlatformGatewayPublicApi {
  constructor(private readonly opts: PlatformGatewayOptions) {}

  private async resolve(connectionId: string): Promise<Resolved> {
    if (!UUID.test(connectionId)) throw new ConnectionNotFoundError();
    const connection = await this.opts.store.getConnection(connectionId);
    // Không có HOẶC của tài khoản khác (RLS) – cùng một lỗi (nguyên tắc I).
    if (connection === null) throw new ConnectionNotFoundError();
    return { connection, adapter: getAdapter(connection.channelType) };
  }

  private credential(c: StoredConnection): Promise<DecryptedCredential> {
    return this.opts.vault.decrypt(c.tokenCiphertext);
  }

  /** Kết nối đã ngắt → lỗi cần người dùng "Kết nối lại" (không gọi nền tảng). */
  private disconnectedError(channelType: ChannelType): ClassifiedError {
    return {
      category: 'user_action',
      rawCode: 'CONNECTION_DISCONNECTED',
      channelType,
      messageVi: 'Kênh đã bị ngắt kết nối. Vui lòng kết nối lại kênh để tiếp tục đăng bài.',
      remedies: [{ action: 'reconnect', labelVi: 'Kết nối lại kênh' }],
    };
  }

  checkAccount(connectionId: string): Promise<AccountCheckResult> {
    return withGatewayOp(
      'platform_gateway',
      'checkAccount',
      { connection_id: connectionId },
      async () => {
        const { connection, adapter } = await this.resolve(connectionId);
        if (connection.status === 'disconnected') {
          return { kind: 'ineligible', error: this.disconnectedError(connection.channelType) };
        }
        const result = await adapter.checkAccount(await this.credential(connection), {
          connectionId,
          externalId: connection.externalId,
        });
        if (!AccountCheckShape.safeParse(result).success) {
          return {
            kind: 'ineligible',
            error: unknownError(connection.channelType, 'UNEXPECTED_RESULT'),
          };
        }
        return result;
      },
    );
  }

  mediaRules(connectionId: string): Promise<{ channelType: ChannelType; rules: MediaRules }> {
    return withGatewayOp(
      'platform_gateway',
      'mediaRules',
      { connection_id: connectionId },
      async () => {
        const { connection, adapter } = await this.resolve(connectionId);
        return { channelType: connection.channelType, rules: adapter.mediaRules() };
      },
    );
  }

  submit(req: SubmitRequest): Promise<SubmitResult> {
    return withGatewayOp(
      'platform_gateway',
      'submit',
      { connection_id: req.connectionId },
      async () => {
        const { connection, adapter } = await this.resolve(req.connectionId);
        if (connection.status === 'disconnected') {
          return { kind: 'failed', error: this.disconnectedError(connection.channelType) };
        }
        if (req.text.length > MAX_POST_TEXT_LENGTH) throw new InvalidRequestError('text quá dài');
        if (req.contentHash !== adapter.contentHash(req.text)) {
          throw new InvalidRequestError('contentHash không khớp nội dung');
        }
        const cred = await this.credential(connection);
        const controller = new AbortController();
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<SubmitResult>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            // Hết thời gian SAU khi đã gửi: không biết bài đã lên chưa → luôn `unknown`, không `transient`.
            resolve({
              kind: 'failed',
              error: unknownError(connection.channelType, 'SUBMIT_TIMEOUT'),
            });
          }, this.opts.submitTimeoutMs);
        });
        const call = adapter
          .submit(cred, {
            text: req.text,
            media: req.media,
            contentHash: req.contentHash,
            connectionId: connection.id,
            externalId: connection.externalId,
            signal: controller.signal,
          })
          .then(
            (value) => assertResultShape('submit', connection.channelType, value),
            (): SubmitResult => ({
              kind: 'failed',
              error: unknownError(connection.channelType, 'ADAPTER_ERROR'),
            }),
          );
        try {
          return await Promise.race([call, timeout]);
        } finally {
          clearTimeout(timer);
        }
      },
    );
  }

  checkStatus(connectionId: string, processingId: string): Promise<CheckStatusResult> {
    return withGatewayOp(
      'platform_gateway',
      'checkStatus',
      { connection_id: connectionId },
      async () => {
        const { connection, adapter } = await this.resolve(connectionId);
        if (connection.status === 'disconnected') {
          return { kind: 'failed', error: this.disconnectedError(connection.channelType) };
        }
        const value: unknown = await adapter
          .checkStatus(await this.credential(connection), processingId, {
            connectionId,
            externalId: connection.externalId,
          })
          .catch(() => undefined);
        return assertResultShape('checkStatus', connection.channelType, value);
      },
    );
  }

  reconcile(req: ReconcileRequest): Promise<ReconcileResult> {
    return withGatewayOp(
      'platform_gateway',
      'reconcile',
      { connection_id: req.connectionId },
      async () => {
        const { connection, adapter } = await this.resolve(req.connectionId);
        if (req.from.getTime() > req.to.getTime()) throw new InvalidRequestError('from > to');
        const caps = adapter.capabilities;
        if (!caps.reconcile) return { kind: 'unsupported', reason: 'capability' };
        const windowHours = (req.to.getTime() - req.from.getTime()) / 3_600_000;
        if (caps.maxReconcileWindowHours !== null && windowHours > caps.maxReconcileWindowHours) {
          return { kind: 'unsupported', reason: 'window_too_large' };
        }
        if (connection.status === 'disconnected') {
          return { kind: 'unsupported', reason: 'platform_unavailable' };
        }
        const value: unknown = await adapter
          .reconcile(await this.credential(connection), {
            connectionId: connection.id,
            externalId: connection.externalId,
            contentHash: req.contentHash,
            from: req.from,
            to: req.to,
          })
          .catch(() => undefined);
        return assertResultShape('reconcile', connection.channelType, value);
      },
    );
  }

  classifyError(channelType: ChannelType, rawCode: string): ClassifiedError {
    return getAdapter(channelType).classifyError(rawCode);
  }

  refreshToken(connectionId: string): Promise<RefreshTokenResult> {
    return withGatewayOp(
      'platform_gateway',
      'refreshToken',
      { connection_id: connectionId },
      async () => {
        const { connection, adapter } = await this.resolve(connectionId);
        if (connection.status === 'disconnected' || !adapter.capabilities.tokenRefresh) {
          // Kênh không tự gia hạn quyền được → người dùng "Kết nối lại".
          return { kind: 'failed', error: this.disconnectedError(connection.channelType) };
        }
        const result: unknown = await adapter
          .refreshToken(await this.credential(connection), {
            connectionId,
            externalId: connection.externalId,
          })
          .catch(() => undefined);
        const parsed = RefreshTokenShape.safeParse(result);
        if (!parsed.success) {
          return { kind: 'failed', error: this.disconnectedError(connection.channelType) };
        }
        const value = result as RefreshTokenResult;
        if (value.kind === 'refreshed') {
          await this.opts.store.updateTokenExpiry(connection.id, value.tokenExpiresAt);
        }
        return value;
      },
    );
  }

  capabilities(channelType: ChannelType): ChannelCapabilities {
    return { ...getAdapter(channelType).capabilities };
  }

  contentHash(channelType: ChannelType, text: string): string {
    return getAdapter(channelType).contentHash(text);
  }

  /** Công tắc + số ngày báo trước hết hạn cho việc dẫn xuất trạng thái (không gọi nền tảng). */
  private async derivation(
    rows: readonly StoredConnection[],
  ): Promise<{ warnDays: number; featureEnabled: boolean; now: Date }> {
    const warnDays = (await this.opts.settings?.get())?.expiryWarnDays ?? 7;
    // Chỉ hỏi công tắc khi có kết nối TikTok (tránh một truy vấn thừa ở mọi lần liệt kê).
    const needsFeature = rows.some((r) => (r.channelType as string) === 'tiktok');
    const featureEnabled = needsFeature ? await this.isFeatureEnabled('channel.tiktok') : true;
    return { warnDays, featureEnabled, now: (this.opts.now ?? (() => new Date()))() };
  }

  listConnections(filter?: {
    channelTypes?: readonly ChannelType[];
    usableOnly?: boolean;
  }): Promise<ChannelConnection[]> {
    return withGatewayOp('platform_gateway', 'listConnections', {}, async () => {
      const rows = await this.opts.store.listConnections();
      const all = toChannelConnections(rows, await this.derivation(rows));
      return all.filter(
        (c) =>
          (filter?.channelTypes === undefined || filter.channelTypes.includes(c.channelType)) &&
          (filter?.usableOnly !== true || c.state === 'active' || c.state === 'expiring'),
      );
    });
  }

  getConnectionState(connectionId: string): Promise<ChannelConnection | null> {
    return this.getConnection(connectionId);
  }

  async isFeatureEnabled(flag: 'channel.tiktok'): Promise<boolean> {
    const accountId = currentAccountId();
    if (accountId === null) throw new TenantContextError('TENANT_CONTEXT_MISSING');
    return (await this.opts.features?.isEnabled(accountId, flag)) ?? false;
  }

  reportAuthFailure(
    connectionId: string,
    report: { rawCode: string; kind: 'token_expired' | 'token_revoked' | 'scope_missing' },
  ): Promise<void> {
    return withGatewayOp(
      'platform_gateway',
      'reportAuthFailure',
      { connection_id: connectionId },
      async () => {
        const store = this.opts.store;
        if (store.markAuthFailure === undefined) return; // bản giả: không có quyền thật để hỏng
        if (!UUID.test(connectionId)) throw new ConnectionNotFoundError();
        const mapped = AUTH_FAILURE_REASON[report.kind];
        const now = (this.opts.now ?? (() => new Date()))();
        await store.markAuthFailure(
          connectionId,
          { reasonCode: mapped.code, rawCode: sanitizeRawCode(report.rawCode) },
          async (conn, tx) => {
            if (this.opts.notifications === undefined) return;
            // Instagram liên kết qua Page này tự thành "cần kết nối lại" (dẫn xuất) → gom MỘT thông báo (FR-042).
            const live = (await store.listLiveConnections?.()) ?? [];
            const dependents = live.filter((c) => c.sourceConnectionId === conn.id);
            const impact = await connectionConsumers().scheduledImpact([
              conn.id,
              ...dependents.map((d) => d.id),
            ]);
            const affected = [...impact.values()].reduce((n, v) => n + v.count, 0);
            await emitNeedsReconnect(this.opts.notifications, tx, {
              connectionIds: [conn.id, ...dependents.map((d) => d.id)],
              channelNames: [conn.displayName, ...dependents.map((d) => d.displayName)],
              reason: mapped.reason,
              affectedPosts: affected,
              now,
            });
          },
        );
      },
    );
  }

  disconnectAllForAccount(): Promise<{ disconnected: number }> {
    return withGatewayOp('platform_gateway', 'disconnectAllForAccount', {}, async () => {
      const store = this.opts.store;
      let disconnected = 0;
      if (store.listLiveConnections === undefined) {
        // Bản giả (không có giao dịch thật): chỉ ngắt.
        for (const c of await store.listConnections()) {
          if (c.status !== 'disconnected' && (await store.disconnect(c.id))) disconnected++;
        }
        return { disconnected };
      }
      for (const c of await store.listLiveConnections()) {
        // Mỗi kết nối MỘT giao dịch: hủy lượt chưa gửi + xóa mã quyền cùng lúc (Hiến pháp II, VII).
        const done = await tenantTx(async (tx) => {
          await connectionConsumers().onDisconnect(tx, c.id);
          return store.disconnect(c.id);
        });
        if (done) disconnected++;
      }
      return { disconnected };
    });
  }

  getConnection(connectionId: string): Promise<ChannelConnection | null> {
    return withGatewayOp(
      'platform_gateway',
      'getConnection',
      { connection_id: connectionId },
      async () => {
        if (!UUID.test(connectionId)) return null;
        const c = await this.opts.store.getConnection(connectionId);
        if (c === null) return null;
        const source =
          c.sourceConnectionId === undefined || c.sourceConnectionId === null
            ? undefined
            : await this.opts.store.getConnection(c.sourceConnectionId);
        return toChannelConnection(c, { ...(await this.derivation([c])), source });
      },
    );
  }
}
