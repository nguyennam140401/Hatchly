// 003 T014 – kiểm khuôn khai báo loại việc (R13, FR-012, Clarifications Q1).
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineJobType, getJobType, validatePayload } from '../../../src/modules/queue/job-types';

let seq = 0;
/** Tên duy nhất cho mỗi khai báo trong tệp (sổ đăng ký dùng chung trong tiến trình). */
const uniq = () => `unit_test.job_${String.fromCharCode(97 + (seq++ % 26))}${'x'.repeat(seq)}`;

const base = () => ({
  name: uniq(),
  queue: 'media' as const,
  scope: 'tenant' as const,
  version: 1,
  payload: z.strictObject({ mediaId: z.uuid() }),
});

describe('defineJobType', () => {
  it('khai báo hợp lệ → lấy lại được theo tên, mặc định 8192 byte, cho chạy lại chung', () => {
    const def = defineJobType(base());
    expect(getJobType(def.name)).toBe(def);
    expect(def.maxPayloadBytes).toBe(8192);
    expect(def.allowGenericRetry).toBe(true);
  });

  it.each(['Media.process', 'media', 'media.process.extra', 'media-x.process', 'media.process1'])(
    'tên sai định dạng %s → ném',
    (name) => {
      expect(() => defineJobType({ ...base(), name })).toThrow(/Tên loại việc/);
    },
  );

  it('khai báo trùng tên → ném', () => {
    const def = defineJobType(base());
    expect(() => defineJobType({ ...base(), name: def.name })).toThrow(/đã được khai báo/);
  });

  it('khuôn không phải z.strictObject → ném', () => {
    expect(() =>
      defineJobType({ ...base(), payload: z.object({ mediaId: z.uuid() }) as never }),
    ).toThrow(/strictObject/);
  });

  it.each([
    'content',
    'body',
    'caption',
    'text',
    'prompt',
    'message',
    'token',
    'access_token',
    'accessToken',
    'secret',
    'password',
    'account_id',
    'accountId',
    'tenantId',
    'TENANT_ID',
  ])('trường bị cấm "%s" ở cấp đầu → ném', (field) => {
    expect(() =>
      defineJobType({ ...base(), payload: z.strictObject({ [field]: z.string().max(10) }) }),
    ).toThrow(/bị cấm/);
  });

  it('trường bị cấm lồng sâu (mảng → đối tượng → tùy chọn) → ném', () => {
    expect(() =>
      defineJobType({
        ...base(),
        payload: z.strictObject({
          items: z.array(z.object({ meta: z.object({ Caption: z.string().max(5) }).optional() })),
        }),
      }),
    ).toThrow(/items\[\]\.meta\.Caption/);
  });

  it('chuỗi không có .max() → ném; .max() > 2048 → ném; uuid không cần .max()', () => {
    expect(() =>
      defineJobType({ ...base(), payload: z.strictObject({ note: z.string() }) }),
    ).toThrow(/\.max\(\)/);
    expect(() =>
      defineJobType({ ...base(), payload: z.strictObject({ note: z.string().max(4096) }) }),
    ).toThrow(/2048/);
    expect(() =>
      defineJobType({
        ...base(),
        payload: z.strictObject({ id: z.uuid(), note: z.string().max(2048).nullable() }),
      }),
    ).not.toThrow();
  });

  it('kiểu không giới hạn được tên trường (record/any/unknown) → ném', () => {
    expect(() =>
      defineJobType({
        ...base(),
        payload: z.strictObject({ bag: z.record(z.string().max(5), z.number()) }),
      }),
    ).toThrow(/không kiểm được/);
    expect(() => defineJobType({ ...base(), payload: z.strictObject({ x: z.any() }) })).toThrow(
      /không kiểm được/,
    );
  });

  it('maxPayloadBytes > 8192 → ném', () => {
    expect(() => defineJobType({ ...base(), maxPayloadBytes: 8193 })).toThrow(/8192/);
  });

  it("queue 'publish' mà allowGenericRetry khác false → ném (Q1); false → hợp lệ", () => {
    const pub = { ...base(), queue: 'publish' as const };
    expect(() => defineJobType(pub)).toThrow(/allowGenericRetry/);
    expect(() => defineJobType({ ...pub, name: uniq(), allowGenericRetry: true })).toThrow(
      /allowGenericRetry/,
    );
    const ok = defineJobType({ ...pub, name: uniq(), allowGenericRetry: false });
    expect(ok.allowGenericRetry).toBe(false);
  });

  it('retry.maxRetries vượt mặc định của hàng chờ → ném; trong giới hạn → giữ', () => {
    // media mặc định 3 lần thử lại.
    expect(() => defineJobType({ ...base(), retry: { maxRetries: 4 } })).toThrow(/maxRetries/);
    const def = defineJobType({ ...base(), retry: { maxRetries: 1, delaysSeconds: [5] } });
    expect(def.retry).toEqual({ maxRetries: 1, delaysSeconds: [5] });
    expect(() => defineJobType({ ...base(), retry: { delaysSeconds: [0] } })).toThrow(
      /delaysSeconds/,
    );
  });

  it('version phải là số nguyên ≥ 1', () => {
    expect(() => defineJobType({ ...base(), version: 0 })).toThrow(/version/);
  });
});

describe('validatePayload', () => {
  it('đúng khuôn → giá trị đã kiểm; sai khuôn → QUEUE_PAYLOAD_INVALID', () => {
    const def = defineJobType(base());
    const id = '01890000-0000-7000-8000-000000000000';
    expect(validatePayload(def, { mediaId: id })).toEqual({ mediaId: id });
    expect(() => validatePayload(def, { mediaId: 'x' })).toThrow(
      expect.objectContaining({ detail: 'QUEUE_PAYLOAD_INVALID' }),
    );
    expect(() => validatePayload(def, { mediaId: id, extra: 1 })).toThrow(
      expect.objectContaining({ detail: 'QUEUE_PAYLOAD_INVALID' }),
    );
  });
});
