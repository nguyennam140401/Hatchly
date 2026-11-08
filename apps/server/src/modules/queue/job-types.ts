// Khai báo loại việc và sổ đăng ký trong tiến trình (contracts/queue-api.md mục 1, research R13).
// Khai báo đặt trong `modules/<owner>/jobs.ts`, dùng ở cả API (tạo việc) và Worker (xử lý).
import { z } from 'zod';
import { queueError } from './internal/errors';
import { QUEUE_NAMES, type JobScope, type JobTypeDefinition, type QueueName } from './public-api';

/** Trần kích thước phong bì việc (FR-012). */
export const MAX_ENVELOPE_BYTES = 8192;
/** Trần độ dài trường chuỗi trong dữ liệu việc. */
export const MAX_STRING_LENGTH = 2048;

/**
 * Số lần thử lại mặc định của từng hàng chờ (bảng "Key Entities" của spec – trùng giá trị khởi tạo
 * của infra.queue_settings). Loại việc chỉ được ghi đè THẤP hơn; lúc chạy còn kẹp theo thông số CSDL.
 */
export const QUEUE_DEFAULT_MAX_RETRIES: Readonly<Record<QueueName, number>> = {
  publish: 5,
  media: 3,
  ai_batch: 2,
  trends: 3,
  notify: 5,
  scheduled: 0,
};

const NAME_PATTERN = /^[a-z_]+\.[a-z_]+$/;

/** Tên trường bị cấm (không phân biệt hoa thường, bỏ `_`): nội dung, bí mật, mã tài khoản (R13). */
const FORBIDDEN_FIELDS = new Set([
  'content',
  'body',
  'caption',
  'text',
  'prompt',
  'message',
  'token',
  'accesstoken',
  'secret',
  'password',
  'accountid',
  'tenantid',
]);

/** Định dạng chuỗi tự giới hạn độ dài – không cần `.max()`. */
const BOUNDED_STRING_FORMATS = new Set([
  'uuid',
  'guid',
  'ulid',
  'cuid',
  'cuid2',
  'nanoid',
  'datetime',
  'date',
  'time',
  'ipv4',
  'ipv6',
]);

/** Kiểu không duyệt được tên trường / không giới hạn được kích thước. */
const OPAQUE_TYPES = new Set(['record', 'map', 'any', 'unknown', 'custom', 'lazy', 'promise']);

type AnySchema = z.ZodType & {
  def: { type: string; catchall?: { def: { type: string } } };
};

function fail(name: string, detail: string): never {
  throw new Error(`Loại việc ${name}: ${detail}`);
}

/** Duyệt cây khuôn Zod: tên trường bị cấm, chuỗi không giới hạn, kiểu không kiểm được. */
function inspectSchema(jobName: string, schema: AnySchema, path: string): void {
  const type = schema.def.type;
  if (OPAQUE_TYPES.has(type)) {
    fail(jobName, `trường ${path || '(gốc)'} có kiểu "${type}" không kiểm được tên trường/kích thước`);
  }
  switch (type) {
    case 'object': {
      const shape = (schema as unknown as z.ZodObject).shape;
      for (const [key, child] of Object.entries(shape)) {
        const childPath = path === '' ? key : `${path}.${key}`;
        if (FORBIDDEN_FIELDS.has(key.toLowerCase().replace(/_/g, ''))) {
          fail(
            jobName,
            `trường "${childPath}" bị cấm trong dữ liệu việc – chỉ gửi mã tham chiếu, không gửi nội dung/bí mật/mã tài khoản`,
          );
        }
        inspectSchema(jobName, child as AnySchema, childPath);
      }
      return;
    }
    case 'array':
      inspectSchema(jobName, (schema as unknown as z.ZodArray).element as AnySchema, `${path}[]`);
      return;
    case 'optional':
    case 'nullable':
    case 'default':
    case 'readonly':
    case 'nonoptional':
      inspectSchema(
        jobName,
        (schema as unknown as { unwrap: () => AnySchema }).unwrap(),
        path,
      );
      return;
    case 'union':
      for (const option of (schema as unknown as z.ZodUnion).options) {
        inspectSchema(jobName, option as AnySchema, path);
      }
      return;
    case 'string': {
      const str = schema as unknown as z.ZodString;
      if (str.format !== null && BOUNDED_STRING_FORMATS.has(str.format)) return;
      if (str.maxLength === null) {
        fail(jobName, `trường chuỗi ${path} phải có .max() (≤ ${MAX_STRING_LENGTH})`);
      }
      if (str.maxLength > MAX_STRING_LENGTH) {
        fail(jobName, `trường chuỗi ${path} có .max() > ${MAX_STRING_LENGTH}`);
      }
      return;
    }
    default:
      // number, boolean, enum, literal, date, bigint, null… – không mang nội dung tự do.
      return;
  }
}

const registry = new Map<string, JobTypeDefinition<unknown>>();

