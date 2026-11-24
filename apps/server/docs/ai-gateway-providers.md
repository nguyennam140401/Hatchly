# Cổng AI – bộ chuyển đổi nhà cung cấp (015)

Mã: `src/modules/ai_gateway/internal/providers/`. SDK nhà cung cấp (`@anthropic-ai/sdk`, `openai`, đã ghim phiên bản) chỉ được nhập ở thư mục này; `pnpm check:boundaries` chặn nơi khác.

## Quy tắc chung

- Không thử lại bên trong (`maxRetries: 0`): thử lại/dự phòng do `AiGatewayService` quyết định theo `RouteBook.attemptsFor` (đúng một lần dự phòng).
- Mọi lỗi mạng/5xx/429/hết giờ/hủy → `ProviderCallError` (loại lỗi + mã HTTP). Thông điệp và nhật ký KHÔNG chứa khóa API, lời nhắc, thân yêu cầu/phản hồi; không giữ `cause` của SDK.
- `max_tokens` (Anthropic) / `max_completion_tokens` (OpenAI) = `maxOutputTokens` của yêu cầu. Tôn trọng `AbortSignal` (kể cả luồng: SDK kết thúc luồng im lặng khi hủy nên bộ chuyển đổi ném lỗi `aborted`).
- `inputTokens` là TỔNG gồm phần đệm: Anthropic = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`; OpenAI = `prompt_tokens`.
- Mã theo dõi (FR-036) đi qua tiêu đề `x-trace-id`, không bao giờ nằm trong lời nhắc.
- Đo: `ai_gateway_provider_calls_total{provider,outcome}` và `ai_gateway_provider_latency_ms{provider}` ghi sau MỖI lời gọi (`instrumented`).

## Lời nhắc và bộ đệm

`OrderedPrompt.parts = [hệ thống, hồ sơ?, xu hướng?, …, phần thay đổi]`; phần cuối là phần thay đổi, các phần trước là tiền tố cố định.

- Anthropic: tiền tố → `system` nhiều khối, `cache_control: ephemeral` ở khối CUỐI của tiền tố; phần thay đổi (+ ảnh khung hình) ở tin nhắn người dùng.
- OpenAI: tiền tố → các tin nhắn `system` đứng trước (OpenAI tự đệm tiền tố); phần thay đổi (+ ảnh) ở tin nhắn `user`.
- Bộ chuyển đổi không giữ trạng thái giữa các lời gọi → mỗi lời gọi chỉ chứa hồ sơ của đúng một tài khoản.

## Cờ không dùng dữ liệu để huấn luyện (FR-025, hiến chương VII)

| Nhà cung cấp | Cách thực hiện                                                                                                                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI       | Thân yêu cầu `store: false` (mặc định bật; `noTrain: false` mới bỏ).                                                                                                                                                                                        |
| Anthropic    | API KHÔNG có cờ yêu cầu tương ứng, nên KHÔNG thêm tiêu đề/trường giả. Cam kết nằm ở HỢP ĐỒNG/điều khoản thương mại với nhà cung cấp (dữ liệu API thương mại không dùng để huấn luyện). Việc ký/kiểm tra cam kết là điều kiện trước ngày ra mắt (R-17, POC). |

## Khóa và khởi động (driver `real`)

- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`: bí mật (`Secret` K8s), chỉ bắt buộc khi có tuyến `model_routes` ĐÃ BẬT dùng nhà cung cấp đó. Thiếu → Worker/API dừng khởi động với thông báo nêu TÊN biến (không in giá trị).
- Nhà cung cấp trong `model_routes` chưa có bộ chuyển đổi (`registry.ts`) → dừng khởi động. Thêm nhà cung cấp = thêm tệp bộ chuyển đổi + một dòng trong `registry.ts` + dòng `model_routes`/`model_prices`.
- Tuyến bật SAU khi khởi động (admin đổi tuyến sang nhà cung cấp chưa dựng): bộ chuyển đổi được dựng LƯỜI ở lần gọi đầu nếu khóa đã nạp trong cấu hình tiến trình. Nếu chưa có khóa → lượt chính `AI_NOT_CONFIGURED`, lượt dự phòng bị bỏ (`ai.route_missing`); quy trình: đặt khóa vào Secret → `rollout restart` API + Worker. Nhà cung cấp không hỗ trợ thao tác (vd `stt` ≠ `openai`) trả lỗi `unsupported`.

