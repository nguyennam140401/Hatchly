# Research – 005 Khung giao diện công khai + bản giả lập

Mọi quyết định dưới đây dựa trên mã hiện có ở nhánh `dev` (001–004 đã hợp nhất: lõi CSDL/RLS, hàng chờ
pg-boss, xác thực + `core/mail`, schema `sandbox` dev) và tài liệu `TaiLieuDacTa/`. Không còn mục
NEEDS CLARIFICATION.

> **Điều kiện tiên quyết**: nhánh `impl/005-gateway-contracts-fakes` tách từ `f60cc56`, trước khi 003 và
> 004 vào `dev`. Việc đầu tiên của implement là `git merge dev` vào nhánh này (giống cách 004 đã làm).

---

## R1. Hình dạng hợp đồng: interface TypeScript + kết quả dạng hợp (discriminated union)

- **Decision**: Mỗi hợp đồng là một `interface` TypeScript trong `public-api.ts` của module (hoặc
  `core/storage/storage.ts`), kèm token NestJS (`PLATFORM_GATEWAY`, `AI_GATEWAY`, `NOTIFICATIONS`,
  `OBJECT_STORAGE`). Kết quả nghiệp vụ là **hợp đóng có trường `kind`** (vd `{ kind: 'published' } |
  { kind: 'processing' } | { kind: 'failed' }`); chỉ lỗi lập trình/hạ tầng mới ném ngoại lệ. Kiểu dữ
  liệu đi qua ranh giới được định nghĩa bằng Zod khi cần kiểm lúc chạy (sự kiện thông báo, dữ liệu
  việc), còn lại là kiểu TS thuần.
- **Rationale**: Hợp đóng + `switch` có `never` buộc bên gọi xử lý mọi nhánh (nguyên tắc II: không bỏ
  sót *không xác định*); bộ kiểm thử hợp đồng kiểm được "giá trị ngoài danh sách" (US2-AS1). Theo đúng
  khuôn đã dùng ở 003 (`EnqueueResult`, `ChangeResult`).
- **Alternatives**: ném lỗi có mã (dễ quên bắt nhánh *unknown*); lớp trừu tượng NestJS (ràng buộc khung
  vào hợp đồng, khó dùng trong kiểm thử thuần).

## R2. Bộ chuyển đổi nền tảng: danh mục theo loại kênh + "hợp đồng hai tầng"

- **Decision**:
  - Tầng trong (`internal/adapters/`): `PlatformAdapter` với đúng 7 thao tác ADR-05 (`checkAccount`,
    `mediaRules`, `submit`, `checkStatus`, `reconcile`, `classifyError`, `refreshToken`) + hàm thuần
    `contentHash` (FR-014a) + `capabilities` (FR-012). Bộ chuyển đổi nhận **mã quyền đã giải mã** từ
    `CredentialVault` nội bộ, không bao giờ từ bên gọi.
  - Tầng công khai (`PlatformGatewayPublicApi`): cùng 7 thao tác nhưng nhận **`connectionId`**; cổng tự
    tra kết nối → loại kênh → bộ chuyển đổi trong `AdapterRegistry` → giải mã quyền → gọi. Loại kênh
    chưa đăng ký → `ChannelNotSupportedError` (US2-AS3).
  - Đăng ký bộ chuyển đổi bằng `registerAdapter(channelType, factory)` trong một tệp ghép duy nhất
    `internal/adapters/registry.ts`; thêm kênh = thêm thư mục bộ chuyển đổi + một dòng đăng ký (SC-002).
- **Rationale**: Bên Đăng bài không thấy mã quyền (FR-011, nguyên tắc VII), không biết tên nền tảng
  (rẽ nhánh theo `capabilities`). Bộ kiểm thử hợp đồng chạy cả hai tầng: tầng adapter (mọi adapter
  đăng ký) và tầng cổng (qua kết nối giả).
- **Alternatives**: để Đăng bài gọi thẳng adapter (lộ mã quyền); một lớp cơ sở trừu tượng (khó thêm
  năng lực khác nhau như Zalo không đối soát).

## R3. Loại kênh và năng lực

- **Decision**: `ChannelType = 'facebook_page' | 'instagram' | 'zalo_oa' | 'test_channel'`
  (`test_channel` chỉ đăng ký khi `APP_ENV ∈ {development, test}`). Năng lực mặc định của bản giả lập:

  | Kênh | reconcile | asyncProcessing | tokenRefresh | reportsQuota | maxReconcileWindow |
  |---|---|---|---|---|---|
  | facebook_page | có | không | có | có | 7 ngày |
  | instagram | có | **có** | có | có | 7 ngày |
  | zalo_oa | **không** (đến POC-2) | không | có | không | – |
  | test_channel (kênh thứ tư US2) | không | không | không | không | – |

  `test_channel` còn có quy tắc media khác (chỉ ảnh PNG, tối đa 1) để chứng minh SC-002.
- **Rationale**: Bảng ADD Đăng bài mục 3; giả định POC-2 ghi ở spec Assumptions; năng lực ghi đè được
  bằng cấu hình bản giả lập (kịch bản) khi có kết quả POC.

