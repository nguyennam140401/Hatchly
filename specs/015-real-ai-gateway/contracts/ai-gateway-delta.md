# Hợp đồng — thay đổi giao diện công khai so với 005

Nền: [`specs/005-gateway-contracts-fakes/contracts/ai-gateway.md`](../../005-gateway-contracts-fakes/contracts/ai-gateway.md). Tính
năng này **giữ nguyên** `AiGatewayPublicApi` (`generate`, `generateStream`, `transcribe`, `getUsage`, `system.generate`), `AI_TASKS`,
`MODEL_TIERS`, `AiResult`, `AiStream`, `AiUsage`. Mọi thay đổi dưới đây là **cộng thêm, tương thích ngược**: module gọi hiện có
không phải sửa và test hợp đồng 005 vẫn đạt nguyên vẹn.

## 1. Trường mới: mã yêu cầu logic (FR-037a)

```ts
export interface AiRequest {
  /* …các trường cũ… */
  /** Mã yêu cầu logic do module gọi truyền; cùng mã trong cùng chu kỳ không bị giữ chỗ/gọi/tính tiền lại. */
  requestId?: string;           // 1–128 ký tự [A-Za-z0-9:_.-]; sai định dạng → AI_INVALID_REQUEST
}
export interface TranscribeRequest {
  /* …các trường cũ… */
  requestId?: string;
}
```

- **Ai truyền**: module chạy nền (`ai_batch`: mỗi bài/lần tạo lại; `media`: mỗi tệp gán nhãn). Quy ước gợi ý: `post:{postId}:gen:{n}`,
  `media:{mediaId}:label`. Lời gọi tương tác trực tiếp của người dùng **không bắt buộc** (bỏ trống → luôn là lời gọi mới).
- **Bắt buộc với bên gọi nền (T053a)**: việc chạy nền (`media` gán nhãn, `ai_batch`) MUST truyền `requestId` ổn định theo đối tượng
  (`media:{mediaId}:label`, `post:{postId}:gen:{n}`) để job chạy lại không tính tiền hai lần (nguyên tắc V).
- **Phạm vi trùng**: `(tài khoản, chu kỳ, requestId)`; mã của việc hệ thống: `(tuần, requestId)`.
- **Hành vi** khi gặp mã đã có giữ chỗ **không** ở trạng thái `released`:

| Trạng thái dòng đã có | Kết quả | Giữ chỗ / gọi nhà cung cấp / sổ |
|---|---|---|
| `settled` | ném `AiError('AI_DUPLICATE_REQUEST')`, `status: 'settled'` | không / không / không thêm dòng |
| `held`, `calling` | ném `AiError('AI_DUPLICATE_REQUEST')`, `status: 'in_progress'` | không / không / không |
| `released` hoặc chưa có | chạy bình thường (cho phép thử lại sau lỗi nhà cung cấp) | như thường |

Không có văn bản kết quả được lưu hay trả lại (FR-017); bên gọi dùng trạng thái này cùng kiểm tra nghiệp vụ của chính nó
("chủ đề đã có bài thì bỏ qua", 005 kiến trúc mục 6).

## 2. Mã lỗi mới (cộng thêm vào `AiErrorCode`)

| Mã | `messageVi` (không số tiền) | `retryable` | Dùng khi |
|---|---|---|---|
| `AI_DUPLICATE_REQUEST` | "Yêu cầu này đã được xử lý hoặc đang xử lý" | false | Mục 1; kèm thuộc tính `status: 'settled' \| 'in_progress'` |
| `AI_NOT_CONFIGURED` | "Tính năng AI tạm thời chưa sẵn sàng, bạn vẫn có thể soạn tay" | false | Thiếu giá hợp lệ / thiếu `model_routes` rank 1 / tài khoản chưa có chu kỳ hợp lệ khác "hết hạn mức" (FR-022); luôn phát `ai.price_missing`/`ai.route_missing` |

Các mã cũ giữ nguyên nghĩa. `AI_BUDGET_EXHAUSTED` cũng được trả khi tài khoản **không có chu kỳ hiệu lực** (Edge Case); khi đó
`getUsage()` trả `{ percent: 100, state: 'blocked', nextCycleStartsAt: now }`. Lượt **dự phòng** thiếu giá → `AI_PROVIDER_UNAVAILABLE`
(không phải `AI_NOT_CONFIGURED`) kèm phát `ai.price_missing`. Sổ ghi `provider` của tuyến **thực sự trả kết quả**. Bộ xử lý nền gặp
`AI_BUDGET_EXHAUSTED`, `AI_SYSTEM_BUDGET_EXHAUSTED`, `AI_DUPLICATE_REQUEST`, `AI_NOT_CONFIGURED` MUST dùng `noRetry(...)` của 003 (FR-037,
không đốt hàng chờ); `AI_PROVIDER_UNAVAILABLE` thử lại theo chính sách hàng chờ (≤ 2 lần ở `ai_batch`).

## 3. Hành vi quan sát được thay đổi (không đổi chữ ký)

