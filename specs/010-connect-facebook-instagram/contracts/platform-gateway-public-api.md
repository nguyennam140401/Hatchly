# Hợp đồng – giao diện công khai của `platform_gateway` (thay đổi của 010)

Nguyên tắc: **chỉ cộng thêm** vào `apps/server/src/modules/platform_gateway/public-api.ts` của 005/013. Không đổi nghĩa/tên thao tác đang được
012 (`content`) và 013 (`publishing`) dùng. Mọi thao tác theo `connectionId` trong tài khoản của ngữ cảnh, **không nhận `accountId`**, **không bao giờ trả mã quyền**.

## 1. Kiểu dữ liệu (cộng thêm)

```ts
export const CHANNEL_TYPES = ['facebook_page', 'instagram', 'zalo_oa', 'test_channel', 'tiktok'] as const;   // + 'tiktok'

/** Giữ nguyên 4 giá trị – 012/013 so sánh trực tiếp. */
export type ChannelConnectionStatus = 'active' | 'expiring' | 'expired' | 'disconnected';
/** Trạng thái hiển thị (FR-025) – dẫn xuất, xem data-model.md. */
export type ChannelState = 'active' | 'expiring' | 'needs_reconnect' | 'ineligible' | 'suspended' | 'disconnected';

export interface ChannelConnection {            // đã có; thêm các trường TÙY CHỌN ở cuối
  connectionId: string; channelType: ChannelType; displayName: string; externalId: string;
  status: ChannelConnectionStatus;               // luôn theo toLegacyStatus(state) – bất biến kiểm thử
  tokenExpiresAt: Date | null;                   // ĐỔI: null khi expiry.kind = 'none' (trước đây luôn có giá trị)
  connectedAt: Date;
  // --- 010 (cộng thêm) ---
  state?: ChannelState;
  reasonCode?: string | null;
  expiry?: { kind: 'none' | 'token' | 'data_access'; expiresAt: Date | null };
  sourceConnectionId?: string | null;
}
```

> **Điểm đổi kiểu duy nhất:** `tokenExpiresAt` đổi từ `Date` sang `Date | null` (FR-018: không bịa ngày); `ChannelConnectionDto` (shared) đổi `tokenExpiresAt: string | null`.
> Đã kiểm bằng `git grep tokenExpiresAt dev` (2026-11-17): ngoài `platform_gateway`, chỉ có **fixture kiểm thử** *tạo* giá trị
> (`test/contracts/platform/harness.ts`, `test/db/approval-atomicity.db.spec.ts`, `test/queue/publishing/harness.ts`, `web/test/posts/ComposePage.spec.tsx`) –
> không có mã chạy thật của 012/013 đọc trường này, và fixture truyền giá trị hợp lệ với kiểu mới. Sau khi merge `dev` ở bước implement phải chạy lại lệnh này;
> nếu xuất hiện nơi đọc mới thì chuyển sang `expiry` và báo tính năng đó (một nhiệm vụ kiểm trong tasks).
> Bản giả (005) vẫn luôn trả ngày nên hành vi dev/test không đổi.

## 2. Thao tác công khai mới (hoặc mở rộng)

```ts
interface PlatformGatewayPublicApi {
  // …các thao tác 005/013 giữ nguyên…
  /** Trạng thái hiển thị đã dẫn xuất; null khi không có/không thuộc tài khoản. Không gọi nền tảng. */
  getConnectionState(connectionId: string): Promise<ChannelConnection | null>;   // = getConnection + trường 010
  /** Danh sách kết nối của tài khoản (không mã quyền, không gọi nền tảng). */
  listConnections(filter?: { channelTypes?: ChannelType[]; usableOnly?: boolean }): Promise<ChannelConnection[]>;
  /** FR-023: bên đăng bài báo "quyền hỏng" để cập nhật trạng thái kênh (module Đăng bài KHÔNG ghi thẳng vào bảng). */
  reportAuthFailure(connectionId: string, report: { rawCode: string; kind: 'token_expired' | 'token_revoked' | 'scope_missing' }): Promise<void>;
  /** FR-014/FR-17 + xóa tài khoản: ngắt mọi kết nối của tài khoản trong ngữ cảnh, xóa mã quyền ngay. */
  disconnectAllForAccount(): Promise<{ disconnected: number }>;
  /** Công tắc cho nơi khác cần biết (vd UI chọn kênh); đọc `override ?? default`, lỗi → false. */
  isFeatureEnabled(flag: 'channel.tiktok'): Promise<boolean>;
}
```