## R4. Dấu nội dung (FR-014a)

- **Decision**: `contentHash(channelType, text): string` = `"ch1:" + sha256_hex(normalize(text))`.
  `normalize`: Unicode NFC → thay mọi URL (`https?://\S+`) bằng `<url>` → bỏ ký tự vô hình (ZWSP,
  ZWJ, BOM, NBSP→space) → gộp mọi khoảng trắng liên tiếp thành 1 dấu cách → trim. **Không** hạ chữ
  thường (nội dung khác hoa/thường là nội dung khác). Chuẩn hóa dùng chung trong
  `internal/adapters/content-hash.ts`; adapter có thể thêm bước riêng (vd Zalo bỏ hashtag cuối) nhưng
  phải giữ tiền tố phiên bản `ch1:`. Media không vào dấu (đối soát so chữ; ảnh có thể bị nén lại).
- **Rationale**: Nền tảng rút gọn liên kết, đổi khoảng trắng, đổi dạng Unicode (Edge Cases); tiền tố
  phiên bản cho phép đổi thuật toán mà không so nhầm dấu cũ.
- **Alternatives**: băm cả media (dễ lệch → *không tìm thấy* → gửi lại = đăng trùng); so chuỗi mờ
  (không tất định, khó kiểm thử).

## R5. Phân loại lỗi + ánh xạ đè (FR-015)

- **Decision**: Mỗi adapter có bảng mặc định `Record<rawCode, {category, messageVi, remedies[]}>`; mã
  ngoài bảng → `unknown` với thông điệp chung "Chưa rõ bài đã lên hay chưa…" và cách khắc phục "Kiểm tra
  trên trang". Mã gốc được **lọc** trước khi ra khỏi cổng: chỉ giữ `[A-Za-z0-9_.:-]`, cắt ≤ 64 ký tự.
  Hàm thuần công khai `applyErrorMapping(defaultClassified, mappingRow | undefined)` xuất từ
  `platform_gateway` (Đăng bài gọi, cổng không đọc bảng của Đăng bài).
- **Rationale**: Clarifications 2026-11-08 phương án C; giữ chiều phụ thuộc publishing → platform_gateway.

## R6. Luồng kết nối kênh (FR-021, FR-022)

- **Decision**: Thao tác công khai: `startConnect`, `handleCallback`, `saveConnection`,
  `listConnections`, `disconnect`. Mã trạng thái chống giả mạo = 32 byte ngẫu nhiên, lưu dạng SHA-256
  cùng `account_id`, `user_id`, `channelType`, hạn 10 phút, dùng một lần. Lượt gọi lại tạo một
  **phiên chọn** (`selectionId`, hạn 10 phút) chứa danh sách Page/tài khoản kèm kết quả `checkAccount`;
  `saveConnection(selectionId, externalId)` lưu. Trùng `(account_id, channel_type, external_id)` còn
  hiệu lực → trả kết nối có sẵn. Điểm cuối HTTP thuộc `platform_gateway`; quyền `channel.manage` cho
  bắt đầu/lưu/ngắt, `status.view` cho liệt kê (cả hai đã có trong `PERMISSIONS`).
  Bản giả lập: trang ủy quyền giả `GET /dev/fake-oauth/:channelType/authorize` (chỉ dev/test) với nút
  "Đồng ý"/"Hủy" và danh sách Page giả cấu hình qua kịch bản. Mã quyền giả là chuỗi ngẫu nhiên, đi qua
  `CredentialVault` giả (mã hóa AES-GCM bằng khóa dev cố định) – cùng điểm bảo vệ như bản thật.
- **Rationale**: OAuth thật + `channel_connections` + KMS là WBS 2.2; hợp đồng chốt sớm để FE-1 làm màn
  hình kết nối. Lưu trạng thái giả ở `sandbox` (R10) để API và luồng gọi lại thấy chung.

## R7. Cổng AI: trình tự, ước tính, ngân sách

