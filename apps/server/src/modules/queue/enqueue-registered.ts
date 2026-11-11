// Lối vào riêng của `enqueueRegistered` (005, research R9a) – KHÔNG xuất qua index.ts: tạo việc theo tên
// lách được kiểm tra phụ thuộc giữa module, nên chỉ `modules/account` được nhập tệp này (quy tắc ranh giới
// `enqueue-registered-only-account`). Module khác dùng `enqueue(def, …)` của index.ts.
export { enqueueRegistered } from './internal/producer';
