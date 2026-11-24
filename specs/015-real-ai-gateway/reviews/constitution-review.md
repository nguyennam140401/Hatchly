# Rà soát hiến pháp toàn nhánh (T074) – 015-real-ai-gateway

Phạm vi: working tree (git status/diff HEAD, bỏ `specs/`), đối chiếu `plan.md` mục "Constitution Check" và "Complexity Tracking".
Kiểm tra: `pnpm check:boundaries` đạt, `pnpm check:secrets` đạt. `pnpm typecheck` lỗi ở `tooling/test/check-wiki.spec.ts` và `pnpm lint` (prettier) ở 2 tệp ngoài nhánh: có sẵn từ `dev`, không thuộc thay đổi này.

KẾT QUẢ: đạt có điều kiện (không vi phạm nguyên tắc I, II, III; bổ sung tài liệu và 1 lỗi cảnh báo, xem `us7-us8.md`).

## Đối chiếu chín nguyên tắc
| # | Kết luận | Bằng chứng / ghi chú |
|---|---|---|
| I | Đạt | Bảng tenant mới có RLS; `runForAccount` đặt lại ngữ cảnh từ danh sách do module sở hữu cung cấp (nhưng chưa chặn ngữ cảnh `request`, THẤP-TB, `us7-us8.md` #3); hàm SECURITY DEFINER hẹp, EXECUTE đúng vai trò; hỗ trợ xem chi phí có lý do + kiểm toán, qua khung nhìn lọc. |
| II | Không áp dụng | Không chạm đăng bài. |
| III | Đạt | Giữ chỗ một UPDATE có điều kiện + CHECK; settle/release idempotent; trần tuần hệ thống tách khỏi `ai_budgets.used`; micro-USD `bigint`; điểm cuối khách không có số tiền (số tiền chỉ ở `support/ai/*` và `admin`). |
| IV | Đạt, cần ghi tài liệu | `check:boundaries` sạch. `ai_gateway` chỉ gọi `account`/`queue`/`notifications` qua giao diện công khai. Hàm `account.count_active_accounts()` do migration 0033 (tính năng 015) tạo trong schema `account` nhưng thuộc module `account` (xem #A). |
| V | Đạt | Việc nền idempotent, khóa lịch theo khung giờ, dọn giữ chỗ hệ thống mỗi phút; không đồng thời 1 theo tên việc đã chốt (hạ tầng không hỗ trợ). |
| VI | Đạt | Không đổi hành vi module gọi; lỗi có `actions`. |
| VII | Đạt có điều kiện | Khóa nhà cung cấp là `secret(...)` trong cấu hình, không vào nhật ký; sự kiện chỉ nhận trường cho phép. Điều kiện còn mở: hồ sơ chuyển dữ liệu xuyên biên giới (Kiến trúc dữ liệu mục 9) cho Anthropic/OpenAI phải có trước khi bật `AI_GATEWAY_DRIVER=real` ở production (đã ghi ở plan, R-17). |
| VIII | Đạt có sửa | Có chỉ số, nhật ký cấu trúc, quy tắc cảnh báo. Lỗi quy tắc: cửa sổ `[5m]` bằng `for: 5m` (CAO) và mất mẫu đầu của bộ đếm (TB). Phần cảnh báo chỉ ở nhật ký (không có Loki ruler) được ghi trong tệp quy tắc. |
| IX | Đạt | Không thêm hạ tầng; SDK bọc sau `AiProviderAdapter`, ranh giới SDK kiểm bằng fixture `g-ai-sdk-in-*`; mô hình/giá là dữ liệu. |

## Điểm lệch có chủ ý: đã có trong "Theo dõi độ phức tạp" chưa?
| Lệch có chủ ý | Hiện có trong plan.md? | Đề xuất |
|---|---|---|
| Chu kỳ tạm theo ngày tạo tài khoản `active` (hiến pháp: ngày kích hoạt gói) | CÓ, ở Complexity Tracking | Giữ. Bổ sung: chu kỳ hết hạn → `AI_BUDGET_EXHAUSTED` (đã ở code). |
| Anthropic chỉ có cam kết hợp đồng về không huấn luyện (không cờ kỹ thuật như OpenAI) | CHỈ ở "Rủi ro và việc mở sau thi công" | Thêm dòng Complexity Tracking: lệch nhẹ nguyên tắc VII ("MUST cam kết không dùng huấn luyện": chỉ cam kết hợp đồng); phương án đơn giản hơn đã loại: chặn Anthropic cho tới khi có cờ kỹ thuật. Điều kiện: hồ sơ Q-D3 trước ngày ra mắt. |
| Seed giá/mô hình giả định ở 0030 | CHỈ ở "Rủi ro và việc mở" | Thêm dòng Complexity Tracking (hiến pháp IX: giả định chưa kiểm chứng phải qua POC trước khi chốt): seed chỉ cho dev/test; production phải thêm giá thật qua `admin_add_price` sau POC-1/3/4; cân nhắc bước chặn khởi động `real` ở production khi giá còn là seed. |
| Mốc 100% tính theo số ĐÃ QUYẾT TOÁN (`used + minEstimate >= cap`), không tính giữ chỗ | KHÔNG | Thêm dòng: không mâu thuẫn III (reserve vẫn chặn trước khi gọi, không bao giờ vượt trần) nhưng khác chữ "từ 4 USD chặn" ở chỗ thông báo 100% và trạng thái `blocked` hiển thị theo số đã quyết toán; lý do: giữ chỗ trả lại không làm cờ báo sai. |
| `anomaly = 'over_estimate'` khi chi phí thực > ước tính, kẹp vào trần (`over_cap_micro_usd`) | KHÔNG | Thêm dòng: STT/điều kiện ghi nhận vượt trần để đối soát, không cho `used + reserved > cap` (III). |
| Hóa đơn 0 và sổ > 0 → lệch 100%; số ngành 0 → trần tạm; mẫu số tài khoản hoạt động; không đồng thời 1 theo tên việc | KHÔNG | Ghi vào "Quyết định đã chốt" của research.md hoặc Complexity Tracking một dòng chung (không lệch nguyên tắc, chỉ ghi truy vết). |
| Migration 0032/0033 và hàm `account.count_active_accounts` | KHÔNG (mục "Phân chia sở hữu" chỉ ghi 0029–0031) | Cập nhật: ghi 0032/0033, data-dev sở hữu, hàm thuộc module `account`. |

## Phát hiện cấp nhánh
- THẤP `plan.md:167-168`: ghi chú "Gauge `open_reservations` chưa nối (T066); các cảnh báo T069 chờ T066–T068" đã lỗi thời (gauge nối ở `ai_gateway.module.ts:212`, cảnh báo ở `ai_gateway.rules.yml`). Dev: architect. Sửa: xóa hoặc cập nhật.
- THẤP `plan.md:62` (bảng IV): "không thêm mũi tên phụ thuộc mới" đúng với `allowedDeps`, nhưng nên nêu thêm `countActiveAccounts` là hàm công khai của module `account` dùng lại ở Worker.
- THẤP `ai_gateway/internal/metrics.ts:76-96`: nhãn `account_id` trong `ai_gateway_calls_total` đúng yêu cầu VIII nhưng là nhãn phân tán cao; ghi giới hạn cardinality vào tài liệu vận hành (chịu ×10 tải ước tính).
- Không có số tiền USD chi phí AI trong điểm cuối khách (chỉ `ai.cost.view`/`ai.pricing.manage` cho nhân viên), không có SDK nhà cung cấp ngoài `providers/` (kiểm bằng boundaries), không có khóa/bí mật rò (check:secrets sạch).
