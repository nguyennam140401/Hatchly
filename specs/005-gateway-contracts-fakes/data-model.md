# Data Model – 005 Khung giao diện công khai + bản giả lập

Tính năng **không** tạo bảng nghiệp vụ trong migration chính. Gồm hai phần:

1. **Thực thể trên hợp đồng** (kiểu TypeScript/Zod) – mục 1–4.
2. **Bảng trạng thái giả lập** trong schema `sandbox`, chỉ migration dev (`drizzle/migrations-dev`,
   áp khi `APP_ENV ∈ {development, test}`) – mục 5.

Tiền là `number` nguyên micro-USD trên hợp đồng (≤ 2^53, đủ cho mọi trần), `bigint` trong CSDL
(`microUsd()` của 002). Thời gian là `Date` (UTC). Mã là UUID v7.

## 0. Ánh xạ thuật ngữ mới (thêm vào architecture.md mục 11)

| Tài liệu (VN) | Mã nguồn |
|---|---|
| bộ chuyển đổi nền tảng / danh mục bộ chuyển đổi | `PlatformAdapter` / `AdapterRegistry` |
| năng lực kênh | `ChannelCapabilities` |
| loại kênh | `ChannelType`: `facebook_page`, `instagram`, `zalo_oa`, `test_channel` |
| kiểm tra điều kiện tài khoản / quy tắc media / gửi bài / kiểm tra trạng thái xử lý / đối soát / phân loại lỗi / làm mới quyền | `checkAccount` / `mediaRules` / `submit` / `checkStatus` / `reconcile` / `classifyError` / `refreshToken` |
| dấu nội dung | `contentHash` (tiền tố `ch1:`) |
| chắc chắn chưa nhận / cần người dùng / không xác định | `transient` / `user_action` / `unknown` |
| tìm thấy / không tìm thấy / không đối soát được | `found` / `not_found` / `unsupported` |
| kho mã quyền (nội bộ Cổng nền tảng) | `CredentialVault` |
| phiên chọn Page sau gọi lại | `connection selection` (`selectionId`) |
| loại việc AI | `AiTask`: `post_generation`, `topic_suggestion`, `image_labeling`, `video_labeling`, `transcription`, `trend_summary` |
| hạng mô hình | `ModelTier`: `default`, `cheap`, `cheap_vision`, `stt` |
| giữ chỗ / đánh dấu đang gọi / quyết toán / trả lại | `reserve` / `markCalling` / `settle` / `release` |
| ngân sách hệ thống (theo tuần) | `system budget` (`week_start`) |
| bất thường chi phí | `anomaly`: `over_estimate`, `unsettled` (quyết toán theo ước tính khi treo sau lúc gọi) |
| sự kiện thông báo / loại thông báo | `NotificationEvent` / `NotificationType` |
| nhóm gộp email | `emailBatch`: `batch_10m`, `immediate` |
| vị trí tệp / đường dẫn ký sẵn | `StorageLocation` / `PresignedUpload`, `SignedUrl` |
| kho tệp (hạ tầng) | `core/storage`, `ObjectStorage`, `OBJECT_STORAGE` |
| kết quả gửi thư | `MailDeliveryResult`: `sent`, `transient`, `permanent` |
| trạng thái giả lập | schema `sandbox`, `FAKE_STATE_STORE` (`memory` \| `sandbox`) |
| kịch bản giả lập | `FakeScenario`, bảng `sandbox.fake_scenarios` |

## 1. Cổng nền tảng

### ChannelCapabilities
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `reconcile` | boolean | false → `reconcile` luôn trả `unsupported` |
| `asyncProcessing` | boolean | true → `submit` có thể trả `processing` |
| `tokenRefresh` | boolean | false → `refreshToken` trả `user_action` "Kết nối lại" |
| `reportsQuota` | boolean | `checkAccount.quotaRemaining` có giá trị |
| `maxReconcileWindowHours` | number \| null | khoảng tìm kiếm vượt → `unsupported` |

### MediaRules / MediaViolation
- `MediaRules`: `{ maxItems, image: { formats: ('jpeg'|'png'|'webp')[], maxBytes, minAspect, maxAspect } | null,
  video: { formats: ('mp4'|'mov')[], maxBytes, maxDurationSec, minAspect, maxAspect } | null, allowMixed }`.
- `MediaDescriptor` (đầu vào kiểm tra): `{ mediaId, kind: 'image'|'video', format, bytes, width, height,
  durationSec? }`.
