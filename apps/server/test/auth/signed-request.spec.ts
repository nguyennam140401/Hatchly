import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseSignedRequest } from '../../src/modules/account/internal/auth/meta-callbacks.service';
import { makeSignedRequest } from '../support/make-signed-request';

// T079 (009, FR-009a, research R15): kiểm chữ ký `signed_request` của Meta.

const SECRET = 'bi-mat-ung-dung-thu';

function sign(payloadB64: string, secret = SECRET): string {
  return `${createHmac('sha256', secret).update(payloadB64).digest('base64url')}.${payloadB64}`;
}
const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64url');

describe('parseSignedRequest', () => {
  it('hợp lệ → trả mã người dùng', () => {
    expect(parseSignedRequest(makeSignedRequest('1234567890', SECRET), SECRET)).toEqual({
      userId: '1234567890',
    });
    // Tên thuật toán không phân biệt hoa thường.
    expect(
      parseSignedRequest(makeSignedRequest('42', SECRET, { algorithm: 'hmac-sha256' }), SECRET),
    ).toEqual({ userId: '42' });
  });

  it('sai chữ ký một ký tự → từ chối', () => {
    const good = makeSignedRequest('1', SECRET);
    const flipped = (good.startsWith('A') ? 'B' : 'A') + good.slice(1);
    expect(parseSignedRequest(flipped, SECRET)).toBeNull();
    // Ký bằng bí mật khác.
    expect(parseSignedRequest(makeSignedRequest('1', 'bi-mat-khac'), SECRET)).toBeNull();
    // Sửa tải nhưng giữ chữ ký cũ.
    const [sig] = good.split('.');
    const forged = `${sig}.${b64(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '2' }))}`;
    expect(parseSignedRequest(forged, SECRET)).toBeNull();
  });

  it('thiếu dấu chấm, thừa dấu chấm, base64url hỏng, JSON hỏng → từ chối', () => {
    for (const raw of ['', 'khongcodaucham', '.abc', 'abc.', 'a.b.c', '!!!.###', 'abc.d+f/']) {
      expect(parseSignedRequest(raw, SECRET), raw).toBeNull();
    }
    expect(parseSignedRequest(sign(b64('không phải JSON')), SECRET)).toBeNull();
    expect(parseSignedRequest(sign(b64('"chuỗi"')), SECRET)).toBeNull();
  });

  it('thuật toán khác HMAC-SHA256 hoặc thiếu user_id → từ chối dù chữ ký đúng', () => {
    expect(
      parseSignedRequest(makeSignedRequest('1', SECRET, { algorithm: 'none' }), SECRET),
    ).toBeNull();
    expect(
      parseSignedRequest(makeSignedRequest('1', SECRET, { algorithm: undefined }), SECRET),
    ).toBeNull();
    expect(
      parseSignedRequest(sign(b64(JSON.stringify({ algorithm: 'HMAC-SHA256' }))), SECRET),
    ).toBeNull();
    expect(
      parseSignedRequest(makeSignedRequest('1', SECRET, { user_id: 12345 }), SECRET),
    ).toBeNull();
  });

  it('chữ ký có độ dài khác (so sánh hằng thời gian không ném lỗi); đầu vào không phải chuỗi', () => {
    const payload = b64(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '1' }));
    expect(parseSignedRequest(`${b64('ngan')}.${payload}`, SECRET)).toBeNull();
    expect(parseSignedRequest(`${'A'.repeat(200)}.${payload}`, SECRET)).toBeNull();
    for (const raw of [undefined, null, 123, {}, ['a.b']]) {
      expect(parseSignedRequest(raw, SECRET)).toBeNull();
    }
    expect(parseSignedRequest(`${'a'.repeat(5000)}.b`, SECRET)).toBeNull();
  });
});
