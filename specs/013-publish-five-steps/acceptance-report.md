# Báo cáo nghiệm thu – 013 Đăng bài 5 bước (T092)

Phạm vi: US2 "Không bao giờ đăng trùng" (gồm "Đăng lại", FR-006), phân quyền/cô lập (FR-031) và các tiêu chí chống đăng trùng (SC-001, SC-008).
**T085 (kiểm chứng với Meta thật) cố ý để mở**: cần 010 đã merge, tài khoản thử Meta và staging; mọi kết quả dưới đây dùng bộ chuyển đổi giả lập (`PLATFORM_ADAPTER_MODE=fake`).

## 1. Kết quả `pnpm verify` (lần 1, đầy đủ, `TEST_DATABASE_ADMIN_URL` từ `apps/server/.env.example`)

| Bước | Kết quả |
|---|---|
| build:shared, typecheck, lint, check:boundaries, check:web-rules, check:secrets, check:pipeline | đạt |
| check:release-source, db:compat | không áp dụng (đích không phải master; không có migration mới) |
| test | lần 1 hỏng 1 ca `apps/web/test/posts/ComposePage.spec.tsx` (của 012); chạy riêng 11/11 đạt -> chập chờn khi tải nặng; xem mục 2 |
| check:web-bundle, db:lint-migrations, db:immutable | đạt |
| infra:check | bỏ qua (chưa cài terraform/tflint) |
| test:db | đạt (96 tệp đạt, 1 bỏ qua; 1028 ca đạt, 8 bỏ qua) |
| test:queue | lần 1 hỏng 1 ca `apps/server/test/queue/purge-account.queue.spec.ts:153` (của 003); chạy riêng 3/3 đạt -> chập chờn; xem mục 2 |
| check:secrets:test-logs, test:e2e, test:web-e2e, check:image | đạt (test:web-e2e không cần bổ sung mock) |

## 2. Hai ca chập chờn (không thuộc 013)

- `purge-account.queue.spec.ts:153`: kiểm toán `queue.account_jobs_purged` nhận thêm một dòng `{jobs:0, dead_jobs:0}` khi chạy cả bộ, chạy riêng đạt. Nghi do đua giữa Worker thử nghiệm và ca trước (không do mã 013; tệp này không bị đụng). Đề nghị PM giao dev 003 cân nhắc làm kiểm thử vững hơn (lọc theo thời điểm/lần gọi) nếu tái diễn.
- `ComposePage.spec.tsx` (012): hết thời gian/đua giao diện khi `pnpm test` chạy cả workspace.
- Kết quả chạy lại `pnpm verify --only test,test:queue`: xem mục "Chạy lại" cuối báo cáo.

## 3. Đối chiếu tiêu chí chấp nhận US2

Ký hiệu: Đạt = có kiểm thử trực tiếp và đã xanh; Gián tiếp = chỉ phủ qua kiểm thử khác.