| Điểm | 005 (giả lập) | 015 (thật) |
|---|---|---|
| `transcribe` quyết toán | bằng đúng ước tính | theo thời lượng nhà cung cấp báo đã xử lý (≤ ước tính) |
| Dự phòng | luôn thử `[primary, fallback]` | chỉ khi `task_fallback.enabled` và có tuyến rank 2; còn lại lỗi ngay |
| Giá | JSON tĩnh theo bậc | `model_prices` theo `(provider, model_id)` tại thời điểm giữ chỗ; lưu `price_id` vào giữ chỗ |
| Chu kỳ | mặc định theo tháng lịch | theo mốc của `account` (ngày kích hoạt, ngày cuối tháng) |
| Trần/ngưỡng | hằng số | `ai_settings`, chụp vào dòng ngân sách lúc tạo |
| `getUsage()` | % + `state` + `nextCycleStartsAt` | **giữ nguyên**; không có tiền ở bất kỳ trường nào (quét tự động SC-004) |

## 4. Phương thức cộng thêm ở `AccountPublicApi` (mốc chu kỳ — R-05)

```ts
interface AccountPublicApi {
  /** Mốc chu kỳ của tài khoản trong ngữ cảnh (ngày trong tháng dùng để lặp hằng tháng). Không cache.
   *  `null` = chưa kích hoạt / gói hết hạn → Cổng AI từ chối như hết hạn mức. Chạy ở API và Worker. */
  getAiCycleAnchor(): Promise<{ anchorDate: string /* YYYY-MM-DD */ } | null>;
}
```

Hiện thực tạm: ngày tạo của tài khoản `active` (chưa có cột kích hoạt; trạng thái khác → `null`); khi có mô hình gói đổi bên trong `account`. Cập nhật `account/public-api.ts`, `index.ts` và hợp đồng
của `account`; kiểm thử ranh giới `pnpm check:boundaries` không đổi (đã có `account` trong `allowedDeps` của `ai_gateway`).

## 5. Cổng đảo ngược do module khác cung cấp (R-11)

Định nghĩa trong `ai_gateway/public-api.ts` (kiểu + token), **hiện thực** do `trends`/`context` đăng ký bằng token Nest; `ai_gateway` không
import ngược:

```ts
export const ACTIVE_INDUSTRIES_SOURCE = Symbol('ACTIVE_INDUSTRIES_SOURCE');
export interface ActiveIndustriesSource {
  /** Số ngành đang có ít nhất một tài khoản hoạt động (loại `unclaimed`). Chạy ở Worker, ngữ cảnh hệ thống. */
  countActiveIndustries(): Promise<number>;
}
export const INDUSTRY_ACCOUNTS_SOURCE = Symbol('INDUSTRY_ACCOUNTS_SOURCE');
export interface IndustryAccountsSource {
  /** Mã tài khoản hoạt động thuộc một ngành (sắp theo mã tăng dần), phân trang. */
  listAccountIds(industryId: string, page: { after?: string; limit: number }): Promise<string[]>;
}
```

**Ai đăng ký token (T063)**: module `trends` (hoặc `context`, SA chốt khi làm 016/ngành) cung cấp provider Nest cho hai token trong
module của mình và export; `ai_gateway.module` chỉ inject tùy chọn (`@Optional()`), không import ngược module đó.
Chưa có hiện thực → trần hệ thống dùng `AI_SYSTEM_WEEKLY_CAP_MICRO_USD` và việc phân bổ bị bỏ qua kèm cảnh báo `ai.industry_source_missing`.

## 6. Bộ kiểm thử hợp đồng (`test/contracts/ai/`)

Giữ nguyên 14 mục của 005 (chạy với `memory` và `db` thật thay cho `sandbox`) và thêm:

15. `requestId`: gọi hai lần cùng mã → lần hai `AI_DUPLICATE_REQUEST(settled)`, không gọi nhà cung cấp, đúng 1 dòng sổ; gọi đồng thời hai lần → một chạy,
    một `in_progress`; lần đầu lỗi nhà cung cấp (đã `released`) → thử lại cùng mã chạy được.
16. Chu kỳ: ngày kích hoạt 29/30/31, tháng 2, năm nhuận; hai yêu cầu đầu chu kỳ đồng thời → đúng 1 dòng `ai_budgets`; chu kỳ mới đặt lại cờ 80/100.
17. Dự phòng theo loại việc: `transcription` chưa bật dự phòng + nhà cung cấp lỗi → `AI_PROVIDER_UNAVAILABLE` ngay, `reserved = 0`, không có lời gọi thứ hai.
18. Bảng giá: dòng giá hiệu lực từ T → lời gọi trước T giữ giá cũ, sau T giá mới; quyết toán dùng `price_id` của giữ chỗ dù giá đổi giữa chừng; thiếu giá →
    `AI_NOT_CONFIGURED`, không gọi nhà cung cấp.
19. STT: 90 s, 300 s, 720 s; làm tròn theo `billing_granularity_sec`; chi phí thực ≤ ước tính.
20. Trần hệ thống = `N ngành × mức/ngành`; hết trần → `AI_SYSTEM_BUDGET_EXHAUSTED`; phân bổ chia đều, tổng bằng chi phí, `used` khách không đổi.
