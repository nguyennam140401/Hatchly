import { describe, expect, it } from 'vitest';
import {
  buildQuota,
  ListQuery,
  MEDIA_ERROR_CODES,
  MEDIA_ERRORS,
  MEDIA_LIMITS,
  MEDIA_QUOTA_BYTES_DEFAULT,
  PartUrlsBody,
  StartUploadBody,
  UNPROCESSABLE_CODES,
  UNPROCESSABLE_MESSAGES,
  UPLOAD_REJECT_CODES,
  UPLOAD_REJECT_MESSAGES,
  mediaKindOf,
  partCountOf,
  uploadModeOf,
} from '../src/modules/media/index.js';

const FP = 'a'.repeat(64);
const MIB = 1024 * 1024;

describe('StartUploadBody (FR-003)', () => {
  const ok = { fileName: 'a.jpg', sizeBytes: 1000, contentType: 'image/jpeg', fingerprint: FP };

  it('nhận thân hợp lệ', () => {
    expect(StartUploadBody.safeParse(ok).success).toBe(true);
  });

  it('từ chối trường lạ (không nhận mã tài khoản từ client – nguyên tắc I)', () => {
    expect(StartUploadBody.safeParse({ ...ok, accountId: 'x' }).success).toBe(false);
  });

  it('từ chối fingerprint sai định dạng', () => {
    for (const fingerprint of ['abc', 'A'.repeat(64), 'g'.repeat(64), `${FP}0`]) {
      expect(StartUploadBody.safeParse({ ...ok, fingerprint }).success, fingerprint).toBe(false);
    }
  });

  it('từ chối loại không nhận, dung lượng ≤ 0, tên rỗng/quá dài', () => {
    expect(StartUploadBody.safeParse({ ...ok, contentType: 'image/gif' }).success).toBe(false);
    expect(StartUploadBody.safeParse({ ...ok, contentType: 'image/svg+xml' }).success).toBe(false);
    expect(StartUploadBody.safeParse({ ...ok, sizeBytes: 0 }).success).toBe(false);
    expect(StartUploadBody.safeParse({ ...ok, sizeBytes: 1.5 }).success).toBe(false);
    expect(StartUploadBody.safeParse({ ...ok, fileName: '' }).success).toBe(false);
    expect(StartUploadBody.safeParse({ ...ok, fileName: 'x'.repeat(256) }).success).toBe(false);
  });
});

describe('PartUrlsBody', () => {
  it('chỉ nhận 1–20 phần, số phần ≥ 1', () => {
    expect(PartUrlsBody.safeParse({ partNumbers: [1] }).success).toBe(true);
    expect(
      PartUrlsBody.safeParse({ partNumbers: Array.from({ length: 20 }, (_, i) => i + 1) }).success,
    ).toBe(true);
    expect(PartUrlsBody.safeParse({ partNumbers: [] }).success).toBe(false);
    expect(
      PartUrlsBody.safeParse({ partNumbers: Array.from({ length: 21 }, (_, i) => i + 1) }).success,
    ).toBe(false);
    expect(PartUrlsBody.safeParse({ partNumbers: [0] }).success).toBe(false);
    expect(PartUrlsBody.safeParse({ partNumbers: [1], x: 1 }).success).toBe(false);
  });
});

describe('ListQuery', () => {
  it('mặc định limit 40, tối đa 60, q ≤ 100 ký tự', () => {
    expect(ListQuery.parse({}).limit).toBe(40);
    expect(ListQuery.safeParse({ limit: '61' }).success).toBe(false);
    expect(ListQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(ListQuery.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(ListQuery.safeParse({ kind: 'audio' }).success).toBe(false);
    expect(ListQuery.safeParse({ accountId: 'x' }).success).toBe(false);
  });
});

describe('Quota (FR-010)', () => {
  const limit = 100;
  it('percent = floor((used + reserved) / limit × 100); ngưỡng 79/80/99/100%', () => {
    expect(buildQuota(79, 0, limit)).toMatchObject({ percent: 79, state: 'ok' });
    expect(buildQuota(80, 0, limit)).toMatchObject({ percent: 80, state: 'near_full' });
    expect(buildQuota(50, 30, limit)).toMatchObject({ percent: 80, state: 'near_full' });
    expect(buildQuota(99, 0, limit)).toMatchObject({ percent: 99, state: 'near_full' });
    expect(buildQuota(60, 40, limit)).toMatchObject({ percent: 100, state: 'full' });
    expect(buildQuota(0, 0, limit)).toMatchObject({ percent: 0, state: 'ok' });
  });

  it('chưa có dòng ⇒ 0/0/5 GiB', () => {
    expect(buildQuota(0, 0, MEDIA_QUOTA_BYTES_DEFAULT)).toMatchObject({
      percent: 0,
      state: 'ok',
      limitBytes: 5 * 1024 ** 3,
    });
  });
});

describe('hằng số khớp data-model.md mục 5', () => {
  it('MEDIA_LIMITS', () => {
    expect(MEDIA_LIMITS).toEqual({
      imageMaxBytes: 20 * MIB,
      videoMaxBytes: 500 * MIB,
      imageMaxPixels: 50_000_000,
      singleUploadMaxBytes: 8 * MIB,
      partSizeBytes: 8 * MIB,
      sessionTtlSec: 86_400,
      parallelUploads: 3,
      normalizedMaxEdge: 2048,
      thumbMaxEdge: 480,
      normalizedQuality: 82,
      thumbQuality: 75,
      nearFullPercent: 80,
    });
    expect(MEDIA_QUOTA_BYTES_DEFAULT).toBe(5 * 1024 ** 3);
  });

  it('chế độ tải và số phần', () => {
    expect(uploadModeOf(8 * MIB)).toBe('single');
    expect(uploadModeOf(8 * MIB + 1)).toBe('multipart');
    expect(partCountOf(8 * MIB + 1)).toBe(2);
    expect(partCountOf(300 * MIB)).toBe(38);
  });

  it('mediaKindOf', () => {
    expect(mediaKindOf('image/heic')).toBe('image');
    expect(mediaKindOf('video/quicktime')).toBe('video');
    expect(mediaKindOf('image/gif')).toBeNull();
  });
});

describe('thông điệp lỗi (nguyên tắc VI)', () => {
  it('mỗi mã lỗi có thông điệp tiếng Việt và ≥ 1 hành động', () => {
    for (const code of MEDIA_ERROR_CODES) {
      const info = MEDIA_ERRORS[code];
      expect(info.message.length, code).toBeGreaterThan(10);
      expect(info.actions.length, code).toBeGreaterThanOrEqual(1);
      expect(info.message, code).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
    }
  });

  it('mỗi failure_code có tiêu đề + cách khắc phục', () => {
    for (const code of UNPROCESSABLE_CODES) {
      expect(UNPROCESSABLE_MESSAGES[code].title, code).toBeTruthy();
      expect(UNPROCESSABLE_MESSAGES[code].action, code).toBeTruthy();
    }
    for (const code of UPLOAD_REJECT_CODES) {
      expect(UPLOAD_REJECT_MESSAGES[code].action, code).toBeTruthy();
    }
  });
});
