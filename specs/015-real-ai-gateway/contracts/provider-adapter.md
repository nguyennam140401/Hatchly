# Hợp đồng — bộ chuyển đổi nhà cung cấp, định tuyến, dự phòng

Giao diện nội bộ (`internal/providers/`). SDK nhà cung cấp **chỉ** được nhập ở thư mục này; kiểu của SDK không ra khỏi nó. Cổng AI không
bao giờ nhận mô hình do bên gọi chọn (FR-033 của 005).

## 1. Giao diện (mở rộng nhỏ so với 005)

```ts
interface AiProviderAdapter {
  readonly provider: string;                       // 'anthropic' | 'openai' | 'fake-primary' | …
  /** Ước tính token đầu vào CỤC BỘ, chặn trên, KHÔNG gọi mạng (R-09). */
  countInputTokens(model: string, prompt: OrderedPrompt): Promise<number>;
  complete(model: string, p: OrderedPrompt, maxOut: number, signal: AbortSignal): Promise<ProviderResult>;
  stream(model: string, p: OrderedPrompt, maxOut: number, signal: AbortSignal): ProviderStream;
  transcribe(model: string, audioUrl: string, signal: AbortSignal): Promise<ProviderResult>;
}
interface ProviderResult {
  text: string; inputTokens: number; outputTokens: number; cachedInputTokens: number; modelId: string;
  /** Chỉ STT: số giây âm thanh nhà cung cấp báo đã xử lý (kẹp ≤ 300). Thiếu → quyết toán theo ước tính + anomaly 'missing_usage'. */
  audioSeconds?: number;
}
```

Quy tắc cho mọi bộ chuyển đổi:

1. Đặt **giới hạn đầu ra** (`max_tokens`) bằng `maxOut` của yêu cầu ở phía nhà cung cấp (Edge Case "ước tính thấp hơn thực tế").
2. Tôn trọng `AbortSignal` (thời gian chờ 40 s, chữ đầu tiên 5 s khi trả dần, hủy từ bên gọi) và **không** thử lại bên trong — việc thử lại/dự phòng do
   `AiGatewayService` quyết định (đúng một lần dự phòng).
3. Chuẩn hóa lỗi: mọi lỗi mạng/5xx/429/hết thời gian → ném lỗi chung "nhà cung cấp lỗi" (Cổng quyết định trả giữ chỗ + dự phòng); lỗi 4xx do yêu cầu sai →
   cũng là lỗi nhà cung cấp nhưng gắn cờ không thử dự phòng khi dự phòng cũng sẽ lỗi như vậy (không bắt buộc ở giai đoạn 1).
4. **Không** ghi lời nhắc, kết quả, khóa API vào nhật ký/thông báo lỗi; thông điệp lỗi của SDK được che trước khi vào nhật ký (FR-017, FR-026).
5. Dữ liệu gửi ra tối thiểu; cờ "không dùng dữ liệu để huấn luyện" theo cấu hình từng nhà cung cấp (FR-025); `images` chỉ là khung hình thu nhỏ do `media` cấp.
6. Đo: mỗi lượt gọi tăng `ai_gateway_provider_calls_total{provider, outcome}` và ghi `ai_gateway_provider_latency_ms` (OpenTelemetry).

## 2. Bộ chuyển đổi giai đoạn 1 (SA chốt tạm — R-12)

| Bộ chuyển đổi | Hỗ trợ | Ghi chú |
|---|---|---|
| `AnthropicAdapter` | `complete`, `stream`, ảnh (khung hình), bộ nhớ đệm lời nhắc | Dùng tiền tố lời nhắc cố định để tận dụng prompt cache; phân theo tenant (không đưa hồ sơ nhiều tài khoản vào cùng tiền tố) |
| `OpenAiAdapter` | `complete`, `stream`, ảnh, `transcribe` | STT chỉ 5 phút đầu: cắt tệp/đoạn ở phía gọi, không tải toàn tệp |
| `FakeAiProvider` ×2 | như 005 | Giữ cho dev/test; bị từ chối ở production |

Kiểm thử hợp đồng bộ chuyển đổi dùng **máy chủ HTTP giả cục bộ** (không gọi mạng ngoài ở CI); thêm nhà cung cấp mới = thêm tệp bộ chuyển đổi + dòng
`model_routes`/`model_prices`, không sửa module gọi (FR-023).

## 3. Định tuyến và dự phòng (R-07)

```ts
interface RouteBook {                                 // internal/routing/route-book.ts – đệm TTL 60 s như PriceBook
  /** Danh sách lượt gọi theo thứ tự: [chính] hoặc [chính, dự phòng]. Rỗng/thiếu rank 1 → AI_NOT_CONFIGURED. */
  attemptsFor(task: AiTask, tier: ModelTier): { provider: string; modelId: string }[];
}
```

Thuật toán `attemptsFor`:

1. `primary = model_routes[tier, rank=1]` (đã `enabled`); thiếu → rỗng (cấu hình thiếu).
2. `fallback = model_routes[tier, rank=2]` chỉ khi `enabled` **và** `task_fallback[task].enabled`; không thì bỏ.
3. Trả `[primary]` hoặc `[primary, fallback]`.

`AiGatewayService` với mỗi lượt: tra giá `(provider, modelId)` tại thời điểm giữ chỗ → ước tính → `reserve` → `markCalling` → gọi. Lượt thất bại → `release`
(trả toàn bộ) rồi sang lượt kế. Hết lượt → `AI_PROVIDER_UNAVAILABLE`, ngân sách không bị trừ, không tự thử lại vô hạn. Sổ ghi nhà cung cấp **thực sự** trả kết quả.
Dự phòng đắt hơn và không đủ ngân sách → từ chối như hết hạn mức, không gọi (US4-AS3).

## 4. Cấu hình và bí mật

| Biến | Ý nghĩa | Ghi chú |
|---|---|---|
| `AI_GATEWAY_DRIVER=fake\|real` | Chọn bản cài đặt | `real` ở staging/production; `fake` bị `assert-no-fakes` chặn ở production |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Khóa nhà cung cấp | Bắt buộc khi tuyến đã bật dùng nhà cung cấp đó; `Secret` K8s, không vào nhật ký |
| `AI_PROVIDER_TIMEOUT_MS`, `AI_FIRST_TOKEN_TIMEOUT_MS` | 40 000 / 5 000 (đã có) | |
| `AI_PRICE_CACHE_TTL_MS` | TTL đệm giá/tuyến, mặc định 60 000 | Quy định lead-time tối thiểu của `effective_from` (R-06) |
| `AI_TOKEN_ESTIMATE_SAFETY_PERCENT` | Hệ số an toàn ước tính, mặc định 20 | R-09, chỉnh sau POC-1 |
| `AI_SYSTEM_WEEKLY_CAP_MICRO_USD` | Trần tuần hệ thống **tạm** khi chưa có nguồn số ngành | Đã có từ 005 |