- `MediaViolation`: `{ mediaId | null, rule: 'format'|'size'|'duration'|'aspect'|'count'|'mixed',
  messageVi, limit, actual }`. Kiểm bằng hàm thuần `validateMedia(rules, items)` (dùng ở UI cảnh báo sớm và
  ở bước 1–2).

### SubmitRequest / SubmitResult
- `SubmitRequest`: `{ connectionId, text (≤ 63 206 ký tự), media: { url, kind, mediaId }[], contentHash,
  traceId? }` – `contentHash` phải bằng `contentHash(channelType, text)` (cổng kiểm lại; lệch →
  `InvalidRequestError`).
- `SubmitResult` (hợp đóng):
  - `{ kind: 'published', platformPostId, permalink }`
  - `{ kind: 'processing', processingId }`
  - `{ kind: 'failed', error: ClassifiedError }` – hết thời gian sau khi gửi → `error.category = 'unknown'`.

### CheckStatusResult
`{ kind: 'processing' } | { kind: 'done', platformPostId, permalink } | { kind: 'failed', error }`.

### ReconcileRequest / ReconcileResult
- Vào: `{ connectionId, contentHash, from: Date, to: Date }` (`to - from` > `maxReconcileWindowHours` →
  `unsupported`).
- Ra: `{ kind: 'found', platformPostId, permalink } | { kind: 'not_found' } | { kind: 'unsupported', reason:
  'capability' | 'window_too_large' | 'platform_unavailable' }`.

### ClassifiedError
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `category` | `'transient' \| 'user_action' \| 'unknown'` | |
| `rawCode` | string | đã lọc `[A-Za-z0-9_.:-]{1,64}` |
| `channelType` | ChannelType | |
| `messageVi` | string | tiếng Việt đời thường |
| `remedies` | `{ action: RemedyAction, labelVi }[]` (≥ 1) | `RemedyAction`: `reconnect`, `retry_later`, `edit_media`, `edit_text`, `check_on_platform`, `contact_support` |
| `retryAfterSec` | number \| undefined | chỉ với `transient` |

`ErrorMappingRow` (do Đăng bài sở hữu, WBS 2.4): `{ channelType, rawCode, category, messageVi, remedies }`.
`applyErrorMapping(err, row?)` → nếu có `row` và `row.channelType/rawCode` khớp thì thay 3 trường
`category/messageVi/remedies`, giữ `rawCode`, `channelType`.

### AccountCheckResult
`{ kind: 'eligible', accountType, grantedScopes: string[], quotaRemaining: number | null, tokenExpiresAt: Date }
| { kind: 'ineligible', error: ClassifiedError /* category = user_action */ }`.

### RefreshTokenResult
`{ kind: 'refreshed', tokenExpiresAt } | { kind: 'failed', error /* user_action, remedy reconnect */ }`.

### ChannelConnection (hợp đồng liệt kê – không mã quyền)
| Trường | Kiểu |
|---|---|
| `connectionId` | uuid |
| `channelType` | ChannelType |
| `displayName` | string ≤ 120 |
| `externalId` | string (mã Page/tài khoản trên nền tảng) |
| `status` | `'active' \| 'expiring' \| 'expired' \| 'disconnected'` (`expiring` = còn < 7 ngày) |
| `tokenExpiresAt` | Date |
| `connectedAt` | Date |

### Luồng kết nối – trạng thái
```
startConnect ──► oauth_state(pending, 10') ──callback ok──► selection(open, 10') ──save──► connection(active)
                       │                         │                                   └─ trùng → trả kết nối có sẵn
                       ├─ hết hạn / sai / khác tài khoản → STATE_INVALID
                       └─ người dùng hủy → CONNECT_CANCELLED (hành động "Thử kết nối lại")
connection: active ──(<7 ngày)──► expiring ──► expired ; bất kỳ ──disconnect──► disconnected
```

## 2. Cổng AI

### AiRequest
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `task` | AiTask | quyết định hạng mô hình |
| `prompt` | `{ system: string; businessProfile?: { versionId, text }; weeklyTrends?: { weekStart, text }; delta: string }` | thứ tự cố định |
| `maxOutputTokens` | int 1–8 192 | |
| `images` | `{ url, bytes }[]` (chỉ `image_labeling`/`video_labeling`, ≤ 8) | khung hình thu nhỏ |
| `traceId` | string? | mặc định từ ngữ cảnh |

`TranscribeRequest`: `{ audioUrl, durationSec, language: 'vi' }`.

### AiResult
`{ text, modelTier, usage: { inputTokens, outputTokens, cachedInputTokens }, traceId }` – **không** có số tiền.
`AiStream`: `AsyncIterable<{ delta: string }>` + `result: Promise<AiResult>` + `cancel(): void`.

