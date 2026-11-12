# Sửa tài liệu theo R18 / FR-038 (cần làm ở repo chính khi hợp nhất)

`TaiLieuDacTa/` bị gitignore (chỉ chép vào worktree), nên các thay đổi dưới đây **chưa** được commit cùng
nhánh `impl/005-gateway-contracts-fakes`. Làm ở repo chính ngay sau bước `/speckit-worktree-finish`.

| # | Tài liệu | Chỗ cần sửa | Nội dung mới |
|---|---|---|---|
| 1 | Đặc tả yêu cầu – NFR chi phí | Câu "chi phí xu hướng chia đều cho các tài khoản cùng ngành" | Chi phí tóm tắt xu hướng là **chi phí vận hành** của hệ thống: giữ chỗ vào ngân sách hệ thống theo tuần (`AI_SYSTEM_WEEKLY_CAP_MICRO_USD`), không tính vào ngân sách 4 USD của tài khoản |
| 2 | ADD Cổng AI – sau mục 7 | Dòng "chia đều chi phí xu hướng" | Như #1; `system.generate` chỉ gọi được ngoài ngữ cảnh tài khoản, hết trần tuần → `AI_SYSTEM_BUDGET_EXHAUSTED` + cảnh báo |
| 3 | ADD Cổng AI + Kiến trúc dữ liệu mục 7.3 | Quy tắc "giữ chỗ treo trả lại sau 15 phút" | Hai nhánh: `held` (chưa gọi nhà cung cấp) → trả lại; `calling` (đã gọi – có thể đã tốn tiền) → quyết toán theo **ước tính**, dòng sổ `anomaly = 'unsettled'`, cảnh báo `ai.unsettled_reservation`. Thêm bước `markCalling` ngay trước mỗi lần gọi nhà cung cấp |
| 4 | ADD Cổng AI | Quyết toán | Kẹp trần `used = min(used + actual, cap − reserved)`; sổ ghi chi phí thực + `over_estimate`, `over_cap_micro_usd`; sự kiện 80/100% tạo trong **cùng giao dịch** quyết toán |
| 5 | ADD Worker | Bảng việc định kỳ + luồng xu hướng | Bỏ việc "Chia chi phí xu hướng dùng chung" và bước 3 của luồng xu hướng; việc trả giữ chỗ treo là việc tenant `ai_gateway.release_stale` hẹn trong giao dịch giữ chỗ (+ `ai_gateway.release_stale_system` mỗi phút cho ngân sách hệ thống) |
| 6 | Kiến trúc dữ liệu – bố cục kho tệp | `tmp/{jobId}/…` | `tenants/{accountId}/tmp/{jobId}/…` (mọi khóa trong tiền tố tài khoản – hiến pháp I); luật hết hạn 1 ngày lọc theo **nhãn** `lifecycle=tmp` (S3 không lọc được tiền tố có ký tự đại diện) |
| 7 | Kiến trúc dữ liệu / ADD Media | "presigned PUT" | Presigned **POST** (policy ràng buộc khóa chính xác, `Content-Type`, `content-length-range`, hạn ≤ 15 phút) |
| 8 | Lựa chọn công nghệ – dịch vụ dev | MinIO | Ảnh `minio/minio` không còn phát hành công khai; dev dùng `bitnamilegacy/minio:2025.4.22` (MinIO RELEASE 2025-04-22) + `bitnamilegacy/minio-client:2025.4.16`. Chỉ ảnh hưởng dev – môi trường thật dùng S3 của nhà cung cấp trong nước |

`.specify/memory/architecture.md` (được theo dõi trong git) đã sửa trong nhánh này: mục 6 (việc định kỳ),
7.2 (markCalling, kẹp trần, sự kiện trong giao dịch, giữ chỗ treo 2 nhánh, ngân sách hệ thống), 7.3 (POST
policy), mục 11 (thuật ngữ mới); bố cục kho tệp `tenants/{accountId}/tmp/{jobId}/…` đã kiểm lại.