- **Decision**:
  - Công khai: `generate(request)` → `AiResult` (một lần), `generateStream(request)` → `AiStream`
    (async iterable các đoạn + `result` Promise + `cancel()`), `transcribe(request)`, `getUsage()` (chỉ
    `%`), và thao tác hệ thống `system.generate(request & { industryId })` chỉ chạy trong `systemTx`
    ngữ cảnh hệ thống (ném `SystemContextRequiredError` nếu có `accountId`). Thao tác nội bộ hỗ trợ
    `support.getBudgetDetail()` (có số tiền) không xuất cho module nghiệp vụ.
  - Nội bộ: `AiProviderAdapter` (`countInputTokens`, `complete`, `stream`, `transcribe`) – bọc SDK;
    `BudgetStore` (`reserve`, `settle`, `release`, `usage`, `releaseStale`) cho tài khoản và
    `SystemBudgetStore` cùng hình dạng theo tuần; `PriceBook` (`priceFor(modelTier, at)`).
  - Ước tính: `ceil(inTok × inPrice + maxOutTok × outPrice)` micro-USD (giá lưu là micro-USD / 1 triệu
    token → dùng `bigint` khi nhân rồi chia, làm tròn lên). STT: `ceil(min(durationSec, 300)/60 ×
    pricePerMin)`.
  - Chọn mô hình: bảng ADD Cổng AI mục 5 – `post_generation`, `topic_suggestion`: `used + reserved <
    soft_limit` → `default`, ngược lại `cheap`; `image_labeling`, `video_labeling`: `cheap_vision`;
    `trend_summary`: `cheap`; `transcription`: `stt`. Mô hình chọn **trước** giữ chỗ (ước tính theo giá
    mô hình đó), quyết định dựa trên trạng thái đọc trong cùng câu lệnh giữ chỗ (R8).
  - Dự phòng: nhà cung cấp chính lỗi/hết thời gian → `release` → thử dự phòng đúng 1 lần với giữ chỗ
    mới → lỗi nữa → `AiProviderUnavailable`.
  - Đánh dấu "đang gọi" (nguyên tắc III – mọi lời gọi vào sổ): **ngay trước** mỗi lần gọi nhà cung cấp (chính lẫn dự
    phòng) Cổng AI gọi `markCalling(reservationId)` – `UPDATE … SET state = 'calling', called_at = now() WHERE id = $1 AND
    state = 'held'`. Nhờ vậy giữ chỗ treo phân biệt được "chưa tốn tiền" (`held`) với "có thể đã tốn tiền" (`calling`), giống
    trạng thái "Đã gửi, chờ phản hồi" của luồng đăng bài. Chi phí thêm: 1 câu lệnh mỗi lời gọi; yêu cầu ≤ 50 ms chỉ áp cho
    `reserve`.
  - Phần còn hở có chủ đích: nhà cung cấp hết thời gian nhưng vẫn tính tiền phía họ → hiến pháp III bắt trả giữ chỗ, nên
    chênh lệch không vào sổ; được bắt bởi cảnh báo bắt buộc "sổ chi phí AI lệch hóa đơn nhà cung cấp > 5%" (nguyên tắc VIII).
  - Trả dần bị hủy: quyết toán theo token đầu ra đã nhận (nhà cung cấp giả báo; bản thật lấy từ sự kiện
    usage, thiếu thì đếm chữ đã nhận ÷ 4 làm tròn lên).
  - Kẹp trần (Clarifications 2026-11-11): `used = min(used + actual, cap)` sau khi `reserved -= est`;
    `actual > est` → dòng sổ có `anomaly = 'over_estimate'`, `over_cap_micro_usd` nếu bị kẹp; ghi nhật ký
    cảnh báo `ai.cost_anomaly` (cảnh báo nội bộ – WBS 1.6 nối vào Grafana).
  - Ngưỡng 80%/100% (nguyên tắc IV – sự kiện cùng giao dịch): `settle(…, hooks?: { onCrossed?: (tx, crossed) =>
    Promise<void> })`. Trong **một** giao dịch: trừ giữ chỗ + cộng chi phí (kẹp trần) → bật `notified_80/100` bằng cập
    nhật có điều kiện `= false … RETURNING` (chỉ cờ thực sự đổi mới vào `crossed`) → ghi sổ → chuyển giữ chỗ `held →
    settled` → `crossed` không rỗng thì `onCrossed(tx, crossed)` → Cổng AI gọi `notifications.emit(tx, ai_usage_80 |
    ai_usage_100)`. Bước nào lỗi → hủy cả giao dịch (không cờ, không sổ, không sự kiện; giữ chỗ vẫn `held`) → Cổng AI thử
    `settle` lại 1 lần → vẫn lỗi: nhật ký cảnh báo `ai.settle_failed`, giữ chỗ còn ở `calling` nên sau 15 phút
    `releaseStale` **quyết toán theo ước tính** (R8) – không mất sổ.
    Khóa chống trùng theo chu kỳ (R9) là lớp chặn thứ hai.
    - **Alternatives**: `settle` commit rồi mới `emit` ở giao dịch khác (tiến trình chết giữa hai bước → cờ đã bật, sự kiện
      không bao giờ tạo → mất cảnh báo 80% vĩnh viễn – bị loại); `emit` trước rồi `settle` (báo khi chi phí chưa ghi, có thể
      báo trùng – bị loại).
  - Bảng giá: `PriceBook` đọc qua `PriceSource` được tiêm vào (bản giả lập: JSON; bản thật WBS 3.1: bảng `model_prices`),
    để đổi giá không cần phát hành (hiến pháp III).
- **Rationale**: ADD Cổng AI mục 2–7, nguyên tắc III; kiểu dữ liệu nhà cung cấp không ra khỏi
  `internal/providers/` (FR-008).
- **Alternatives**: để bên gọi chọn mô hình (vi phạm FR-033); quyết toán bằng ước tính (lệch hóa đơn).

## R8. Giữ chỗ nguyên tử ở bản giả lập (2 chế độ – FR-009, FR-036)

