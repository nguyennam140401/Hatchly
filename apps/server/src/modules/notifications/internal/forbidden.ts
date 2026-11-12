// Kiểm trường bị cấm của sự kiện thông báo (005, R9, FR-044) – lớp thứ hai sau khuôn Zod `strictObject`:
// (1) tên trường chứa amount|usd|cost|price|token|password|secret|content|caption|body → từ chối;
// (2) chuỗi trong `params` trông như số tiền ($, USD, micro) → từ chối. Lỗi KHÔNG in giá trị.

const FORBIDDEN_KEY = /amount|usd|cost|price|token|password|secret|content|caption|body/i;
const MONEY_TEXT = /\$|USD|micro/i;

export class NotificationEventInvalidError extends Error {
  constructor(reason: 'schema' | 'forbidden_field' | 'money_text' | 'tx') {
    super(`Sự kiện thông báo không hợp lệ (${reason})`);
    this.name = 'NotificationEventInvalidError';
  }
}

function scanKeys(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(k)) return true;
    if (scanKeys(v)) return true;
  }
  return false;
}

/** Ném NotificationEventInvalidError khi sự kiện (thô, chưa kiểm khuôn) chứa trường/giá trị bị cấm. */
export function assertNoForbidden(raw: unknown): void {
  if (scanKeys(raw)) throw new NotificationEventInvalidError('forbidden_field');
  const params = (raw as { params?: unknown } | null)?.params;
  if (params !== null && typeof params === 'object') {
    for (const v of Object.values(params)) {
      if (typeof v === 'string' && MONEY_TEXT.test(v)) throw new NotificationEventInvalidError('money_text');
    }
  }
}
