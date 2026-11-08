// Lược bí mật (research R13): dùng cho infra.dead_jobs.last_error và nhật ký của lớp hàng chờ.
// Không bao giờ để lọt chuỗi kết nối, mã quyền truy cập, mật khẩu, khóa (nguyên tắc VII, SC-011).

export interface RedactedError {
  name: string;
  code?: string;
  message: string;
}

const MASK = '[đã che]';
const MAX_BYTES = 2048;

const PATTERNS: [RegExp, string][] = [
  // Chuỗi kết nối CSDL (cả dạng không có thông tin đăng nhập).
  [/postgres(?:ql)?:\/\/\S+/gi, MASK],
  // Tiêu đề xác thực.
  [/\b(Bearer|Basic)\s+[^\s,;"']+/gi, `$1 ${MASK}`],
  // Tham số truy vấn mang mã quyền.
  [/([?&](?:access_token|refresh_token|token|signature|sig|key|api_key)=)[^&\s"']+/gi, `$1${MASK}`],
  // Cặp khóa = giá trị / khóa: giá trị.
  [
    /\b([a-z_]*(?:password|passwd|pwd|secret|token|api[_-]?key)[a-z_]*)(["']?\s*[:=]\s*["']?)[^\s,;"'&}]+/gi,
    `$1$2${MASK}`,
  ],
  // Chuỗi base64/hex liền dài (khóa, chữ ký, mã thông báo).
  [/[A-Za-z0-9+/_-]{32,}={0,2}/g, MASK],
];

/** Lược mọi mẫu bí mật trong một chuỗi. */
export function redactText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let end = Math.min(text.length, maxBytes);
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes - 3) end--;
  return `${text.slice(0, end)}…`;
}

const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
const SAFE_NAME = /^[A-Za-z0-9_$.]{1,64}$/;

/** `{ name, code?, message }` đã lược bí mật, ≤ 2 KB khi tuần tự hóa JSON. */
export function redactError(err: unknown): RedactedError {
  let name = 'Error';
  let message = 'Lỗi không xác định';
  let code: string | undefined;
  if (err instanceof Error) {
    if (SAFE_NAME.test(err.name)) name = err.name;
    message = err.message === '' ? name : err.message;
    const rawCode = (err as { code?: unknown }).code;
    if (typeof rawCode === 'string' && SAFE_CODE.test(rawCode)) code = rawCode;
    // AppError giữ mã gốc ở `detail` (vd QUEUE_PAYLOAD_INVALID).
    const detail = (err as { detail?: unknown }).detail;
    if (code === undefined && typeof detail === 'string' && SAFE_CODE.test(detail)) code = detail;
  } else if (typeof err === 'string' && err !== '') {
    message = err;
  }
  const head: RedactedError =
    code === undefined ? { name, message: '' } : { name, code, message: '' };
  const budget = MAX_BYTES - Buffer.byteLength(JSON.stringify(head), 'utf8');
  // JSON có thể phình ký tự thoát; chừa thêm biên.
  head.message = truncateUtf8(redactText(message), Math.max(64, Math.floor(budget * 0.9)));
  while (Buffer.byteLength(JSON.stringify(head), 'utf8') > MAX_BYTES) {
    head.message = truncateUtf8(head.message, Math.floor(Buffer.byteLength(head.message) * 0.8));
  }
  return head;
}

/** Tham chiếu dữ liệu việc cho nhật ký: CHỈ các trường tên kết thúc bằng `Id` (vd `attemptId`). */
export function payloadRef(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null) return {};
  const ref: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (/[a-z0-9]Id$/.test(key) && (typeof value === 'string' || typeof value === 'number')) {
      ref[key] = value;
    }
  }
  return ref;
}