- **Decision**:
  - *Bộ nhớ*: `MemoryBudgetStore` dùng `Map` theo `(scope, key)`. `reserve`, `markCalling`, `release` đồng bộ trong một
    lượt vòng lặp sự kiện (không có `await` giữa đọc và ghi) → nguyên tử trong tiến trình. `settle` và `releaseStale` có
    `await onCrossed` nên chạy **tuần tự theo khóa ngân sách** (khóa tuần tự trong bộ nhớ `Map<key, Promise>`, tương đương
    khóa dòng của CSDL): đọc trạng thái hiện tại, tính `crossed` → `await onCrossed(memoryTx(), crossed)` (ném → chưa ghi gì) →
    ghi **đồng bộ** lên giá trị *hiện tại* (không dùng bản sao). An toàn vì trong lúc chờ, `reserve` khác chỉ thấy `reserved`
    cao hơn thực tế → chặn sớm hơn, không vượt trần; `settle` tuần tự → không mất cập nhật. Loại phương án "ghi trước, lỗi thì
    bù ngược": `reserve` khác có thể lấy phần chỗ vừa trả, bù ngược làm `used + reserved` vượt trần. Kiểm thử đồng thời
    bằng `Promise.all` 20+ lời gọi với nhà cung cấp giả có độ trễ ngẫu nhiên tất định (hạt giống).
  - *CSDL (`sandbox`)*: đúng câu lệnh của bản thật – `UPDATE … SET reserved = reserved + $est WHERE
    account_id = current_account_id() AND cycle_start = $c AND used + reserved + $est <= cap RETURNING
    used, reserved, cap, soft_limit` + `CHECK (used + reserved <= cap)` làm chốt cuối; giữ chỗ ghi một dòng
    `reservations` trong cùng giao dịch `tenantTx`. Ngân sách hệ thống dùng `systemTx`.
  - Giữ chỗ treo: `releaseStale(olderThan = 15 phút, hooks?)` xử lý hai nhánh – `held` (chưa gọi) → `released`;
    `calling` (đã gọi, chưa quyết toán) → quyết toán theo **ước tính** (kẹp trần, có thể phát 80/100% qua `onCrossed`),
    dòng sổ `anomaly = 'unsettled'`, nhật ký cảnh báo `ai.unsettled_reservation`. Ước tính là chi phí tối đa nên tính dư,
    không bao giờ tính thiếu. Chạy bằng việc định kỳ `ai_gateway.release_stale` trên hàng
    chờ `scheduled` mỗi phút (dùng `defineSchedule` của 003) cho chế độ `sandbox`; chế độ bộ nhớ gọi trực
    tiếp trong kiểm thử.
- **Rationale**: Bản giả lập CSDL chính là bản nháp của WBS 3.1 → bộ kiểm thử hợp đồng đồng thời có ý
  nghĩa thật (SC-003); bảng thật `ai_gateway.ai_budgets` chỉ khác schema.

## R9. Thông báo: danh mục đóng, quy tắc người nhận, khóa chống trùng

- **Decision**:
  - Danh mục (`NOTIFICATION_TYPES`) đặt ở `packages/shared/src/modules/notifications/events.ts` (Zod +
    `as const`), dùng chung bởi `notifications` và `account` (FR-046). Mỗi loại khai báo: `refs` (khuôn
    Zod của tham chiếu), `params` (tham số hiển thị có giới hạn), `recipients`, `channels`,
    `emailBatch: 'batch_10m' | 'immediate'`, `dedupeKey(refs) → string`, `actions` mặc định.
  - Phát: `notifications.emit(tx, event)` – **bắt buộc truyền `tx`** (giao dịch nghiệp vụ hiện tại, kiểu
    `Db` của 002) → kiểm Zod + kiểm trường bị cấm → `enqueue(tx, notifyDeliverJob, …)` (003). Không có
    `tx` thì không biên dịch được (FR-042). Khuôn sự kiện (Zod) ở shared; loại việc
    `notifications.deliver` khai báo ở `modules/notifications/jobs.ts`. Module `account` (không được phụ
    thuộc `notifications`) phát theo cách ở R9a.
  - Người nhận: `owner` (chủ), `post_author` (cộng tác viên soạn bài – từ `refs.authorUserId`),
    `actor_target` (người tạo – `refs.requestedByUserId`). Tra thành viên qua phương thức mới của
    `AccountPublicApi.listActiveMembers()` (tenant context). Người không còn là thành viên → bỏ qua.
  - Khóa chống trùng: dựng bởi Thông báo; duy nhất `(account_id, dedupe_key)` vĩnh viễn (bản giả lập:
    chỉ mục duy nhất ở `sandbox`; bản thật WBS 4.3 ở `notifications.notifications`). Ngoài ra việc `notify`
    dùng `dedupeKey: 'notify:' + key` để không tạo việc thừa khi còn chờ.
  - Trường bị cấm (FR-044): kiểm hai lớp – (1) khuôn Zod `strictObject` chỉ có trường khai báo; (2) bộ
    quét giá trị: tên trường chứa `amount|usd|cost|price|token|password|secret|content|caption|body` bị
    từ chối, chuỗi khớp mẫu số tiền (`\$|USD|micro`) trong `params` bị từ chối. Tên ngắn của bài
    `postTitle` ≤ 60 ký tự.