## Chuyển giọng nói (STT, OpenAI)

- Chỉ tải URL do kho tệp nội bộ cấp: `https`, host thuộc `S3_PUBLIC_ENDPOINT`/`S3_ENDPOINT` (+ tên miền con) hoặc `AI_STT_ALLOWED_HOSTS`; danh sách rỗng → từ chối. Không theo chuyển hướng, tải theo dòng với trần 25 MB (vượt → từ chối). Lỗi không chứa URL ký sẵn.
- `AI_STT_ALLOWED_HOSTS` CHỈ được chứa host của kho tệp (không dùng tên miền gốc dùng chung: hậu tố `.host` cho phép mọi tên con). Allowlist không kiểm cổng và không chặn IP nội bộ → rủi ro DNS rebinding còn lại được CHẤP NHẬN ở giai đoạn 1 (đã có `https`, không chuyển hướng, trần 25 MB).
- Hợp đồng thời lượng: `transcribe` chỉ do module nội bộ (media) gọi qua giao diện công khai; bên gọi chịu trách nhiệm báo `durationSec` THẬT (ffprobe). Cổng AI từ chối `durationSec` không hữu hạn hoặc ≤ 0 (`AI_INVALID_REQUEST`). Giữ chỗ ước tính theo `min(durationSec, 300)` (5 phút đầu là phạm vi xử lý phía gọi).
- Tệp được gửi NGUYÊN (≤ 25 MB, không cắt 5 phút) nên nhà cung cấp tính đủ thời lượng. Quyết toán theo thời lượng THỰC nhà cung cấp báo (làm tròn lên theo `billing_granularity_sec`, không kẹp 300); sổ ghi `audio_seconds` = thời lượng thực; nếu > 300 s thì `anomaly = 'over_estimate'` và phát `ai.cost_anomaly`. Phần vượt ước tính bị kho kẹp theo trần ngân sách (ghi `over_cap`), không bao giờ vượt trần.
- Tên tệp gửi đi có đuôi đúng (từ đuôi URL, rồi `content-type`, mặc định `.mp3`) vì điểm cuối nhận biết định dạng theo đuôi. Xác nhận bằng POC-4.

## Chi phí bộ đệm (Anthropic)

- `cache_read` tính giá `cached_input_per_mtok`; `cache_creation` (ghi bộ đệm) tính giá nhập × 1,25 (`CACHE_WRITE_MULTIPLIER_PERCENT`, `estimate.ts`). Ước tính trước giữ chỗ không cộng hệ số này (nếu thực tế vượt, phần vượt bị kẹp bởi trần và sổ ghi `over_estimate`).

## Luồng đứt giữa chừng

- Chưa có chữ nào gửi ra → trả giữ chỗ, chuyển lượt dự phòng bình thường. ĐÃ có chữ → KHÔNG tự dự phòng: `AiResult.interrupted = true` kèm phần đã sinh, quyết toán theo usage nhà cung cấp đã báo (Anthropic `message_start`) hoặc ước tính an toàn (kẹp ≤ giữ chỗ), sổ `anomaly='missing_usage'`. Tạo lại = lượt mới + giữ chỗ mới. Người dùng hủy: quyết toán phần đã sinh, một dòng sổ (như cũ).
- `AnthropicAdapter` gửi khóa qua cả `Authorization: Bearer` (SDK 1.7) và `x-api-key` (chuẩn của API).
