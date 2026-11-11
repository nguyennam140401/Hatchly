# Hợp đồng – Cổng nền tảng (`platform_gateway`)

Lối vào duy nhất: `apps/server/src/modules/platform_gateway/index.ts`. Kiểu dữ liệu: [data-model.md](../data-model.md)
mục 1. Chỉ `publishing` gọi nhóm thao tác đăng (manifest); nhóm kết nối kênh do controller của chính module
phục vụ HTTP. **Không** thao tác nào nhận `accountId` (lấy từ ngữ cảnh) hay trả mã quyền.

## 1. Giao diện công khai cho module (token `PLATFORM_GATEWAY`)

```ts
export interface PlatformGatewayPublicApi {
  // --- 7 thao tác ADR-05, theo kết nối kênh ---
  checkAccount(connectionId: string): Promise<AccountCheckResult>;
  mediaRules(connectionId: string): Promise<{ channelType: ChannelType; rules: MediaRules }>;
  submit(req: SubmitRequest): Promise<SubmitResult>;
  checkStatus(connectionId: string, processingId: string): Promise<CheckStatusResult>;
  reconcile(req: ReconcileRequest): Promise<ReconcileResult>;
  classifyError(channelType: ChannelType, rawCode: string): ClassifiedError;   // thuần, đồng bộ
  refreshToken(connectionId: string): Promise<RefreshTokenResult>;

  // --- phụ trợ (không tính vào 7 thao tác) ---
  capabilities(channelType: ChannelType): ChannelCapabilities;                 // FR-012
  contentHash(channelType: ChannelType, text: string): string;                 // FR-014a
  getConnection(connectionId: string): Promise<ChannelConnection | null>;      // để Đăng bài lấy channelType
}

// Hàm thuần xuất kèm (không cần tiêm):
export function validateMedia(rules: MediaRules, items: MediaDescriptor[]): MediaViolation[];
export function applyErrorMapping(err: ClassifiedError, row?: ErrorMappingRow): ClassifiedError;
export const CHANNEL_TYPES: readonly ChannelType[];
```

### Quy tắc bất biến
1. `submit` ghi nhận **trước** khi gọi nền tảng là việc của Đăng bài (`submitted_awaiting_response`); cổng
   không tự thử lại `submit` trong bất kỳ trường hợp nào.
2. Hết thời gian chờ phản hồi của `submit` (mặc định 30 s, cấu hình) → `{ kind: 'failed', error.category:
   'unknown' }` – không bao giờ `transient`.
3. Kết quả adapter được kiểm khuôn (Zod) ở tầng cổng; ngoài khuôn → `failed/unknown` (với `submit`),
   `unsupported` (với `reconcile`), và nhật ký `platform.unexpected_result`.
4. `reconcile` tính lại `contentHash` trên chữ đọc từ nền tảng bằng chính `contentHash(channelType, …)`.
5. `classifyError` với mã không có trong bảng mặc định → `unknown`.
6. Kết nối không thuộc tài khoản trong ngữ cảnh / không tồn tại → `ConnectionNotFoundError` (không phân biệt
   hai trường hợp). Kết nối `disconnected` → `failed/user_action` (`reconnect`).
7. Loại kênh chưa có adapter → `ChannelNotSupportedError` ("Kênh này chưa được hỗ trợ").
8. Mọi thao tác ghi nhật ký `platform_gateway.<op>` + span OTel cùng `trace_id`, `account_id`,
   `connection_id`, `channel_type`, `outcome`; không mã quyền, không chữ bài.

### Lỗi ném (lỗi lập trình/hạ tầng – mọi lỗi nghiệp vụ là kết quả)
`ConnectionNotFoundError`, `ChannelNotSupportedError`, `InvalidRequestError` (vd `contentHash` không khớp,
`from > to`), `TenantContextError` (từ 002).

## 2. Giao diện nội bộ – bộ chuyển đổi (`internal/adapters/`)

```ts
export interface PlatformAdapter {
  readonly channelType: ChannelType;
  readonly capabilities: ChannelCapabilities;
  contentHash(text: string): string;
  checkAccount(cred: DecryptedCredential): Promise<AccountCheckResult>;
  mediaRules(): MediaRules;
  submit(cred: DecryptedCredential, req: AdapterSubmit): Promise<SubmitResult>;
  checkStatus(cred: DecryptedCredential, processingId: string): Promise<CheckStatusResult>;
  reconcile(cred: DecryptedCredential, q: AdapterReconcile): Promise<ReconcileResult>;
  classifyError(rawCode: string): ClassifiedError;
  refreshToken(cred: DecryptedCredential): Promise<RefreshTokenResult>;
  // Luồng kết nối (bản thật WBS 2.2 dùng OAuth):
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCallback(params: CallbackParams): Promise<{ candidates: ConnectionCandidate[] }>;
}
export function registerAdapter(type: ChannelType, make: () => PlatformAdapter): void; // chỉ trong registry.ts
export function listRegisteredAdapters(): PlatformAdapter[];
```
`DecryptedCredential` là kiểu có nhãn (branded) chỉ tạo được bởi `CredentialVault.decrypt`; `toJSON()` /
`inspect` trả `"[credential]"` để không lọt vào nhật ký.

