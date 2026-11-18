import { registerAccountDataCleaner } from '../session/clear-account-data';

// Bản nháp biểu mẫu CHỈ TRONG RAM của tab (FR-017): `Map` mức mô-đun, không ghi nơi nào khác. Khóa = `${user.id}:${formKey}`
// tính từ phiên. Trường nhạy cảm (mật khẩu, mã, tệp) không bao giờ vào bản nháp.

export interface FormDraft {
  formKey: string;
  value: Record<string, unknown>;
  savedAt: number;
  /** user.id của người đang nhập – chỉ khôi phục khi khớp. */
  subject: string;
}

const drafts = new Map<string, FormDraft>();

const SENSITIVE_NAME = /pass(word)?|secret|token|otp|code|pin|file|upload|card/i;

function keyOf(subject: string, formKey: string): string {
  return `${subject}:${formKey}`;
}

/** Loại trường nhạy cảm (theo tên) khỏi giá trị trước khi lưu. `extra`: tên trường được khai báo thêm. */
export function stripSensitive(
  value: Record<string, unknown>,
  extra: readonly string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(value)) {
    if (extra.includes(name) || SENSITIVE_NAME.test(name)) continue;
    out[name] = v;
  }
  return out;
}

export const draftStore = {
  save(
    subject: string,
    formKey: string,
    value: Record<string, unknown>,
    sensitive: readonly string[] = [],
  ): void {
    drafts.set(keyOf(subject, formKey), {
      formKey,
      value: stripSensitive(value, sensitive),
      savedAt: Date.now(),
      subject,
    });
  },
  load(subject: string, formKey: string): FormDraft | undefined {
    const draft = drafts.get(keyOf(subject, formKey));
    return draft?.subject === subject ? draft : undefined;
  },
  clear(subject: string, formKey: string): void {
    drafts.delete(keyOf(subject, formKey));
  },
  clearAll(): void {
    drafts.clear();
  },
  /** Chỉ cho kiểm thử: đọc toàn bộ nội dung kho. */
  snapshot(): FormDraft[] {
    return [...drafts.values()];
  },
};

// Đăng xuất / đổi tài khoản / nhận sự kiện từ tab khác → xóa sạch mọi bản nháp.
registerAccountDataCleaner(() => {
  draftStore.clearAll();
});