### AiError (hợp đóng, lớp lỗi có `code`)
| `code` | Khi nào | Thông điệp | Bên gọi tự thử lại? |
|---|---|---|---|
| `AI_BUDGET_EXHAUSTED` | không giữ chỗ được | "Đã sử dụng hết giới hạn AI của chu kỳ" | **Không** (→ `noRetry` trong việc nền) |
| `AI_PROVIDER_UNAVAILABLE` | chính + dự phòng đều lỗi | "Dịch vụ AI tạm thời không phản hồi, vui lòng thử lại sau" | Có (việc nền) |
| `AI_INVALID_REQUEST` | sai khuôn, quá giới hạn | "Yêu cầu không hợp lệ" | Không |
| `AI_SYSTEM_BUDGET_EXHAUSTED` | chỉ thao tác hệ thống | nội bộ | Không |

### AiUsage (cho khách)
`{ percent: 0..100 (floor), state: 'normal' | 'cheap_model' | 'blocked', nextCycleStartsAt: Date }` –
`state`: `blocked` khi `used + reserved >= cap` **hoặc** `cap - used - reserved < minCallEstimate`; `cheap_model` khi
`used + reserved >= soft_limit`; còn lại `normal`. `minCallEstimate` = ước tính của `image_labeling` với 0 token đầu vào,
`maxOutputTokens = 1`, theo giá `cheap_vision` hiện hành (tính trong `estimate.ts`, không hằng số cứng).

### Budget (khái niệm – bản giả lập hiện thực, bản thật WBS 3.1)
| Trường | Ràng buộc |
|---|---|
| `scope` | `account` (key = `account_id` + `cycle_start`) \| `system` (key = `week_start`, thứ Hai 00:00 UTC+7) |
| `used`, `reserved` | ≥ 0; **`used + reserved <= cap`** |
| `cap` | tài khoản 4 000 000; hệ thống `AI_SYSTEM_WEEKLY_CAP_MICRO_USD` |
| `soft_limit` | tài khoản 2 000 000; hệ thống = cap (luôn `cheap`) |
| `notified80`, `notified100` | cờ phát sự kiện 1 lần/chu kỳ; bật bằng cập nhật có điều kiện (`= false`) **trong cùng giao dịch** quyết toán với việc tạo sự kiện thông báo |

`cycle_start` của bản giả lập: ngày 1 tháng hiện tại UTC+7, hoặc do kịch bản đặt (chu kỳ theo ngày kích hoạt
thật là WBS 4.4 – `account` cung cấp).

### Reservation
`{ id, scope, key, estimateMicroUsd, modelTier, task, reservedAt, calledAt: Date | null, state: 'held' | 'calling' |
'settled' | 'released' }`.
Chuyển trạng thái (mọi bước là cập nhật có điều kiện theo trạng thái hiện tại):
- `held → calling` (`markCalling`, đặt `calledAt`) – **ngay trước** mỗi lần gọi nhà cung cấp.
- `held → released` – lỗi/hủy trước khi gọi; treo > 15 phút khi chưa gọi.
- `calling → settled` – quyết toán theo chi phí thực.
- `calling → released` – nhà cung cấp báo lỗi/hết thời gian (hiến pháp III); hủy trả dần khi chưa có đầu ra.
- `calling → settled` theo **ước tính** – treo > 15 phút khi đã gọi (`releaseStale`), dòng sổ `anomaly = 'unsettled'`.

### CostLedgerEntry
`{ id, scope, accountId | null, industryId | null, cycleOrWeekStart, task, modelTier, modelId, provider,
inputTokens, outputTokens, cachedInputTokens, costMicroUsd (thực, không kẹp; với `unsettled` = ước tính), estimateMicroUsd, anomaly:
'over_estimate' | 'unsettled' | null, overCapMicroUsd (≥ 0), traceId, createdAt }`. Dòng `unsettled` ghi token = 0 (không biết
token thực).

### PriceEntry (cấu hình)
`{ modelTier, modelId, provider, inputPerMTokMicroUsd, outputPerMTokMicroUsd, cachedInputPerMTokMicroUsd,
perAudioMinuteMicroUsd?, effectiveFrom }` – bản giả lập đọc từ JSON cấu hình; chọn dòng `effectiveFrom <= now`
mới nhất.

## 3. Thông báo

