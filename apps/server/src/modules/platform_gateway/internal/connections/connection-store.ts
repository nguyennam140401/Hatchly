import type { Db } from '../../../../core/db';
import type { channelConnections } from '../db/schema';
import type { AccountCheckResult, ChannelType, ExpiryInfo } from '../../public-api';

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
  /** `null` ⇔ `expiryKind = 'none'` (Meta không có mốc hạn cố định). Bản giả luôn có ngày. */
  tokenExpiresAt: Date | null;
  /** Trạng thái LEGACY của 005 (2 giá trị). Trạng thái đầy đủ ở `rowStatus`. */
  status: 'active' | 'disconnected';
  connectedAt: Date;
  // ----- 010 (bản giả để trống; bản thật `PgConnectionStore` điền đủ) -----
  rowStatus?: 'active' | 'needs_reconnect' | 'ineligible' | 'disconnected';
  reasonCode?: string | null;
  expiryKind?: 'none' | 'token' | 'data_access';
  sourceConnectionId?: string | null;
  avatarUrl?: string | null;
  accountType?: string | null;
  grantedScopes?: string[];
  quotaRemaining?: number | null;
  /** Mã người dùng dài hạn đã mã hóa (Meta) / refresh_token (TikTok). */
  refreshCiphertext?: Buffer | null;
  tokenIssuedAt?: Date;
  lastErrorCode?: string | null;
  lastCheckedAt?: Date | null;
  lastRefreshedAt?: Date | null;
  lastManualCheckAt?: Date | null;
  recheckRequired?: boolean;
  lastNotifiedStage?: 'd7' | 'd1' | 'expired' | null;
  disconnectedAt?: Date | null;
  version?: number;
}

/** Ứng viên trong phiên chọn – mã quyền đã mã hóa (base64), kết quả kiểm tra điều kiện. */
export interface StoredCandidate {
  externalId: string;
  displayName: string;
  tokenCiphertextB64: string;
  /** `null` khi nền tảng không có mốc hạn cố định. */
  tokenExpiresAt: string | null;
  check: AccountCheckResult;
  // ----- 010 (tùy chọn) -----
  avatarUrl?: string | null;
  accountType?: string | null;
  sourceExternalId?: string | null;
  /** Mã người dùng dài hạn đã mã hóa (base64). */
  refreshCiphertextB64?: string | null;
  expiry?: ExpiryInfoJson;
}

/** `ExpiryInfo` dạng JSON (ngày là chuỗi ISO) để lưu trong `connect_selections.candidates`. */
export type ExpiryInfoJson =
  { kind: 'none' } | { kind: 'token' | 'data_access'; expiresAt: string };

export function expiryToJson(e: ExpiryInfo): ExpiryInfoJson {
  return e.kind === 'none' ? e : { kind: e.kind, expiresAt: e.expiresAt.toISOString() };
}
export function expiryFromJson(e: ExpiryInfoJson): ExpiryInfo {
  return e.kind === 'none' ? e : { kind: e.kind, expiresAt: new Date(e.expiresAt) };
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
  tokenExpiresAt: Date | null;
  // ----- 010 (tùy chọn) -----
  refreshCiphertext?: Buffer | null;
  expiryKind?: 'none' | 'token' | 'data_access';
  avatarUrl?: string | null;
  accountType?: string | null;
  grantedScopes?: string[];
  quotaRemaining?: number | null;
  sourceConnectionId?: string | null;
  /** Giới hạn mỗi nền tảng: có → store tự khóa + đếm trong cùng giao dịch chèn (R8). */
  maxPerPlatform?: number;
}

/** Các cột được phép cập nhật bằng `updateRow` (không có `id`, `account_id`, `version`). */
export type ConnectionPatch = Partial<
  Pick<
    typeof channelConnections.$inferInsert,
    | 'display_name'
    | 'avatar_url'
    | 'account_type'
    | 'granted_scopes'
    | 'quota_remaining'
    | 'source_connection_id'
    | 'token_ciphertext'
    | 'refresh_ciphertext'
    | 'token_issued_at'
    | 'expiry_kind'
    | 'token_expires_at'
    | 'status'
    | 'reason_code'
    | 'last_error_code'
    | 'last_checked_at'
    | 'last_refreshed_at'
    | 'last_manual_check_at'
    | 'recheck_required'
    | 'last_notified_stage'
    | 'disconnected_at'
  >
>;

/** Lý do kênh phải kết nối lại do bên đăng bài/nền tảng báo (FR-023). */
export interface AuthFailure {
  /** Mã hiển thị đã lọc (`TOKEN_EXPIRED`, `TOKEN_REVOKED`, `SCOPE_MISSING`…). */
  reasonCode: string;
  /** Mã lỗi gốc đã lọc `[A-Za-z0-9_.:-]{1,64}` – chỉ hiện ở "Chi tiết cho hỗ trợ". */
  rawCode: string;
}

export interface ConnectionStore {
  getConnection(id: string): Promise<StoredConnection | null>;
  listConnections(): Promise<StoredConnection[]>;
  /** Trùng `(account, channelType, externalId)` còn hiệu lực → trả kết nối có sẵn, `created: false`. */
  insertConnection(c: NewConnection): Promise<{ connection: StoredConnection; created: boolean }>;
  /** `active → disconnected` (cập nhật có điều kiện); false khi không có/đã ngắt. */
  disconnect(id: string): Promise<boolean>;
  updateTokenExpiry(id: string, expiresAt: Date): Promise<void>;
  /**
   * 010: CHỈ `active → needs_reconnect` bằng cập nhật có điều kiện (idempotent: đã `needs_reconnect`/`ineligible`/ngắt ⇒
   * `false`, không làm gì). `within` chạy TRONG cùng giao dịch khi có chuyển trạng thái (để phát thông báo). Bản giả
   * không cài đặt (kênh giả không hỏng quyền theo cách này).
   */
  markAuthFailure?(
    id: string,
    failure: AuthFailure,
    within?: (connection: StoredConnection, tx: Db) => Promise<void>,
  ): Promise<boolean>;
  /**
   * 010: cập nhật có điều kiện theo `version` (kết nối lại tại chỗ, kiểm tra lại…). Xung đột ⇒ `VERSION_CONFLICT`.
   * Bản giả không cài đặt.
   */
  updateRow?(
    id: string,
    expectedVersion: number,
    patch: ConnectionPatch,
  ): Promise<StoredConnection>;
  /** 010: xóa HẲN phiên chọn (mã quyền của ứng viên không được chọn bị hủy cùng dòng). */
  deleteSelection?(id: string): Promise<void>;
  /** 010: mọi kết nối chưa ngắt của tài khoản (cho ngắt hàng loạt). */
  listLiveConnections?(): Promise<StoredConnection[]>;
  saveOauthState(s: {
    stateHash: Buffer;
    userId: string;
    channelType: ChannelType;
    expiresAt: Date;
    /** 010: kết nối lại đúng kênh này (giữ `connectionId`). */
    reconnectConnectionId?: string | null;
  }): Promise<void>;
  /** Dùng một lần: `used_at IS NULL AND expires_at > now` → đánh dấu đã dùng; sai/hết hạn/đã dùng → null. */
  consumeOauthState(
    stateHash: Buffer,
    now: Date,
  ): Promise<{
    userId: string;
    channelType: ChannelType;
    reconnectConnectionId?: string | null;
  } | null>;
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