- **Rationale**: Bảng UI/UX mục 8; Clarifications 2026-11-11 (khóa do Thông báo dựng).

### R9b. Chế độ bộ nhớ: vật thế chỗ giao dịch + hàng chờ trong bộ nhớ (FR-009)

- **Decision**: Hợp đồng `emit(tx: Db, event)` giữ nguyên ngữ nghĩa thật. Ở chế độ `memory` (không CSDL):
  - `S/dev/memory-tx.ts` xuất `memoryTx(): Db` – đối tượng đánh dấu, đúng kiểu để truyền, **ném lỗi** nếu bị dùng để
    chạy SQL (bắt nhầm lẫn chế độ). Đặt ở `S/dev` (không ở `notifications/internal/fake`) vì `internal/fake/**` của mọi
    module được nhập `S/dev` (R17) còn `ai_gateway` không được nhập nội bộ của `notifications`. Cổng AI ở chế độ `memory` truyền `memoryTx()` vào `onCrossed` (R7).
  - `emit` ở chế độ `memory` là một cài đặt riêng trong `notifications/internal/fake/memory-emitter.ts` (mô-đun ghép chọn
    theo `FAKE_STATE_STORE`; `internal/emit.ts` của bản thật không biết đến chế độ này): dùng chung hàm `prepareEvent` (kiểm
    khuôn Zod + trường bị cấm + dựng khóa) y như bản thật → đưa sự kiện vào hàng chờ trong bộ nhớ (khóa `notify:` +
    `dedupeKey` đang chờ → `duplicate_pending`).
  - Harness bộ hợp đồng có `flush()`: `memory` → chạy `deliver.handler` cho các sự kiện đang chờ; `sandbox` → lấy việc
    `notifications.deliver` đang chờ trong pg-boss bằng **runtime Worker thật trong tiến trình kiểm thử** (khởi động như kiểm
    thử 003 – `test/queue/helpers/worker-child.ts`, rồi `waitFor` hết việc), không gọi thẳng bộ xử lý. Cùng một bộ
    kiểm thử chạy cho cả hai chế độ.
  - Ca phụ thuộc giao dịch thật (giao dịch hủy sau `emit` → 0 việc, 0 thông báo; `settle` hủy → không cờ, không sự kiện)
    **chỉ** kiểm ở `sandbox` (`pnpm test:db`).
- **Rationale**: Giữ `pnpm test` nhanh, không cần Docker cho phần lớn kiểm thử Thông báo (người nhận, khóa, trường bị cấm,
  chạy lại hai lần) mà không làm yếu hợp đồng thật.
- **Alternatives**: bỏ chế độ `memory` cho Thông báo, mọi kiểm thử sang `test:db` (đơn giản hơn nhưng `pnpm test` không còn
  kiểm Thông báo, vòng sửa–chạy chậm – bị loại, quyết định 2026-11-11).

### R9a. Lối phát thông báo cho `account` không tạo vòng phụ thuộc

- **Decision**: Thêm vào `modules/queue` một khả năng tổng quát, không biết gì về thông báo:
  `enqueueRegistered(tx, typeName, payload, options)` – tạo việc theo **tên** loại việc đã đăng ký trong
  tiến trình (ném `QUEUE_JOB_TYPE_UNKNOWN` nếu chưa đăng ký). Shared (`@app/shared/notifications`) xuất
  `NOTIFY_DELIVER_JOB = 'notifications.deliver'`, khuôn `NotifyEventSchema` và kiểu sự kiện. `account`
  gọi `enqueueRegistered(tx, NOTIFY_DELIVER_JOB, NotifyEventSchema.parse(event))`. Module `notifications`
  khai báo loại việc thật bằng `defineJobType` (cùng khuôn) và xử lý. Quy tắc ranh giới mới: chỉ
  `account` được dùng `enqueueRegistered` (tránh lách kiểm tra phụ thuộc chung).
- **Rationale**: Clarifications 2026-11-08 phương án A; tránh vòng `account ↔ notifications`; khuôn sự
  kiện chỉ có một nguồn; Worker kiểm cùng khuôn + trường bị cấm khi xử lý.
- **Alternatives**: `account` phụ thuộc `notifications` (vòng); bảng outbox riêng (thêm thành phần).

## R10. Trạng thái giả lập dùng chung: schema `sandbox` (FR-009)