## 3. Điểm cuối HTTP – kết nối kênh (FR-021)

| Phương thức + đường dẫn | Truy cập | Vào | Ra |
|---|---|---|---|
| `POST /api/channels/connect` | `@CustomerAccess('channel.manage')` | `{ channelType }` | `200 { authorizeUrl }` |
| `GET /api/channels/callback/:channelType` | `@Public` + kiểm `state` gắn phiên | query của nền tảng | `302` → `${WEB_BASE_URL}/channels/connect?selection={id}` hoặc `?error=CONNECT_CANCELLED\|STATE_INVALID` |
| `GET /api/channels/selections/:selectionId` | `channel.manage` | – | `200 { channelType, candidates: { externalId, displayName, check: AccountCheckResult }[] }` |
| `POST /api/channels` | `channel.manage` | `{ selectionId, externalId }` | `201 ChannelConnection` (hoặc `200` khi đã có) |
| `GET /api/channels` | `status.view` (chủ + CTV) | – | `200 ChannelConnection[]` |
| `DELETE /api/channels/:connectionId` | `channel.manage` | – | `204` |

- Lượt gọi lại không có phiên đăng nhập hợp lệ, `state` sai/hết hạn/đã dùng hoặc thuộc tài khoản khác →
  `STATE_INVALID`, không tạo gì. `error=access_denied` từ nền tảng → `CONNECT_CANCELLED`.
- Ứng viên `ineligible` hiển thị lý do, không lưu được (`422 CHANNEL_INELIGIBLE`).
- Khuôn lỗi theo `@app/shared` `error-response` (004). Kiểu DTO ở `packages/shared/src/modules/platform_gateway/`.

## 4. Bản giả lập (`internal/fake/`, chỉ `APP_ENV ∈ {development, test}`)

- `FakePlatformAdapter(channelType, store)` cho `facebook_page`, `instagram`, `zalo_oa`, `test_channel` – năng
  lực theo research R3.
- `FakePlatformStore` ×2: `memory` | `sandbox` (bảng `pg_fake_*`).
- API lập trình (kiểm thử): `fakePlatform.script(target, steps: FakeStep[])` với `FakeStep`:
  `{ submit: 'published' | 'processing_then_done' | 'processing_then_failed' | { fail: rawCode } |
  'timeout_after_publish' | 'timeout_before_publish' }`, `{ alterStoredText: 'shorten_links' | 'nfd' |
  'whitespace' }`, `{ reconcile: 'unsupported' }`, `{ refresh: 'ok' | 'fail' }`, `{ check: 'eligible' |
  'not_professional' | 'missing_permission' }`, `{ latencyMs }`; `fakePlatform.publishedCount(contentHash)`;
  `fakePlatform.posts(connectionId)`; `fakePlatform.reset()`.
- Bảng mã lỗi giả (mặc định phân loại):

  | rawCode | category | remedy |
  |---|---|---|
  | `FAKE_RATE_LIMIT` | transient (`retryAfterSec` 60) | `retry_later` |
  | `FAKE_NETWORK_BEFORE_SEND` | transient | `retry_later` |
  | `FAKE_TOKEN_EXPIRED` | user_action | `reconnect` |
  | `FAKE_PERMISSION_MISSING` | user_action | `reconnect` |
  | `FAKE_MEDIA_REJECTED` | user_action | `edit_media` |
  | `FAKE_TEXT_TOO_LONG` | user_action | `edit_text` |
  | `FAKE_SERVER_ERROR_AFTER_SEND` | unknown | `check_on_platform` |
  | (khác) | unknown | `check_on_platform` |

- Trang ủy quyền giả `GET /dev/fake-oauth/:channelType/authorize?state&redirect_uri` (HTML tối giản, 2 nút).
  Danh sách Page giả: mặc định 2 Page đủ điều kiện + 1 không đủ (Instagram "không phải tài khoản chuyên
  nghiệp"); đổi qua kịch bản `component=platform, target=oauth`.
- Bản giả lập **không** chặn đăng trùng: hai `submit` cùng dấu → 2 bài, `publishedCount = 2`.

## 5. Bộ kiểm thử hợp đồng (`test/contracts/platform/`)

`describePlatformAdapterContract(adapter, harness)` chạy cho **mọi** adapter trong `listRegisteredAdapters()`:
đủ 7 thao tác + `contentHash` (đổi nhẹ → cùng dấu; khác thật → khác dấu; có tiền tố `ch1:`); kết quả thuộc khuôn;
`classifyError` mã lạ → `unknown`; `capabilities.reconcile=false` → `reconcile` = `unsupported`.
`describePlatformGatewayContract(makeGateway, harness)`: 8 kịch bản US1, kênh chưa hỗ trợ, kết nối của tài khoản
khác → `ConnectionNotFoundError`, không mã quyền trong kết quả/nhật ký, luồng kết nối (state sai, hủy, trùng
Page). `harness` là API dàn kịch bản – bản thật sau này cung cấp harness của mình (vd máy chủ HTTP giả của
Graph API).
