# Bốn điểm phụ thuộc: Cổng nền tảng, Cổng AI, Thông báo, Kho tệp (005)

Hợp đồng chi tiết: `specs/005-gateway-contracts-fakes/contracts/`. Tài liệu này hướng dẫn **dùng** hợp đồng từ
module nghiệp vụ, dàn kịch bản cho bản giả lập và cắm bản thật vào bộ kiểm thử hợp đồng.

Quy tắc chung:

- Không thao tác nào nhận `accountId` – tài khoản luôn lấy từ ngữ cảnh (phiên / việc nền).
- Kết quả nghiệp vụ là hợp đóng có `kind` – `switch` hết các nhánh; chỉ lỗi lập trình/hạ tầng mới ném.
- Mỗi thao tác ghi một dòng nhật ký `<component>.<op>` + span OpenTelemetry; không mã quyền, lời nhắc, văn
  bản AI, nội dung bài hay số tiền.
- Chọn bản cài đặt bằng biến môi trường (`PLATFORM_GATEWAY_DRIVER`, `AI_GATEWAY_DRIVER`,
  `NOTIFICATIONS_DRIVER`, `STORAGE_DRIVER`, `MAIL_TRANSPORT`, `FAKE_STATE_STORE`). staging/production từ
  chối khởi động khi có bất kỳ thành phần giả nào.

## 1. Cổng nền tảng (`platform_gateway`) – chỉ `publishing` dùng nhóm thao tác đăng

> Kết nối kênh (OAuth, mã quyền mã hóa, trạng thái dẫn xuất, việc nền, công tắc TikTok): xem [channels.md](./channels.md) (010).

```ts
import {
  PLATFORM_GATEWAY,
  type PlatformGatewayPublicApi,
  applyErrorMapping,
} from '../platform_gateway';

const conn = await gateway.getConnection(connectionId); // null nếu không thuộc tài khoản
const hash = gateway.contentHash(conn.channelType, text); // lưu cùng lượt đăng TRƯỚC khi gửi
const r = await gateway.submit({ connectionId, text, media, contentHash: hash });
switch (r.kind) {
  case 'published':
    /* ghi platformPostId */ break;
  case 'processing':
    /* checkStatus(connectionId, r.processingId) cho tới done/failed */ break;
  case 'failed': {
    const err = applyErrorMapping(r.error, mappingRowOf(r.error)); // bảng ánh xạ của Đăng bài
    if (err.category === 'unknown') {
      // KHÔNG gửi lại ngay: đối soát trước (nếu kênh hỗ trợ).
      if (gateway.capabilities(conn.channelType).reconcile)
        await gateway.reconcile({ connectionId, contentHash: hash, from, to });
      // not_found → được gửi lại; unsupported → "Cần kiểm tra"
    }
  }
}
```

| Kết quả / lỗi                                     | Ý nghĩa                                                                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `failed` + `transient`                            | chắc chắn chưa nhận – tự thử lại (có `retryAfterSec` khi nền tảng báo)                    |
| `failed` + `user_action`                          | người dùng phải xử lý – `remedies` có hành động (`reconnect`, `edit_media`, …)            |
| `failed` + `unknown`                              | không rõ (gồm hết thời gian chờ `submit`) – đối soát trước, không bao giờ gửi lại ngay    |
| `reconcile` `found` / `not_found` / `unsupported` | đã lên / chưa lên / không biết (`capability`, `window_too_large`, `platform_unavailable`) |
| `ConnectionNotFoundError`                         | kết nối không có hoặc của tài khoản khác (không phân biệt)                                |
| `ChannelNotSupportedError`                        | loại kênh chưa có bộ chuyển đổi                                                           |
| `InvalidRequestError`                             | `contentHash` không khớp chữ, `from > to`                                                 |

Kết nối kênh (HTTP, chủ tài khoản): `POST /api/v1/channels/connect` → trang ủy quyền → `GET
/api/v1/channels/callback/:type` → `302 …/channels/connect?selection=…` → `GET /api/v1/channels/selections/:id`
→ `POST /api/v1/channels`. Liệt kê `GET /api/v1/channels` (chủ + CTV). Không phản hồi nào có mã quyền.