- **Decision**: Bảng giả lập khai báo trong `apps/server/src/dev/sandbox/schema.ts` (mã chạy được trong
  `dist`, khác `test/db/sandbox` hiện chỉ cho kiểm thử). `drizzle.dev.config.ts` nhận cả hai tệp; migration
  vào `drizzle/migrations-dev` (đã chỉ áp khi `APP_ENV ∈ {development, test}` – `migrate.ts`). Tên bảng có
  tiền tố module chủ: `pg_fake_*`, `ai_fake_*`, `ntf_fake_*`, `fake_scenarios`. Mỗi bản giả lập có một cài
  đặt `Store` ×2 (`memory`, `sandbox`) cùng giao diện; bộ kiểm thử hợp đồng chạy cả hai (chế độ `sandbox`
  trong `pnpm test:db`).
  Quy tắc ranh giới: chỉ `modules/<m>/internal/fake/**` và `src/dev/**` được nhập `src/dev/sandbox`; mã
  production (`moduleSchema('sandbox')` đã ném lỗi khi `APP_ENV ∉ {development,test}`) – thêm kiểm khởi
  động: `FAKE_STATE_STORE=sandbox` mà schema không tồn tại → dừng với thông báo "chạy pnpm db:setup".
- **Rationale**: Clarifications 2026-11-08 (Q2); tận dụng cơ chế migration dev có sẵn của 002.

## R11. Chọn bản cài đặt theo cấu hình + chặn ở môi trường chính thức (FR-005, SC-006)

