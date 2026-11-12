import { AppError, requireCustomer } from '../../../../core';
import { withGatewayOp } from '../../../../core/gateways/op-log';
import type { AccountCheckResult, ChannelConnection, ChannelType } from '../../public-api';
import { getAdapter } from '../adapters/registry';
import { ConnectionNotFoundError } from '../errors';
import { toChannelConnection } from '../gateway.service';
import type { CredentialVault } from '../vault/credential-vault';
import type { ConnectionStore, StoredCandidate } from './connection-store';
import { hashOauthState, newOauthState, OAUTH_STATE_TTL_MS, SELECTION_TTL_MS } from './oauth-state';

// Luồng kết nối kênh (005, FR-021, FR-022, research R6): bắt đầu → trang ủy quyền của nền tảng → gọi lại
// (kiểm `state` gắn phiên + người dùng) → phiên chọn Page (kèm kết quả kiểm tra điều kiện) → lưu kết nối.
// Tài khoản luôn là tài khoản của phiên (tenantTx trong ngữ cảnh) – không bao giờ từ tham số.

export type CallbackOutcome =
  | { kind: 'selection'; selectionId: string }
  | { kind: 'error'; code: 'CONNECT_CANCELLED' | 'STATE_INVALID' };

export interface SelectionView {
  channelType: ChannelType;
  candidates: { externalId: string; displayName: string; check: AccountCheckResult }[];
}

function selectionNotFound(): AppError {
  return new AppError({
    code: 'SELECTION_NOT_FOUND',
    httpStatus: 404,
    message: 'Phiên chọn trang đã hết hạn hoặc không tồn tại. Vui lòng kết nối lại từ đầu.',
    actions: [{ kind: 'retry', label: 'Thử kết nối lại' }],
  });
}

function candidateNotFound(): AppError {
  return new AppError({
    code: 'CANDIDATE_NOT_FOUND',
    httpStatus: 404,
    message: 'Không tìm thấy trang đã chọn trong danh sách. Vui lòng chọn lại.',
    actions: [{ kind: 'retry', label: 'Chọn lại' }],
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

export class ConnectionsService {
  constructor(
    private readonly store: ConnectionStore,
    private readonly vault: CredentialVault,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Bắt đầu kết nối: lưu băm `state` gắn tài khoản + người dùng, trả địa chỉ ủy quyền của nền tảng. */
  startConnect(channelType: ChannelType, redirectUri: string): Promise<{ authorizeUrl: string }> {
    return withGatewayOp(
      'platform_gateway',
      'startConnect',
      { channel_type: channelType },
      async () => {
        const actor = requireCustomer();
        const adapter = getAdapter(channelType);
        const { state, hash } = newOauthState();
        await this.store.saveOauthState({
          stateHash: hash,
          userId: actor.userId,
          channelType,
          expiresAt: new Date(this.now().getTime() + OAUTH_STATE_TTL_MS),
        });
        return { authorizeUrl: adapter.authorizeUrl(state, redirectUri) };
      },
    );
  }

  /**
   * Lượt gọi lại: `state` sai / hết hạn / đã dùng / của tài khoản hay người dùng khác / khác loại kênh →
   * STATE_INVALID (không tạo gì). Người dùng hủy (`error=access_denied`) → CONNECT_CANCELLED.
   */
  handleCallback(
    channelType: ChannelType,
    q: { state?: string | undefined; code?: string | undefined; error?: string | undefined },
  ): Promise<CallbackOutcome> {
    return withGatewayOp(
      'platform_gateway',
      'handleCallback',
      { channel_type: channelType },
      async () => {
        const actor = requireCustomer();
        if (q.state === undefined || q.state === '')
          return { kind: 'error', code: 'STATE_INVALID' };
        const consumed = await this.store.consumeOauthState(hashOauthState(q.state), this.now());
        if (consumed?.userId !== actor.userId || consumed.channelType !== channelType) {
          return { kind: 'error', code: 'STATE_INVALID' };
        }
        if (q.error !== undefined) return { kind: 'error', code: 'CONNECT_CANCELLED' };
        const adapter = getAdapter(channelType);
        const { candidates } = await adapter.exchangeCallback({ code: q.code, error: q.error });
        if (candidates.length === 0) return { kind: 'error', code: 'CONNECT_CANCELLED' };
        const stored: StoredCandidate[] = [];
        for (const c of candidates) {
          const ciphertext = await this.vault.encrypt(c.accessToken);
          const check = await adapter.checkAccount(await this.vault.decrypt(ciphertext), {
            connectionId: `candidate:${c.externalId}`,
          });
          stored.push({
            externalId: c.externalId,
            displayName: c.displayName.slice(0, 120),
            tokenCiphertextB64: ciphertext.toString('base64'),
            tokenExpiresAt: c.tokenExpiresAt.toISOString(),
            check,
          });
        }
        const selectionId = await this.store.createSelection({
          channelType,
          userId: actor.userId,
          candidates: stored,
          expiresAt: new Date(this.now().getTime() + SELECTION_TTL_MS),
        });
        return { kind: 'selection', selectionId };
      },
    );
  }

  async getSelection(selectionId: string): Promise<SelectionView> {
    const actor = requireCustomer();
    const sel = await this.store.getSelection(selectionId, this.now());
    if (sel?.userId !== actor.userId) throw selectionNotFound();
    return {
      channelType: sel.channelType,
      candidates: sel.candidates.map((c) => ({
        externalId: c.externalId,
        displayName: c.displayName,
        check: reviveCheck(c.check),
      })),
    };
  }

  /** Lưu Page đã chọn. Đã có kết nối còn hiệu lực → trả kết nối có sẵn (`created: false`). */
  saveConnection(
    selectionId: string,
    externalId: string,
  ): Promise<{ connection: ChannelConnection; created: boolean }> {
    return withGatewayOp('platform_gateway', 'saveConnection', {}, async () => {
      const actor = requireCustomer();
      const sel = await this.store.getSelection(selectionId, this.now());
      if (sel?.userId !== actor.userId) throw selectionNotFound();
      const candidate = sel.candidates.find((c) => c.externalId === externalId);
      if (candidate === undefined) throw candidateNotFound();
      const check = reviveCheck(candidate.check);
      if (check.kind === 'ineligible') throw channelIneligible(check.error.messageVi);
      const { connection, created } = await this.store.insertConnection({
        channelType: sel.channelType,
        externalId: candidate.externalId,
        displayName: candidate.displayName,
        tokenCiphertext: Buffer.from(candidate.tokenCiphertextB64, 'base64'),
        tokenExpiresAt: new Date(candidate.tokenExpiresAt),
      });
      await this.store.consumeSelection(selectionId, this.now());
      return { connection: toChannelConnection(connection), created };
    });
  }

  async listConnections(): Promise<ChannelConnection[]> {
    return (await this.store.listConnections()).map(toChannelConnection);
  }

  async disconnect(connectionId: string): Promise<void> {
    const ok = await this.store.disconnect(connectionId);
    if (!ok) {
      const existing = await this.store.getConnection(connectionId);
      if (existing === null) throw new ConnectionNotFoundError();
    }
  }
}

/** Kết quả kiểm tra đọc lại từ JSON: ngày dạng chuỗi → Date. */
function reviveCheck(check: AccountCheckResult): AccountCheckResult {
  if (check.kind === 'eligible') {
    return { ...check, tokenExpiresAt: new Date(check.tokenExpiresAt) };
  }
  return check;
}