**Thêm nền tảng** = thêm bộ chuyển đổi `PlatformAdapter` (thư mục riêng trong `internal/adapters/`) + một
dòng `registerAdapter(...)` trong `internal/adapters/registry.ts`. Không sửa `gateway.service.ts` hay luồng
đăng. Bộ hợp đồng adapter tự chạy cho mọi bộ chuyển đổi đã đăng ký.

## 2. Cổng AI (`ai_gateway`)

```ts
import { AI_GATEWAY, AiError, type AiGatewayPublicApi } from '../ai_gateway';

try {
  const r = await ai.generate({
    task: 'post_generation',
    prompt: { system, businessProfile, weeklyTrends, delta },
    maxOutputTokens: 800,
  });
} catch (err) {
  if (err instanceof AiError && err.code === 'AI_BUDGET_EXHAUSTED')
    return noRetry('AI_BUDGET_EXHAUSTED'); // việc nền
  throw err; // AI_PROVIDER_UNAVAILABLE → để hàng chờ thử lại
}
const usage = await ai.getUsage(); // { percent, state, nextCycleStartsAt } – KHÔNG số tiền
```

Bên gọi không chọn mô hình (Cổng chọn theo loại việc + ngưỡng 2 USD). Trả dần: `generateStream(req)` →
`for await (const { delta } of stream)`, `stream.cancel()`, `await stream.result`. Xu hướng (không thuộc tài
khoản): `ai.system.generate({ task: 'trend_summary', industryId, … })` – chỉ ngoài ngữ cảnh tài khoản.

| Lỗi                          | Khi nào                         | Tự thử lại?   |
| ---------------------------- | ------------------------------- | ------------- |
| `AI_BUDGET_EXHAUSTED`        | không giữ chỗ được              | Không         |
| `AI_PROVIDER_UNAVAILABLE`    | chính + dự phòng đều lỗi        | Có (việc nền) |
| `AI_INVALID_REQUEST`         | sai khuôn / quá giới hạn        | Không         |
| `AI_SYSTEM_BUDGET_EXHAUSTED` | hết trần tuần của việc hệ thống | Không         |

## 3. Thông báo (`notifications`)

```ts
import { NOTIFICATIONS, type NotificationsPublicApi } from '../notifications';

await tenantTx(async (tx) => {
  // … ghi dữ liệu nghiệp vụ …
  await notifications.emit(tx, {
    type: 'post_returned',
    refs: { postId, postVersion, authorUserId },
    params: { postTitle },
  });
}); // giao dịch hủy → không có thông báo
```

Danh mục đóng ở `@app/shared/notifications` (`NOTIFICATION_TYPES`, `NOTIFICATION_RULES`). Bên phát không chọn
người nhận, kênh hay khóa chống trùng. Sự kiện có số tiền / mã quyền / nội dung bài →
`NotificationEventInvalidError`. Module `account` phát bằng `enqueueRegistered(tx, NOTIFY_DELIVER_JOB, { event })`
(`modules/queue/enqueue-registered.ts` – chỉ `account` được nhập).

## 4. Kho tệp (`core/storage`) – chỉ `media`, `context`, `account`

```ts
import { loc, OBJECT_STORAGE, type ObjectStorage } from '../../core/storage';

const up = await storage.presignUpload(loc.mediaOriginal(mediaId), {
  contentType: 'image/jpeg',
  maxBytes: 20_000_000,
});
// trình duyệt POST multipart tới up.url với up.fields + file
const info = await storage.stat(loc.mediaOriginal(mediaId), { hash: true }); // luôn xác nhận bằng stat
const url = await storage.signedUrl(loc.mediaThumb(mediaId), 'preview'); // ≤ 1 giờ; 'public' ≤ 24 giờ
await storage.write(loc.jobTmp('audio.mp3'), buffer, { contentType: 'audio/mpeg' }); // chỉ trong việc nền
```