- **Decision**: Biến môi trường mới (đọc ở `AppConfigSchema`, dùng chung API/Worker):

  | Biến | Giá trị | Mặc định dev |
  |---|---|---|
  | `PLATFORM_GATEWAY_DRIVER` | `fake` (bản thật thêm ở WBS 2.3) | `fake` |
  | `AI_GATEWAY_DRIVER` | `fake` (bản thật WBS 3.1) | `fake` |
  | `NOTIFICATIONS_DRIVER` | `fake` (bản thật WBS 4.3) | `fake` |
  | `STORAGE_DRIVER` | `memory` \| `s3` | `s3` (compose), `memory` (kiểm thử) |
  | `MAIL_TRANSPORT` | `memory` \| `smtp` (có sẵn, chuyển từ `AuthConfig` sang cấu hình chung) | `smtp` |
  | `FAKE_STATE_STORE` | `memory` \| `sandbox` | `sandbox` (compose) |
  | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`*, `S3_SECRET_ACCESS_KEY`*, `S3_FORCE_PATH_STYLE`, `S3_PUBLIC_ENDPOINT` | | MinIO |
  | `AI_SYSTEM_WEEKLY_CAP_MICRO_USD` | số nguyên | `2000000` |

  (*bí mật – `secret()`). Hàm `assertNoFakesInProduction(config)` gọi ở `loadConfig`: khi `APP_ENV ∈
  {staging, production}` mà có biến nào là `fake`/`memory` → `ConfigError` liệt kê **từng** thành phần
  (US6-AS2). Bản giả lập và endpoint quản trị giả lập chỉ được dùng khi `APP_ENV ∈ {development, test}`
  (staging phải giống production; schema `sandbox` cũng chỉ có ở dev/test). Hệ quả: production/staging
  chưa khởi động được tới khi WBS 2.3/3.1/4.3 có bản thật – đúng ý đồ.
  Nhật ký khởi động: `gateways.selected { platform: 'fake', ai: 'fake', notifications: 'fake', storage:
  's3', mail: 'smtp', fakeState: 'sandbox' }` ở cả API và Worker (US6-AS1).
- **Rationale**: Giống cách 004 xử lý `MAIL_TRANSPORT=memory`; một nguồn cấu hình cho hai đơn vị.

## R12. Endpoint quản trị giả lập (FR-006)

- **Decision**: `DevFakesController` ở `apps/server/src/dev/fakes.controller.ts`, chỉ được thêm vào
  `ApiAppModule.controllers` khi `APP_ENV ∈ {development, test}` (khuôn của `DiagnosticsController`).
  Đường dẫn `/dev/fakes/...`; khai báo truy cập `@CustomerAccess('status.view')` – kịch bản luôn gắn tài
  khoản trong phiên (không nhận mã tài khoản từ đường dẫn – nguyên tắc I). Đọc/ghi `sandbox.fake_scenarios`.
  Kiểm thử: dựng app với `APP_ENV=production` (cấu hình thật giả định) → `GET /dev/fakes/scenarios` = 404.
- **Rationale**: Clarifications 2026-11-11 Q2.

## R13. Kho tệp: S3 chuẩn + đường dẫn tải lên dạng POST policy

- **Decision**:
  - Vị trí: hạ tầng dùng chung `apps/server/src/core/storage/` (không phải module nghiệp vụ – spec
    Assumptions). Giao diện `ObjectStorage` + lớp dựng vị trí `StorageLocation` (hợp kiểu, không có chuỗi
    thô): `{ kind: 'media_original', mediaId }`, `{ kind: 'media_normalized', mediaId, variant }`,
    `{ kind: 'media_thumb', mediaId }`, `{ kind: 'context_file', fileId }`, `{ kind: 'job_tmp', jobId, name }`.
    Mã tài khoản lấy từ `currentAccountId()`; `job_tmp` cần ngữ cảnh việc (`jobId` trùng việc đang chạy). **Mọi** khóa,
    kể cả tệp tạm, nằm dưới `tenants/{acc}/` – tệp tạm là `tenants/{acc}/tmp/{jobId}/{name}` (hiến pháp nguyên tắc I:
    tệp media và đường dẫn ký sẵn chỉ trong tiền tố của tài khoản; bố cục `tmp/{jobId}/` cũ của Kiến trúc dữ liệu bị thay).
    Mã đối tượng phải là UUID; `name`/`variant` khớp `^[a-z0-9_-]{1,40}(\.[a-z0-9]{1,8})?$`.
  - Quy tắc ranh giới: chỉ `media`, `context`, `account` và tầng ghép được nhập `core/storage`.
  - Tải lên: **presigned POST** (`@aws-sdk/s3-presigned-post`) với điều kiện `key` chính xác,
    `Content-Type` chính xác, `content-length-range [1, maxBytes]`, hạn ≤ 900 giây – PUT ký sẵn không
    ràng buộc được kích thước. Xem trước/công khai: presigned GET (`@aws-sdk/s3-request-presigner`), hạn
    ≤ 3600 / ≤ 86400 giây; công khai ký bằng `S3_PUBLIC_ENDPOINT` (địa chỉ nền tảng truy cập được).
  - Dấu tệp: SHA-256 tính bằng luồng phía máy chủ khi `stat(loc, { hash: true })` (Worker), lưu vào
    metadata đối tượng `x-amz-meta-sha256` bằng copy-in-place để lần sau đọc nhanh. Không tin dấu do
    trình duyệt gửi.
  - Tệp tạm: `write()` của `job_tmp` gắn nhãn đối tượng `lifecycle=tmp`; luật vòng đời bucket lọc theo **nhãn** (S3 không
    lọc được tiền tố có ký tự đại diện `tenants/*/tmp/`) hết hạn 1 ngày (`minio-init` tạo luật trên MinIO). `job_tmp` không
    dùng được với `presignUpload` (chỉ Worker ghi – `InvalidRequestError`); `signedUrl('preview')` → `InvalidRequestError` (giao diện không xem tệp tạm); `signedUrl('public')` được phép (âm thanh gửi nhà
    cung cấp chuyển giọng nói). Bản giả lập bộ nhớ dọn theo `createdAt` + nhãn.
  - Xóa theo tài khoản: `deleteAllForCurrentAccount()` liệt kê + `DeleteObjects` lô 1.000 – xóa luôn tệp tạm của tài khoản.
  - Thư viện: `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`, `@aws-sdk/s3-request-presigner` (khóa
    phiên bản chính xác, cùng một dòng phát hành); kiểu SDK không ra khỏi `core/storage/s3/`.
  - Dịch vụ S3 cục bộ: **MinIO** (ảnh khóa tag phát hành cụ thể khi implement) – hỗ trợ POST policy và
    luật vòng đời; cổng 9000 (API) / 9001 (console). Kiểm thử hợp đồng bản thật chạy trên MinIO
    (`pnpm test:infra`).
  - Từ chối truy cập chéo: không thể *biểu diễn* vị trí của tài khoản khác qua `StorageLocation`; lớp
    kiểm thêm khi đọc/ghi: khóa dựng ra phải bắt đầu bằng `tenants/${currentAccountId()}/` (không ngoại lệ),
    sai → `StorageAccessDenied` + nhật ký cảnh báo `storage.access_denied` (không in
    khóa). Đường dẫn POST bị dùng ghi vào khóa khác → S3/MinIO tự từ chối theo policy.
- **Rationale**: ADR-07a, ADR-10, FR-050–054; nguyên tắc IX (S3 chuẩn, đổi nhà cung cấp bằng cấu hình).
- **Alternatives**: PUT ký sẵn + kiểm kích thước sau (tệp quá cỡ vẫn tốn dung lượng); LocalStack (nặng
  hơn, giấy phép đổi), SeaweedFS (POST policy chưa chắc).

## R14. Email: mở rộng `core/mail` có sẵn (FR-045, FR-055)

- **Decision**: Thêm vào `Mailer` phương thức `deliver(message): Promise<MailDeliveryResult>` với
  `{ kind: 'sent', messageId } | { kind: 'transient', code } | { kind: 'permanent', code }`; giữ `send()`
  cũ (gọi `deliver`, ném khi không `sent`) để mã của 004 không đổi. Phân loại SMTP: mã phản hồi 5xx
  (`550`, `551`, `552`, `553`, `554`) → `permanent`; 4xx, `ECONNECTION`, `ETIMEDOUT`, `ESOCKET` →
  `transient`; còn lại → `transient` (thử lại an toàn – email không phải đăng bài). `MemoryMailTransport`
  thêm hộp thư đi + kịch bản theo địa chỉ (`failFor(address, 'transient'|'permanent')`). Cấu hình
  `MAIL_*` chuyển từ `AuthConfig` sang cấu hình chung để Worker (hàng chờ `notify`) dùng được; `MailModule`
  cung cấp ở cả hai đơn vị. Bộ kiểm thử hợp đồng email chạy trên `memory` và `smtp`→Mailpit (dùng API
  `/api/v1/messages` của Mailpit để đọc lại). Kịch bản lỗi vĩnh viễn trên Mailpit: dùng tính năng
  "chaos"/từ chối người nhận của Mailpit nếu có ở tag đã khóa, nếu không thì chỉ kiểm phân loại bằng kiểm
  thử đơn vị trên mã lỗi SMTP giả (ghi ở tasks).
- **Rationale**: Không làm lại thứ 004 đã có; tương thích ngược.

## R15. Bộ kiểm thử hợp đồng dùng lại được (FR-004)

- **Decision**: Thư mục `apps/server/test/contracts/<component>/` chứa hàm
  `describe<Component>Contract(name, makeSubject: () => Promise<Subject>)` (Vitest `describe.each`
  thủ công). Tệp chạy:
  - `*.fake.contract.spec.ts` – bản giả lập, chế độ bộ nhớ → `pnpm test` (SC-008 ≤ 2 phút).
  - `*.sandbox.contract.spec.ts` – bản giả lập chế độ `sandbox` → `pnpm test:db` (CSDL thật).
  - `*.infra.contract.spec.ts` – bản thật S3/SMTP trỏ MinIO/Mailpit → `pnpm test:infra` (cấu hình
    Vitest mới, cần `docker compose up -d minio mailpit`).
  Bộ kiểm thử adapter lặp qua `listRegisteredAdapters()` → kênh mới tự được kiểm (US2-AS1, SC-002). Kiểm
  "kết quả ngoài danh sách": adapter bọc trong `assertResultShape` (Zod) ở tầng cổng; kết quả lạ → `unknown`
  + nhật ký `platform.unexpected_result` (Edge Cases), và bộ kiểm thử dùng một adapter "hỏng" cố ý để
  khẳng định điều đó.
- **Rationale**: Bản thật sau này (WBS 2.3, 3.1, 4.3, 2.6) chỉ thêm một tệp `*.contract.spec.ts` gọi cùng
  hàm (SC-010).

## R16. Nhật ký, mã theo dõi, quét bí mật (FR-007, SC-009)

- **Decision**: Mỗi thao tác của 4 hợp đồng ghi một dòng pino có cấu trúc `{ msg: '<component>.<op>',
  trace_id, account_id, outcome, duration_ms, ...metadata an toàn }` (không lời nhắc, không văn bản, không
  mã quyền). Thiết lập Vitest chung đặt `logDestination` ghi nhật ký ra `apps/server/test-logs/*.ndjson` (gitignore) →
  `tooling/verify.mjs` chạy `tooling/scan-secrets.mjs` (có từ 004) trên thư mục đó và quét
  thêm mẫu mã quyền giả (`fake_tok_`), lời nhắc mẫu (`PROMPT_CANARY_`), nội dung bài mẫu
  (`POST_CANARY_`). Span OpenTelemetry (`@opentelemetry/api` đã có) quanh mỗi thao tác cổng: tên
  `platform_gateway.submit`, … – WBS 1.6 nối exporter.
- **Rationale**: Nguyên tắc VIII; tái dùng công cụ sẵn có.

## R17. Thay đổi tệp kê khai module (FR-046) – cần SA duyệt

- **Decision**: `ai_gateway.allowedDeps += notifications`; `content.allowedDeps += notifications`;
  `approval.allowedDeps += notifications`. `notifications.allowedDeps` giữ `account, queue` → không vòng
  (`check:boundaries` đã chặn vòng – fixture `b-cycle`). Thêm quy tắc ranh giới:
  (1) `core/storage` chỉ cho `media`, `context`, `account`;
  (2) `enqueueRegistered` chỉ cho `account`;
  (3) `src/dev/**` không được nhập từ `modules/*` ngoài `internal/fake/**`;
  (4) SDK S3 (`@aws-sdk/*`) chỉ trong `core/storage/s3/`.
  Mỗi quy tắc có fixture trong `tooling/boundaries/fixtures/` như 001–004.
- **Rationale**: Clarifications 2026-11-08 Q5.

## R18. Tài liệu cần sửa theo FR-038 (Governance)

- **Decision**: Trong tính năng này sửa: `TaiLieuDacTa` Đặc tả NFR chi phí ("chia đều" → chi phí vận
  hành), ADD Cổng AI (dòng chia đều sau mục 7; quy tắc giữ chỗ treo "trả lại sau 15 phút" → hai nhánh `held`/`calling`
  của R8), Kiến trúc dữ liệu mục 7.3 (cùng quy tắc giữ chỗ treo), ADD Worker (bỏ việc định kỳ "Chia chi phí xu hướng dùng
  chung" và bước 3 luồng xu hướng), Kiến trúc dữ liệu (bố cục kho tệp `tmp/{jobId}/…` → `tenants/{accountId}/tmp/{jobId}/…`,
  luật hết hạn theo nhãn – R13); `.specify/memory/architecture.md` mục 7.2 thêm ngân sách hệ thống + kẹp trần + sự kiện
  ngưỡng trong giao dịch quyết toán, mục 11 thêm thuật ngữ mới, bố cục kho tệp đổi như trên. Lưu ý `TaiLieuDacTa/` bị gitignore (chép vào worktree) → sửa ở repo
  chính khi hợp nhất, ghi trong tasks.
