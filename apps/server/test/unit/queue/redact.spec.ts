// 003 T016 – lược bí mật trước khi lưu lỗi/ghi nhật ký (R13, contracts/queue-observability.md mục 2).
import { describe, expect, it } from 'vitest';
import { payloadRef, redactError } from '../../../src/modules/queue/internal/redact';

describe('redactError', () => {
  it('giữ name, code; bỏ chuỗi kết nối, Bearer, access_token, giá trị password/secret/token', () => {
    const err = Object.assign(
      new Error(
        'kết nối postgres://u:p@h:5432/db lỗi; postgresql://x:y@z/db; Authorization: Bearer abc.def-123; ' +
          'url?access_token=EAAB123xyz&x=1 password=hunter2 secret: s3cr3t token="tok_9"',
      ),
      { code: 'E_TEST' },
    );
    err.name = 'FetchError';
    const r = redactError(err);
    expect(r.name).toBe('FetchError');
    expect(r.code).toBe('E_TEST');
    for (const leaked of [
      'u:p@h',
      'x:y@z',
      'abc.def-123',
      'EAAB123xyz',
      'hunter2',
      's3cr3t',
      'tok_9',
    ]) {
      expect(r.message).not.toContain(leaked);
    }
    expect(r.message).toContain('[đã che]');
  });

  it('chuỗi base64/hex liền ≥ 32 ký tự bị che; chuỗi ngắn giữ nguyên', () => {
    const hex = 'a'.repeat(20) + '0123456789abcdef0123';
    const b64 = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo0NTY3ODkw';
    const r = redactError(new Error(`k=${hex} b=${b64} ngắn=abc123`));
    expect(r.message).not.toContain(hex);
    expect(r.message).not.toContain(b64);
    expect(r.message).toContain('ngắn=abc123');
  });

  it('kết quả ≤ 2048 byte kể cả thông điệp rất dài; giá trị không phải Error vẫn an toàn', () => {
    const r = redactError(new Error('ồ'.repeat(5000)));
    expect(Buffer.byteLength(JSON.stringify(r), 'utf8')).toBeLessThanOrEqual(2048);
    expect(redactError('chuỗi lỗi')).toEqual({ name: 'Error', message: 'chuỗi lỗi' });
    expect(redactError(undefined)).toEqual({ name: 'Error', message: 'Lỗi không xác định' });
  });

  it('code không phải chuỗi ngắn an toàn → bỏ', () => {
    const r = redactError(Object.assign(new Error('x'), { code: 42 }));
    expect(r.code).toBeUndefined();
  });
});

describe('payloadRef', () => {
  it('chỉ giữ trường có tên kết thúc bằng Id', () => {
    expect(
      payloadRef({ attemptId: 'a1', mediaId: 'm1', title: 'bí mật', note: 'x', id: 'no', userid: 'no' }),
    ).toEqual({ attemptId: 'a1', mediaId: 'm1' });
    expect(payloadRef(null)).toEqual({});
  });
});
