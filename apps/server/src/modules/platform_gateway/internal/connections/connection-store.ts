import type { AccountCheckResult, ChannelType } from '../../public-api';

// Kho kết nối kênh + trạng thái luồng kết nối (005, R6). Bản giả lập: `internal/fake/store.*.ts` (bảng
// `sandbox.pg_fake_*`); bản thật WBS 2.2: bảng `platform_gateway.channel_connections` + mã quyền KMS.
// Mọi thao tác trong ngữ cảnh tenant (RLS) – không nhận mã tài khoản.

export interface StoredConnection {
  id: string;
  channelType: ChannelType;
  externalId: string;
  displayName: string;
  /** Mã quyền đã mã hóa bằng CredentialVault. */
  tokenCiphertext: Buffer;
  tokenExpiresAt: Date;
  status: 'active' | 'disconnected';
  connectedAt: Date;
}

/** Ứng viên trong phiên chọn – mã quyền đã mã hóa (base64), kết quả kiểm tra điều kiện. */
export interface StoredCandidate {
  externalId: string;
  displayName: string;
  tokenCiphertextB64: string;
  tokenExpiresAt: string;
  check: AccountCheckResult;
}

export interface StoredSelection {
  id: string;
  channelType: ChannelType;
  userId: string;
  candidates: StoredCandidate[];
}

export interface NewConnection {
  channelType: ChannelType;
  externalId: string;
  displayName: string;
  tokenCiphertext: Buffer;
  tokenExpiresAt: Date;
}

export interface ConnectionStore {
  getConnection(id: string): Promise<StoredConnection | null>;
  listConnections(): Promise<StoredConnection[]>;
  /** Trùng `(account, channelType, externalId)` còn hiệu lực → trả kết nối có sẵn, `created: false`. */
  insertConnection(c: NewConnection): Promise<{ connection: StoredConnection; created: boolean }>;
  /** `active → disconnected` (cập nhật có điều kiện); false khi không có/đã ngắt. */
  disconnect(id: string): Promise<boolean>;
  updateTokenExpiry(id: string, expiresAt: Date): Promise<void>;
  saveOauthState(s: {
    stateHash: Buffer;
    userId: string;
    channelType: ChannelType;
    expiresAt: Date;
  }): Promise<void>;
  /** Dùng một lần: `used_at IS NULL AND expires_at > now` → đánh dấu đã dùng; sai/hết hạn/đã dùng → null. */
  consumeOauthState(
    stateHash: Buffer,
    now: Date,
  ): Promise<{ userId: string; channelType: ChannelType } | null>;
  createSelection(s: {
    channelType: ChannelType;
    userId: string;
    candidates: StoredCandidate[];
    expiresAt: Date;
  }): Promise<string>;
  /** Phiên chọn còn hạn, chưa dùng; không có → null. */
  getSelection(id: string, now: Date): Promise<StoredSelection | null>;
  /** Đánh dấu đã dùng (cập nhật có điều kiện) – false khi đã dùng/hết hạn. */
  consumeSelection(id: string, now: Date): Promise<boolean>;
}
