// Cổng "gói có cho tải lên không" (014 R12, contracts/media-public-api.md mục 3) – NỘI BỘ `media`, chưa công khai.
// Bản mặc định luôn cho phép: WBS 2.6 (dữ liệu gói) sẽ thay bằng bản hỏi `AccountPublicApi`. Điều kiện chặn chỉ
// áp cho BẮT ĐẦU tải; xem/xóa/soạn/duyệt/đăng không qua cổng (nguyên tắc VI: không chặn người dùng khi không cần).

export type UploadGateResult =
  { allowed: true } | { allowed: false; reason: 'plan_expired' | 'account_suspended' };

export interface UploadGate {
  canUpload(): Promise<UploadGateResult>;
}

/** Token NestJS của UploadGate. */
export const UPLOAD_GATE = Symbol('UPLOAD_GATE');

export const defaultUploadGate: UploadGate = {
  canUpload: () => Promise.resolve({ allowed: true }),
};
