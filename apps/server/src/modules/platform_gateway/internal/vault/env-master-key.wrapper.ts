import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { KeyWrapper } from './key-wrapper';

// Khóa chủ 256 bit lấy từ `Secret` (CREDENTIAL_MASTER_KEY_B64) – dùng cho dev/test và staging có điều kiện; production
// MUST dùng KMS (assert-no-fakes từ chối). Hỗ trợ xoay khóa: chuỗi cấu hình là danh sách khóa base64 phân tách bằng dấu
// phẩy, khóa ĐẦU là khóa hiện hành (bọc DEK mới), các khóa sau chỉ để giải mã bản cũ.
// Định dạng DEK đã bọc: iv(12) | tag(16) | ciphertext(32) – dùng AES-256-GCM của `node:crypto`, không tự viết mật mã.

const KEY_BYTES = 32;

const keyIdOf = (key: Buffer): string =>
  `env-${createHash('sha256').update(key).digest('hex').slice(0, 8)}`;

export class EnvMasterKeyWrapper implements KeyWrapper {
  readonly currentKeyId: string;
  private readonly keys = new Map<string, Buffer>();

  /** `b64List`: một hoặc nhiều khóa base64 (mỗi khóa đúng 32 byte), phân tách bằng dấu phẩy. */
  constructor(b64List: string) {
    const raw = b64List
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    if (raw.length === 0) throw new Error('CREDENTIAL_MASTER_KEY_B64 trống');
    let current = '';
    for (const b64 of raw) {
      const key = Buffer.from(b64, 'base64');
      if (key.length !== KEY_BYTES) {
        throw new Error(`CREDENTIAL_MASTER_KEY_B64: mỗi khóa phải đúng ${KEY_BYTES} byte (base64)`);
      }
      const id = keyIdOf(key);
      if (current === '') current = id; // khóa đầu = khóa hiện hành
      this.keys.set(id, key);
    }
    this.currentKeyId = current;
  }

  wrap(dek: Buffer, aad: Buffer): Promise<Buffer> {
    const key = this.keys.get(this.currentKeyId);
    if (key === undefined) return Promise.reject(new Error('VAULT_UNKNOWN_KEY'));
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    const body = Buffer.concat([cipher.update(dek), cipher.final()]);
    return Promise.resolve(Buffer.concat([iv, cipher.getAuthTag(), body]));
  }

  unwrap(keyId: string, wrapped: Buffer, aad: Buffer): Promise<Buffer> {
    const key = this.keys.get(keyId);
    if (key === undefined) return Promise.reject(new Error('VAULT_UNKNOWN_KEY'));
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, wrapped.subarray(0, 12));
      decipher.setAAD(aad);
      decipher.setAuthTag(wrapped.subarray(12, 28));
      return Promise.resolve(Buffer.concat([decipher.update(wrapped.subarray(28)), decipher.final()]));
    } catch {
      return Promise.reject(new Error('VAULT_DECRYPT_FAILED'));
    }
  }
}