export interface DefineJobTypeInput<P extends z.ZodObject> {
  name: string;
  queue: QueueName;
  scope: JobScope;
  payload: P;
  version: number;
  migrate?: (payload: unknown, fromVersion: number) => z.input<P>;
  maxPayloadBytes?: number;
  allowGenericRetry?: boolean;
  retry?: { maxRetries?: number; delaysSeconds?: number[] };
}

/** Khai báo một loại việc (lúc khởi động). Sai quy tắc → ném ngay, không để tới lúc chạy. */
export function defineJobType<P extends z.ZodObject>(
  def: DefineJobTypeInput<P>,
): JobTypeDefinition<z.output<P>> {
  const { name } = def;
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Tên loại việc "${name}" phải dạng <module>.<action> (chữ thường, gạch dưới)`);
  }
  if (registry.has(name)) throw new Error(`Loại việc ${name} đã được khai báo`);
  if (!(QUEUE_NAMES as readonly string[]).includes(def.queue)) {
    fail(name, `hàng chờ "${def.queue}" không tồn tại`);
  }
  if (def.scope !== 'tenant' && def.scope !== 'system') fail(name, 'scope phải là tenant | system');
  if (!Number.isInteger(def.version) || def.version < 1) {
    fail(name, 'version phải là số nguyên ≥ 1');
  }
  const schema = def.payload as unknown as AnySchema;
  if (schema.def.type !== 'object' || schema.def.catchall?.def.type !== 'never') {
    fail(name, 'khuôn dữ liệu phải là z.strictObject(...)');
  }
  inspectSchema(name, schema, '');

  const maxPayloadBytes = def.maxPayloadBytes ?? MAX_ENVELOPE_BYTES;
  if (!Number.isInteger(maxPayloadBytes) || maxPayloadBytes < 256 || maxPayloadBytes > MAX_ENVELOPE_BYTES) {
    fail(name, `maxPayloadBytes phải trong khoảng 256–${MAX_ENVELOPE_BYTES}`);
  }
  // Clarifications Q1: việc đăng bài chỉ được "Đăng lại" qua luồng lượt đăng (đối soát trước).
  if (def.queue === 'publish' && def.allowGenericRetry !== false) {
    fail(name, "hàng chờ 'publish' bắt buộc allowGenericRetry: false (không chạy lại chung)");
  }
  if (def.retry !== undefined) {
    const { maxRetries, delaysSeconds } = def.retry;
    const ceiling = QUEUE_DEFAULT_MAX_RETRIES[def.queue];
    if (
      maxRetries !== undefined &&
      (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > ceiling)
    ) {
      fail(name, `retry.maxRetries phải trong khoảng 0–${ceiling} (mặc định của hàng chờ ${def.queue})`);
    }
    if (
      delaysSeconds !== undefined &&
      (delaysSeconds.length === 0 ||
        delaysSeconds.some((d) => !Number.isInteger(d) || d < 1 || d > 86_400))
    ) {
      fail(name, 'retry.delaysSeconds phải là mảng không rỗng các số nguyên 1–86400');
    }
  }

  const definition: JobTypeDefinition<z.output<P>> = Object.freeze({
    name,
    queue: def.queue,
    scope: def.scope,
    payload: def.payload as unknown as z.ZodType<z.output<P>>,
    version: def.version,
    migrate: def.migrate,
    maxPayloadBytes,
    allowGenericRetry: def.allowGenericRetry ?? true,
    retry: def.retry === undefined ? undefined : Object.freeze({ ...def.retry }),
  });
  registry.set(name, definition as JobTypeDefinition<unknown>);
  return definition;
}

/** Loại việc theo tên (Worker giải phong bì); undefined khi chưa khai báo trong tiến trình này. */
export function getJobType(name: string): JobTypeDefinition<unknown> | undefined {
  return registry.get(name);
}

/** Mọi loại việc đã khai báo (kiểm thử, tài liệu). */
export function listJobTypes(): JobTypeDefinition<unknown>[] {
  return [...registry.values()];
}

/** Kiểm dữ liệu theo khuôn của loại việc → giá trị đã kiểm; sai → `QUEUE_PAYLOAD_INVALID`. */
export function validatePayload<P>(def: JobTypeDefinition<P>, payload: unknown): P {
  const result = def.payload.safeParse(payload);
  if (!result.success) throw queueError('QUEUE_PAYLOAD_INVALID');
  return result.data;
}

/** Nâng dữ liệu phiên bản cũ (`v` < version) bằng `migrate` của loại việc rồi kiểm khuôn (R13). */
export function upgradePayload<P>(def: JobTypeDefinition<P>, payload: unknown, fromVersion: number): P {
  let value = payload;
  if (fromVersion < def.version && def.migrate !== undefined) value = def.migrate(payload, fromVersion);
  return validatePayload(def, value);
}
