import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { inspect } from 'node:util';

// Kho mã quyền nội bộ của Cổng nền tảng (005, R2, nguyên tắc VII). Chỉ module này giải mã; bộ chuyển đổi
// nhận `DecryptedCredential` – kiểu có nhãn chỉ tạo được bởi `CredentialVault.decrypt`, in ra/JSON luôn
// là "[credential]" nên không lọt vào nhật ký, lỗi hay phản hồi. Bản thật (WBS 2.2) dùng khóa KMS.

const BRAND: unique symbol = Symbol('DecryptedCredential');
const SECRET = new WeakMap<object, string>();

export interface DecryptedCredential {
  readonly [BRAND]: true;
  toJSON(): string;
}

function makeCredential(token: string): DecryptedCredential {
  const cred = {
    [BRAND]: true as const,
    toJSON: () => '[credential]',
    toString: () => '[credential]',
    [inspect.custom]: () => '[credential]',
  };
  SECRET.set(cred, token);
  return Object.freeze(cred);
}

/** Đọc mã quyền thô – CHỈ bộ chuyển đổi gọi, ngay trước khi gửi nền tảng. */
export function revealCredential(cred: DecryptedCredential): string {
  const token = SECRET.get(cred);
  if (token === undefined) throw new Error('Mã quyền không hợp lệ');
  return token;
}

/**
 * Dữ liệu xác thực kèm (AAD) của bản mã: ràng buộc bản mã với đúng tài khoản + mục đích + kênh. Đem bản mã sang tài
 * khoản/kênh khác (hoặc đổi chỗ mã quyền ↔ mã làm mới) thì giải mã THẤT BẠI (nguyên tắc I, VII).
 * `ref` = `channelType:externalId` – ổn định khi bản mã đi từ phiên chọn Page sang kết nối và khi kết nối lại tại chỗ.
 */
export type CredentialPurpose = 'token' | 'refresh';

export function credentialAad(
  accountId: string,
  purpose: CredentialPurpose,
  channelType: string,
  externalId: string,
): string {
  return `${accountId}|${purpose}|${channelType}:${externalId}`;
}

export interface CredentialVault {
  encrypt(token: string, aad: string): Promise<Buffer>;
  decrypt(ciphertext: Buffer, aad: string): Promise<DecryptedCredential>;
}

/** Tạo `DecryptedCredential` – CHỈ các bản hiện thực vault gọi. */
export function wrapDecrypted(token: string): DecryptedCredential {
  return makeCredential(token);
}

/**
 * Bản giả CHỈ dev/test: AES-256-GCM với khóa dev cố định (không phải bí mật – dữ liệu là mã quyền giả).
 * Cùng điểm bảo vệ như bản thật: mã quyền không bao giờ rời khỏi vault ở dạng rõ; AAD cũng được kiểm để lỗi nối dây
 * AAD lộ ra ngay ở môi trường dev/test.
 */
export class FakeCredentialVault implements CredentialVault {
  private readonly key = createHash('sha256').update('app-dev-only-fake-credential-vault').digest();

  encrypt(token: string, aad: string): Promise<Buffer> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return Promise.resolve(Buffer.concat([iv, cipher.getAuthTag(), body]));
  }

  decrypt(ciphertext: Buffer, aad: string): Promise<DecryptedCredential> {
    const iv = ciphertext.subarray(0, 12);
    const tag = ciphertext.subarray(12, 28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    const token = Buffer.concat([decipher.update(ciphertext.subarray(28)), decipher.final()]);
    return Promise.resolve(makeCredential(token.toString('utf8')));
  }
}

/** Mã quyền giả dạng `fake_tok_<ngẫu nhiên>` (bộ quét bí mật bắt chuỗi này trong nhật ký – SC-009). */
export function newFakeToken(): string {
  return `fake_tok_${randomBytes(12).toString('base64url')}`;
}