- `reportAuthFailure`: chạy trong tenantTx của người gọi; **chỉ** chuyển `active → needs_reconnect` bằng cập nhật có điều kiện (đã `needs_reconnect/disconnected` → không làm gì); phát thông báo gom
  với khóa chống trùng; idempotent. Hiện **013 chưa gọi** hàm này (chỉ trả lỗi cần người dùng); 010 cung cấp hàm + kiểm thử, việc nối từ `precheck`/`classifyError` là một đề xuất nhỏ gửi 013 (không chặn 010). *(FR-023)*
- `disconnectAllForAccount`: dùng bởi luồng xóa tài khoản (FR-14, tính năng khác) qua việc `platform_gateway.disconnect_all`; kết quả mã quyền bị xóa trong cùng giao dịch, thu hồi phía nền tảng là cố gắng tối đa (5 giây/kết nối, song song giới hạn 5).

## 3. Cổng ngược cho module tiêu thụ

```ts
export interface ConnectionConsumersPort {
  scheduledImpact(connectionIds: readonly string[]): Promise<Map<string, { count: number; nextAt: Date | null }>>;
  /** Gọi TRONG giao dịch ngắt của cổng. Hiện thực: publishing.cancelAllForConnection(tx, connectionId). */
  onDisconnect(tx: Db, connectionId: string): Promise<{ cancelled: number }>;
  /** Bảng ánh xạ lỗi cấu hình (FR-032). Hiện thực: đọc publishing.error_mappings (013). */
  errorMappings(): Promise<ErrorMappingRow[]>;
}
export function registerConnectionConsumers(port: ConnectionConsumersPort): void;   // gọi ở onModuleInit của PublishingModule
```

Chưa đăng ký (chỉ chạy 010 hoặc kiểm thử cổng) → bản rỗng: `count 0`, `cancelled 0`, `errorMappings = []` (dùng bảng mặc định trong bộ chuyển đổi). `publishing` thêm hàm đọc `countScheduledByConnections(connectionIds)` vào `PublishingPublicApi` (cộng thêm, chỉ đếm lượt `scheduled|retry_wait` còn hiệu lực + giờ gần nhất).

## 4. Giao diện nội bộ bộ chuyển đổi (cộng thêm vào `PlatformAdapter`)

```ts
interface PlatformAdapter {
  // …hiện có…
  /** Thu hồi quyền phía nền tảng (nếu có). Không ném: trả 'done' | 'failed' | 'unsupported'. */
  revoke(cred: DecryptedCredential, ctx: AdapterCallContext): Promise<'done' | 'failed' | 'unsupported'>;
  /** Cách nền tảng thể hiện hạn quyền (R2). */
  expiryOf(cred: DecryptedCredential, refreshCred: DecryptedCredential | null, ctx: AdapterCallContext): Promise<ExpiryInfo>;
  /** exchangeCallback trả thêm: loại tài khoản, quyền đã cấp, Page nguồn, ảnh đại diện, hạn, mã làm mới. */
}
interface ConnectionCandidate {                 // đã có; thêm trường TÙY CHỌN
  externalId; displayName; accessToken; tokenExpiresAt: Date | null;
  avatarUrl?: string; accountType?: string; grantedScopes?: string[]; sourceExternalId?: string;
  refreshToken?: string; expiry?: ExpiryInfo;
}
```

`checkAccount` (đã có) trả thêm `expiry` trong `eligible`; `ineligible.error.remedies` luôn ≥ 1. Bộ kiểm thử hợp đồng `adapter-contract.spec.ts` (013) thêm các ca: `revoke` không ném; `expiryOf` đúng 3 dạng; `authorizeUrl` **không** chứa bí mật ứng dụng; `exchangeCallback` không trả mã quyền ra ngoài `DecryptedCredential`/`ConnectionCandidate.accessToken` (nội bộ).

## 5. Quy tắc ranh giới & kê khai

- `modules.manifest.json`: `platform_gateway.allowedDeps = ["account", "notifications", "queue"]` (thêm `account` – đọc `getPublishingEligibility()`).
- `publishing` đăng ký cổng ngược; **không** import nội bộ của `platform_gateway`.
- `pnpm check:boundaries` phải xanh; quy tắc ESLint "chỉ `internal/adapters` + `internal/vault` được import `revealCredential`" mở rộng sang `adapters/tiktok/`.
- Ghi vào tài liệu: `apps/server/docs/gateways.md` (mục 1, 5, 6) + `docs/wiki/modules/platform_gateway.md` + ADR-13.