### NotificationType – danh mục đóng (UI/UX mục 8)
| `type` | `refs` | Người nhận | Kênh | Email | `dedupeKey` |
|---|---|---|---|---|---|
| `post_pending_review` | `submissionId`, `postIds[]` (≤ 50), `authorUserId` | owner | in_app, email | immediate (một lần gửi duyệt nhiều bài → một sự kiện → một email) | `post_pending_review:{submissionId}` |
| `post_returned` | `postId`, `postVersion`, `authorUserId` | post_author | in_app | – | `post_returned:{postId}:{postVersion}` |
| `approved_post_rescheduled` | `postId`, `postVersion` (int ≥ 1 – cột phiên bản của bài, tăng khi đổi giờ), `byUserId` | owner | in_app | – | `approved_post_rescheduled:{postId}:{postVersion}` |
| `batch_generation_done` | `planId`, `batchId` (uuid – mã lượt tạo hàng loạt), `requestedByUserId` | actor_target | in_app | – | `batch_generation_done:{planId}:{batchId}` |
| `publish_needs_action` | `attemptId`, `postId`, `authorUserId`, `state: 'needs_user' \| 'needs_check'` | owner, post_author | in_app, email | batch_10m | `publish_needs_action:{attemptId}:{state}` |
| `channel_token_expiring` | `connectionId`, `expiresOn` (date) | owner | in_app, email | immediate | `channel_token_expiring:{connectionId}:{expiresOn}` |
| `ai_usage_80` | `cycleStart` | owner | in_app, email | immediate | `ai_usage_80:{cycleStart}` |
| `ai_usage_100` | `cycleStart` | owner | in_app, email | immediate | `ai_usage_100:{cycleStart}` |
| `plan_expiring` | `subscriptionId`, `expiresOn` | owner | in_app, email | immediate | `plan_expiring:{subscriptionId}:{expiresOn}` |
| `data_deletion_scheduled` | `deleteOn` | owner | in_app, email | immediate | `data_deletion_scheduled:{deleteOn}` |

Kênh và người nhận khớp UI/UX mục 8 (đã đối chiếu 2026-11-11); `batch_10m` chỉ có ở "Bài cần xử lý / cần kiểm
tra". Bộ kiểm thử hợp đồng khóa bảng này (đổi bảng = đổi kiểm thử, phải review).

### NotificationEvent (đầu vào `emit`)
`{ type, refs, params: { postTitle?: string ≤ 60, channelDisplayName?: string ≤ 120, percent?: 80|100 },
actions?: { kind: 'open_post' | 'open_attempt' | 'reconnect_channel' | 'open_usage' | 'open_plan', targetId? }[] }`
– mỗi loại có `actions` mặc định ≥ 1 (FR-044). Kiểm: `strictObject`, trường bị cấm (R9), độ dài.

### DeliveredNotification (bản giả lập ghi lại)
`{ id, accountId, type, dedupeKey, recipientUserId, channel: 'in_app' | 'email', emailBatch, titleVi, bodyVi,
actions, refs, createdAt, emailResult?: MailDeliveryResult['kind'] }`.

### NotifyDeliverJob (hàng chờ `notify`, scope `tenant`)
`{ event: NotificationEvent }` – qua `defineJobType` (3 lớp kiểm của 003: không trường `content/text/message/
token…`). Tên trường dùng `postTitle`, không dùng `title` của bài đầy đủ.

## 4. Kho tệp

### StorageLocation (hợp kiểu – không chuỗi thô)
| `kind` | Trường | Khóa dựng ra |
|---|---|---|
| `media_original` | `mediaId` | `tenants/{acc}/media/{mediaId}/original` |
| `media_normalized` | `mediaId`, `variant` | `tenants/{acc}/media/{mediaId}/normalized/{variant}` |
| `media_thumb` | `mediaId` | `tenants/{acc}/media/{mediaId}/thumb` |
| `context_file` | `fileId` | `tenants/{acc}/context/{fileId}` |
| `job_tmp` | `jobId`, `name` | `tenants/{acc}/tmp/{jobId}/{name}` |

`{acc}` = `currentAccountId()`; thiếu ngữ cảnh → `TenantContextError`. **Mọi** khóa nằm dưới `tenants/{acc}/`
(hiến pháp nguyên tắc I). `job_tmp` yêu cầu `jobId` = việc đang chạy trong ngữ cảnh; tệp được gắn nhãn đối tượng
`lifecycle=tmp` khi ghi và luật vòng đời lọc theo nhãn này xóa sau 1 ngày (S3 không lọc được tiền tố dạng
`tenants/*/tmp/`). `job_tmp` **không** dùng được với `presignUpload` (chỉ Worker ghi) và `signedUrl('preview')` (giao
diện không xem tệp tạm) → `InvalidRequestError`; `signedUrl('public')` được phép (vd âm thanh tách ra gửi nhà cung cấp chuyển
giọng nói).