Mọi khóa nằm dưới `tenants/{accountId}/`; tệp tạm `tenants/{accountId}/tmp/{jobId}/…` có nhãn `lifecycle=tmp`
(xóa sau 1 ngày), không có đường dẫn tải lên / xem trước.

## 5. Dàn kịch bản cho bản giả lập

**API lập trình (kiểm thử):**

```ts
await fakePlatform('memory').script(`connection:${id}`, [
  { submit: 'timeout_after_publish' },
  { alterStoredText: 'nfd' },
]);
await fakePlatform('memory').publishedCount(hash);
await fakeAi('memory', bundle.store).setBudget({ used: 3_999_000 });
await fakeAi('memory', bundle.store).script([{ fail: 'error' }], 'primary');
```

**HTTP (dev/test, phiên đăng nhập – route không có ở staging/production):**

| Route                                                                           | Dùng để                                                                                                                                              |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /api/v1/dev/fakes/scenarios` `{ component, target, spec, remainingUses? }` | dàn bước (`platform`: `FakeStep` hoặc `{ pages }` với `target=oauth`; `ai`: `{ latencyMs, firstTokenMs, fail, outputTokens, actualCostMultiplier }`) |
| `GET/DELETE /api/v1/dev/fakes/scenarios[/:id]`                                  | xem / xóa kịch bản                                                                                                                                   |
| `GET /api/v1/dev/fakes/platform/posts`                                          | bài giả đã lên + `publishedCount` theo dấu                                                                                                           |
| `GET/PUT /api/v1/dev/fakes/ai/budget`                                           | ngân sách giả (CÓ số tiền – chỉ dev)                                                                                                                 |
| `POST /api/v1/dev/fakes/ai/generate` `{ task, delta }`                          | gọi Cổng AI thật (đủ trình tự)                                                                                                                       |
| `POST /api/v1/dev/fakes/storage/upload-url`                                     | đường dẫn tải lên cho `media_original` mới                                                                                                           |
| `GET /api/v1/dev/fakes/notifications`                                           | thông báo đã ghi                                                                                                                                     |

Chế độ trạng thái: `FAKE_STATE_STORE=memory` (mỗi tiến trình riêng – chỉ kiểm thử) hoặc `sandbox` (bảng
`sandbox.*` – API + Worker thấy chung, dùng ở docker compose).

## 6. Cắm bản thật vào bộ kiểm thử hợp đồng (SC-010)

Bộ hợp đồng ở `test/contracts/<component>/*.contract.ts` nhận bản cài đặt + harness. Bản thật chỉ thêm
**một tệp** `*.contract.spec.ts` gọi cùng hàm:

```ts
// test/contracts/platform/platform.real.contract.spec.ts (WBS 2.3)
describePlatformAdapterContract(() => new GraphApiAdapter(...), () => graphHarness);
describePlatformGatewayContract(() => graphHarness);
```

| Thành phần    | Hàm hợp đồng                                                         | Chạy bằng                                      |
| ------------- | -------------------------------------------------------------------- | ---------------------------------------------- |
| Cổng nền tảng | `describePlatformAdapterContract`, `describePlatformGatewayContract` | `pnpm test` (memory), `pnpm test:db` (sandbox) |
| Cổng AI       | `describeAiGatewayContract`                                          | `pnpm test`, `pnpm test:db`                    |
| Thông báo     | `describeNotificationsContract`                                      | `pnpm test`, `pnpm test:db`                    |
| Email         | `describeMailerContract`                                             | `pnpm test`, `pnpm test:infra` (Mailpit)       |
| Kho tệp       | `describeObjectStorageContract`                                      | `pnpm test`, `pnpm test:infra` (MinIO)         |

`pnpm test:infra` cần `docker compose up -d minio minio-init mailpit`. Luồng đầy đủ không kết nối ra ngoài:
`pnpm --filter @app/server test:e2e-fakes` (cần CSDL kiểm thử – `TEST_DATABASE_ADMIN_URL`).
