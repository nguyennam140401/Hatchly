# Hợp đồng — điểm cuối quản trị / hỗ trợ tối thiểu (FR-018, FR-019a, FR-035)

Không có giao diện quản trị đầy đủ (WBS 4.7). Chỉ các điểm cuối HTTP JSON nội bộ dưới đây, mỗi điểm khai báo đúng một `@StaffAccess(...)` (bộ gác mặc định từ chối, 004).
Mã tài khoản **không** nhận từ người dùng khách; với nhân viên, `accountId` ở đường dẫn là ngoại lệ có chủ đích của `supportViewAccount` (kèm lý do + kiểm toán).
Mọi phản hồi dành cho nhân viên MAY có số tiền (USD/micro-USD); **không** điểm cuối nào được khách gọi.

## 1. Quyền (`packages/shared/src/auth/permissions.ts`)

| Quyền | owner | collaborator | support | admin |
|---|---|---|---|---|
| `ai.pricing.manage` | ✗ | ✗ | ✗ | ✓ |
| `ai.cost.view` | ✗ | ✗ | ✓ | ✓ |

## 2. Cấu hình (chỉ `admin`, `ai.pricing.manage`) — FR-019a

| Điểm cuối | Thân yêu cầu | Kiểm tra | Kiểm toán (`infra.audit_log`) |
|---|---|---|---|
| `POST /admin/ai/prices` | `{ provider, modelId, unit, inputPerMTok?, outputPerMTok?, cachedInputPerMTok?, perMinute?, billingGranularitySec?, effectiveFrom }` | giá > 0 đúng theo `unit`; lệch ≤ 10× so với dòng hiện hành cùng `(provider, modelId, unit)` (dòng đầu chỉ `> 0`); `effectiveFrom ≥ now + TTL đệm`; không sửa/xóa dòng cũ | `ai.price.add` — metadata: `{ priceId, provider, modelId, unit, old, new, effectiveFrom }` |
| `PUT /admin/ai/settings` | `{ accountCapMicroUsd?, accountSoftLimitMicroUsd?, perIndustryWeeklyMicroUsd? }` | `soft < cap`, mọi giá trị nguyên dương; áp cho chu kỳ/tuần tạo sau đó | `ai.settings.change` — `{ field, old, new }` |
| `PUT /admin/ai/routes` | `{ tier, rank, provider, modelId, enabled }` | `rank ∈ {1,2}`; mô hình đã có ít nhất một dòng giá | `ai.route.change` |
| `PUT /admin/ai/task-fallback` | `{ task, enabled }` | `task ∈ AI_TASKS`; bật chỉ hợp lệ khi có tuyến rank 2 cho bậc của loại việc đó | `ai.task_fallback.change` |
| `POST /admin/ai/provider-invoices` | `{ provider, invoiceDate, totalMicroUsd }` | `total ≥ 0`; trùng `(provider, invoiceDate)` thay thế **kèm** kiểm toán giá trị cũ/mới | `ai.invoice.enter` |

Mã lỗi (tiếng Việt, kèm hành động khắc phục): `AI_PRICE_IMPLAUSIBLE` (giá ≤ 0 hoặc lệch > 10×), `AI_PRICE_EFFECTIVE_TOO_SOON`, `AI_SETTINGS_INVALID`
(soft ≥ cap…), `AI_ROUTE_INVALID`. Không yêu cầu người thứ hai duyệt (Clarifications Q3). Ghi cấu hình và dòng kiểm toán nằm **cùng một giao dịch**.

## 3. Xem chi phí (`ai.cost.view`) — FR-018, FR-035

| Điểm cuối | Kết quả | Ghi chú |
|---|---|---|
| `GET /support/ai/budget/:accountId?reason=…` | Chu kỳ hiện hành: `used`, `reserved`, `cap`, `softLimit`, `state`, các dòng sổ gần nhất (task, model, provider, token/giây, `costMicroUsd`, `anomaly`), chi phí xu hướng đã phân bổ | `supportViewAccount` — bắt buộc `reason` ≥ độ dài tối thiểu; ghi `support.view_account`; qua các khung nhìn `ai_gateway.support_ai_budget_detail`, `ai_gateway.support_ai_cost_ledger`, `ai_gateway.support_ai_trend_allocations` (không cột bí mật) |
| `GET /support/ai/summary?cycle=…` | Tổng hợp nội bộ: theo loại việc, theo mô hình, theo nhà cung cấp, trung bình mỗi tài khoản và mỗi bài (`post_generation` đã quyết toán) | Chỉ số tổng hợp, không dữ liệu từng tài khoản nhận dạng được |

Vai trò khách gọi bất kỳ điểm cuối nào ở đây → `403` (`@StaffAccess`). Nhật ký truy cập chung ghi mã tài khoản và mã nhân viên, **không** ghi số tiền.

## 4. Việc nền (xem [`jobs-and-alerts.md`](./jobs-and-alerts.md))

Không có điểm cuối kích hoạt việc nền; việc chạy theo lịch hoặc do giữ chỗ/phân bổ tạo trong giao dịch.