### PresignedUpload
`{ url, fields: Record<string,string>, expiresAt, maxBytes, contentType }` – hạn ≤ 15 phút; `contentType` thuộc
danh sách cho phép (`image/jpeg|png|webp|heic`, `video/mp4|quicktime`, `application/pdf` cho `context_file`).

### SignedUrl
`{ url, expiresAt, purpose: 'preview' | 'public' }` – preview ≤ 1 giờ; public ≤ 24 giờ.

### ObjectInfo
`{ exists: false } | { exists: true, bytes, contentType, sha256?: string /* khi yêu cầu hash */, lastModified }`.

## 5. Bảng giả lập – schema `sandbox` (chỉ dev/test)

Mọi bảng chứa dữ liệu tài khoản dùng `tenantTable` (có `account_id NOT NULL`, RLS `tenant_isolation`, chỉ mục
bắt đầu bằng `account_id`). Bảng hệ thống dùng `sharedTable` (chỉ vai trò `system` ghi). Tiền tố tên theo module
chủ. Không bảng nào có khóa ngoại ra ngoài `sandbox` trừ `account_id → account.accounts`.

| Bảng | Loại | Cột chính | Ràng buộc |
|---|---|---|---|
| `fake_scenarios` | tenant | `component` (`platform`\|`ai`\|`notifications`\|`mail`), `target` (vd `connection:{id}`, `*`), `spec` jsonb, `remaining_uses` int null, `created_at` | idx `(account_id, component, target)` |
| `pg_fake_oauth_states` | tenant | `state_hash` bytea, `user_id`, `channel_type`, `expires_at`, `used_at` | unique `state_hash` |
| `pg_fake_selections` | tenant | `id`, `channel_type`, `candidates` jsonb, `expires_at`, `used_at` | |
| `pg_fake_connections` | tenant | `id`, `channel_type`, `external_id`, `display_name`, `token_ciphertext` bytea, `token_expires_at`, `status`, `connected_at`, `disconnected_at` | unique `(account_id, channel_type, external_id) WHERE status <> 'disconnected'` |
| `pg_fake_posts` | tenant | `id`, `connection_id`, `platform_post_id`, `content_hash`, `stored_text_hash` (dấu tính lại trên chữ "nền tảng đổi nhẹ"), `permalink`, `state` (`processing`\|`published`\|`failed`), `processing_id`, `published_at` | idx `(account_id, connection_id, content_hash)`; **không** unique – cố ý để lộ đăng trùng |
| `ai_fake_budgets` | tenant | `cycle_start` date, `used`, `reserved`, `cap`, `soft_limit` (microUsd), `notified_80`, `notified_100` | PK `(account_id, cycle_start)`; `CHECK used >= 0 AND reserved >= 0 AND used + reserved <= cap` |
| `ai_fake_reservations` | tenant | `id`, `cycle_start`, `estimate`, `model_tier`, `task`, `state` (`held`\|`calling`\|`settled`\|`released`), `reserved_at`, `called_at` (null), `closed_at` | idx `(account_id, state, reserved_at)` |
| `ai_fake_cost_ledger` | tenant | như `CostLedgerEntry` | idx `(account_id, cycle_start)` |
| `ai_fake_system_budgets` | shared | `week_start`, `used`, `reserved`, `cap` | PK `week_start`; cùng `CHECK` |
| `ai_fake_system_reservations` / `ai_fake_system_cost_ledger` | shared | như trên + `industry_id` | |
| `ntf_fake_notifications` | tenant | như `DeliveredNotification` | **unique `(account_id, dedupe_key, recipient_user_id, channel)`**; dòng "sự kiện" `ntf_fake_events` unique `(account_id, dedupe_key)` quyết định chống trùng |
| `ntf_fake_events` | tenant | `dedupe_key`, `type`, `refs` jsonb, `created_at` | unique `(account_id, dedupe_key)` |

Không có bảng cho kho tệp (dev dùng MinIO; kiểm thử dùng bản bộ nhớ) và hộp thư đi (dev dùng Mailpit).

Kiểm thử bắt buộc cho các bảng này (khuôn 002): truy cập chéo A/B trên mọi bảng tenant; `pnpm db:check` không báo
bảng có `account_id` thiếu RLS; migration dev không áp ở `APP_ENV=production` (đã có kiểm thử của 002, thêm khẳng
định cho bảng mới).