| Tiêu chí | Kiểm thử | Kết quả |
|---|---|---|
| US2-1 tối đa một lượt hiệu lực mỗi (bài, kênh); tạo hai lần trả lượt hiện có | `apps/server/test/db/publishing-api.contract.db.spec.ts` (`schedule` hai lần, chỉ mục duy nhất `ux_publish_attempts_active_pair`) | Đạt |
| US2-2 hai Worker cùng nhận, chỉ một chiếm được, nền tảng nhận một bài | `queue/publishing/duplicate-guard.queue.spec.ts:47` | Đạt |
| US2-3 chết sau ghi dấu trước `submit` -> đối soát, không gửi lại; chết sau `submit` -> đối soát `succeeded`, bài giả = 1 | `duplicate-guard.queue.spec.ts:57, 66, 81, 90, 112, 121`; ràng buộc CSDL dấu nội dung `:128` | Đạt |
| US2-4 việc cũ giao lại khi lượt đã kết thúc: không tác dụng phụ | `duplicate-guard.queue.spec.ts:121` (chạy lại nhiều lần mọi giai đoạn), `execute-attempt.happy.queue.spec.ts` (chạy lại hai lần) | Đạt |
| US2-5 "Đăng lại" về `scheduled`, giờ = bây giờ, cùng lượt, ghi nhật ký người thao tác | `attempt-actions.queue.spec.ts:59` (một việc khóa `publish:{id}`, xóa dấu), `:246` (audit_log có `actor_id`, `trace_id`, metadata chỉ mã, `scheduled_at` ≈ now, `run_no` không đổi) | Đạt |
| FR-006 từ chối khi trạng thái khác (`processing`, `succeeded`, `retry_wait`, `unknown`) | `attempt-actions.queue.spec.ts:155, 293` (`unknown` -> `PUBLISH_NOT_REPUBLISHABLE`, không tạo việc); `:155` kênh đã đăng không có đường Đăng lại | Đạt (`processing`/`retry_wait` được phủ gián tiếp qua trạng thái "khác" cùng nhánh từ chối) |
| FR-006 hai yêu cầu đồng thời -> một thành công, một xung đột | `attempt-actions.queue.spec.ts:82`; HTTP `e2e/publish-progress.e2e.spec.ts:231` | Đạt |
| FR-006 phiên bản lệch -> `PUBLISH_VERSION_CONFLICT`, không đổi gì | `attempt-actions.queue.spec.ts:96` | Đạt |
| FR-006 `enqueue` trả `exists` -> hoàn tác toàn bộ (T087/T088, Hiến pháp V) | ca bổ sung trong `attempt-actions.queue.spec.ts` (T087) | Đạt |
| FR-006 cảnh báo `possible_duplicate` khi Đăng lại từ `needs_check` | `attempt-actions.queue.spec.ts:119` | Đạt |
| FR-021 "Đã đăng" chỉ từ `needs_check`, không gọi nền tảng, audit | `attempt-actions.queue.spec.ts:128, 155`; `e2e/publish-progress.e2e.spec.ts:256` | Đạt |
| FR-031 quyền: cộng tác viên Đăng lại/Đã đăng được, ghi đúng người | `e2e/publish-progress.e2e.spec.ts:317, 330` | Đạt |
| FR-031 hỗ trợ gọi API khách hàng bị từ chối, lượt không đổi (AS4 -> 401) | `e2e/publish-progress.e2e.spec.ts:344` | Đạt; kiểm thử hiện chấp nhận 401 hoặc 403 (không 2xx), xem mục "Rủi ro" |
| FR-031 / SC-008 cô lập tài khoản: A không đọc/sửa lượt và bước của B | `e2e/publish-progress.e2e.spec.ts:214` (404), `attempt-actions.queue.spec.ts:163`, `test/db/cross-tenant-coverage.db.spec.ts`, `test/db/publishing-api.contract.db.spec.ts` | Đạt |
| SC-001 0 bài trùng trong mọi kịch bản rủi ro | toàn bộ `duplicate-guard.queue.spec.ts`, `reconcile.queue.spec.ts`, `lifecycle.queue.spec.ts:83` (hết lượt thử sau khi đã gửi -> "Cần kiểm tra", không gửi lại), `error-handling.queue.spec.ts` (mã lạ không gửi lại) | Đạt |
| SC-008 0 lần mã quyền xuất hiện ở log, bước, thông báo, phản hồi | `queue/publishing/secret-scan.queue.spec.ts:124, 135, 146, 155`; `check:secrets:test-logs` | Đạt |
| Worker tắt có kiểm soát giữa `submit` không gửi lại (FR-011) | `duplicate-guard.queue.spec.ts:90`, `lifecycle.queue.spec.ts:83` | Đạt (gián tiếp: mô phỏng bằng hủy tín hiệu, chưa có kiểm thử tắt tiến trình thật) |

## 4. Không có kiểm thử tự động (tự thử thủ công)

- SC-006 (30 giây tìm ra bước hỏng, 8/10 người): cần người dùng đại diện; thử bằng cách mở một bài có lượt lỗi ở bước 2 trên bản giả lập và tính thời gian.
- Hành vi với Facebook/Instagram thật (hết thời gian sau khi nền tảng đã nhận, khả năng `reconcile`, hạn mức 24 giờ): chỉ làm được khi T085.

## 5. Rủi ro / ghi chú cho PM

- Ca hỗ trợ `e2e/publish-progress.e2e.spec.ts:344` đã được siết thành đúng 401 (AS4); bảng mục 3 ghi "chấp nhận 401|403" là trạng thái trước khi siết.
- Hai ca chập chờn ở mục 2 nằm ngoài 013 nhưng làm `pnpm verify` đỏ khi tải nặng.
- T085 mở: mọi số liệu thành công của 013 là trên bộ chuyển đổi giả; POC-2 (đọc lại bài đã đăng) chưa có bằng chứng thật.

## Chạy lại
- `pnpm verify --only test,test:queue`: **đạt 2/2** (test 76 s, test:queue 315 s) -> hai ca ở mục 2 là chập chờn, không còn đỏ.
- Đã siết `apps/server/test/e2e/publish-progress.e2e.spec.ts` (ca hỗ trợ) thành đúng 401 theo AS4; chạy riêng
  `vitest run --config vitest.db.config.mts test/e2e/publish-progress.e2e.spec.ts` -> 11/11 đạt.
- Kết luận: mọi cổng của `pnpm verify` xanh hoặc không áp dụng/bỏ qua có lý do (infra:check bỏ qua do thiếu terraform/tflint); T085 mở.
