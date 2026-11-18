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
import { ConnectionNotFoundError, InvalidRequestError } from './errors';
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
}

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

  listConnections(): Promise<ChannelConnection[]> {
    return withGatewayOp('platform_gateway', 'listConnections', {}, async () =>
      toChannelConnections(await this.opts.store.listConnections()),
    );
  }

  getConnection(connectionId: string): Promise<ChannelConnection | null> {
    return withGatewayOp(
      'platform_gateway',
      'getConnection',
      { connection_id: connectionId },
      async () => {
        if (!UUID.test(connectionId)) return null;
        const c = await this.opts.store.getConnection(connectionId);
        return c === null ? null : toChannelConnection(c);
      },
    );
  }
}
