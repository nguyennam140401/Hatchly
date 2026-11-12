import { withGatewayOp } from '../../../core/gateways/op-log';
import {
  MAX_POST_TEXT_LENGTH,
  type AccountCheckResult,
  type ChannelCapabilities,
  type ChannelConnection,
  type ChannelConnectionStatus,
  type ChannelType,
  type CheckStatusResult,
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
import type { ConnectionStore, StoredConnection } from './connections/connection-store';
import { ConnectionNotFoundError, InvalidRequestError } from './errors';
import type { CredentialVault, DecryptedCredential } from './vault/credential-vault';

// Tầng công khai của Cổng nền tảng (005, contracts/platform-gateway.md mục 1): connectionId → kết nối của
// tài khoản trong ngữ cảnh → bộ chuyển đổi theo loại kênh → giải mã quyền → gọi. Rẽ nhánh CHỈ theo
// `capabilities`, không theo tên nền tảng. Cổng không bao giờ tự thử lại `submit`.

const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `expiring` = còn < 7 ngày; hết hạn → `expired`; đã ngắt → `disconnected`. */
export function connectionStatus(c: StoredConnection, now = new Date()): ChannelConnectionStatus {
  if (c.status === 'disconnected') return 'disconnected';
  const left = c.tokenExpiresAt.getTime() - now.getTime();
  if (left <= 0) return 'expired';
  if (left < 7 * DAY_MS) return 'expiring';
  return 'active';
}

export function toChannelConnection(c: StoredConnection): ChannelConnection {
  return {
    connectionId: c.id,
    channelType: c.channelType,
    displayName: c.displayName.slice(0, 120),
    externalId: c.externalId,
    status: connectionStatus(c),
    tokenExpiresAt: c.tokenExpiresAt,
    connectedAt: c.connectedAt,
  };
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
    return withGatewayOp('platform_gateway', 'checkAccount', { connection_id: connectionId }, async () => {
      const { connection, adapter } = await this.resolve(connectionId);
      if (connection.status === 'disconnected') {
        return { kind: 'ineligible', error: this.disconnectedError(connection.channelType) };
      }
      const result = await adapter.checkAccount(await this.credential(connection), {
        connectionId,
      });
      if (!AccountCheckShape.safeParse(result).success) {
        return { kind: 'ineligible', error: unknownError(connection.channelType, 'UNEXPECTED_RESULT') };
      }
      return result;
    });
  }

  mediaRules(connectionId: string): Promise<{ channelType: ChannelType; rules: MediaRules }> {
    return withGatewayOp('platform_gateway', 'mediaRules', { connection_id: connectionId }, async () => {
      const { connection, adapter } = await this.resolve(connectionId);
      return { channelType: connection.channelType, rules: adapter.mediaRules() };
    });
  }

  submit(req: SubmitRequest): Promise<SubmitResult> {
    return withGatewayOp('platform_gateway', 'submit', { connection_id: req.connectionId }, async () => {
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
          resolve({ kind: 'failed', error: unknownError(connection.channelType, 'SUBMIT_TIMEOUT') });
        }, this.opts.submitTimeoutMs);
      });
      const call = adapter
        .submit(cred, {
          text: req.text,
          media: req.media,
          contentHash: req.contentHash,
          connectionId: connection.id,
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
    });
  }

  checkStatus(connectionId: string, processingId: string): Promise<CheckStatusResult> {
    return withGatewayOp('platform_gateway', 'checkStatus', { connection_id: connectionId }, async () => {
      const { connection, adapter } = await this.resolve(connectionId);
      if (connection.status === 'disconnected') {
        return { kind: 'failed', error: this.disconnectedError(connection.channelType) };
      }
      const value: unknown = await adapter
        .checkStatus(await this.credential(connection), processingId, { connectionId })
        .catch(() => undefined);
      return assertResultShape('checkStatus', connection.channelType, value);
    });
  }

  reconcile(req: ReconcileRequest): Promise<ReconcileResult> {
    return withGatewayOp('platform_gateway', 'reconcile', { connection_id: req.connectionId }, async () => {
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
          contentHash: req.contentHash,
          from: req.from,
          to: req.to,
        })
        .catch(() => undefined);
      return assertResultShape('reconcile', connection.channelType, value);
    });
  }

  classifyError(channelType: ChannelType, rawCode: string): ClassifiedError {
    return getAdapter(channelType).classifyError(rawCode);
  }

  refreshToken(connectionId: string): Promise<RefreshTokenResult> {
    return withGatewayOp('platform_gateway', 'refreshToken', { connection_id: connectionId }, async () => {
      const { connection, adapter } = await this.resolve(connectionId);
      if (connection.status === 'disconnected' || !adapter.capabilities.tokenRefresh) {
        // Kênh không tự gia hạn quyền được → người dùng "Kết nối lại".
        return { kind: 'failed', error: this.disconnectedError(connection.channelType) };
      }
      const result: unknown = await adapter
        .refreshToken(await this.credential(connection), { connectionId })
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
    });
  }

  capabilities(channelType: ChannelType): ChannelCapabilities {
    return { ...getAdapter(channelType).capabilities };
  }

  contentHash(channelType: ChannelType, text: string): string {
    return getAdapter(channelType).contentHash(text);
  }

  getConnection(connectionId: string): Promise<ChannelConnection | null> {
    return withGatewayOp('platform_gateway', 'getConnection', { connection_id: connectionId }, async () => {
      if (!UUID.test(connectionId)) return null;
      const c = await this.opts.store.getConnection(connectionId);
      return c === null ? null : toChannelConnection(c);
    });
  }
}
