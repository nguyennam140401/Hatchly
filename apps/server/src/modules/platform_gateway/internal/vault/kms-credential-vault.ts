import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  wrapDecrypted,
  type CredentialVault,
  type DecryptedCredential,
} from './credential-vault';
import type { KeyWrapper } from './key-wrapper';

// Kho mã quyền mã hóa PHONG BÌ (T033, ADR-13, nguyên tắc VII): mỗi bản ghi một DEK 256 bit ngẫu nhiên; mã quyền được
// mã hóa AES-256-GCM bằng DEK (AAD = `accountId|purpose|ref`), DEK được `KeyWrapper` bọc bằng khóa chủ/KMS. Dùng
// `node:crypto`, KHÔNG tự viết mật mã.
//
// Định dạng bản mã: `v1 | keyIdLen(1) | keyId | wrappedLen(2, BE) | wrappedDek | iv(12) | tag(16) | ciphertext`.
// Không cache bản rõ; bản rõ chỉ tồn tại trong `DecryptedCredential` (in/JSON ra "[credential]").

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DEK_BYTES = 32;

export class KmsCredentialVault implements CredentialVault {
  constructor(private readonly wrapper: KeyWrapper) {}

  async encrypt(token: string, aad: string): Promise<Buffer> {
    const aadBuf = Buffer.from(aad, 'utf8');
    const dek = randomBytes(DEK_BYTES);
    try {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', dek, iv);
      cipher.setAAD(aadBuf);
      const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      const keyId = Buffer.from(this.wrapper.currentKeyId, 'utf8');
      const wrapped = await this.wrapper.wrap(dek, aadBuf);
      if (keyId.length > 255 || wrapped.length > 0xffff) throw new Error('VAULT_ENVELOPE_TOO_LARGE');
      const wrappedLen = Buffer.alloc(2);
      wrappedLen.writeUInt16BE(wrapped.length);
      return Buffer.concat([
        Buffer.from([VERSION, keyId.length]),
        keyId,
        wrappedLen,
        wrapped,
        iv,
        tag,
        body,
      ]);
    } finally {
      dek.fill(0);
    }
  }

  async decrypt(ciphertext: Buffer, aad: string): Promise<DecryptedCredential> {
    const aadBuf = Buffer.from(aad, 'utf8');
    let off = 0;
    if (ciphertext.length < 2 || ciphertext[off++] !== VERSION) throw new Error('VAULT_BAD_FORMAT');
    const keyIdLen = ciphertext.readUInt8(off++);
    const keyId = ciphertext.subarray(off, off + keyIdLen).toString('utf8');
    off += keyIdLen;
    if (ciphertext.length < off + 2) throw new Error('VAULT_BAD_FORMAT');
    const wrappedLen = ciphertext.readUInt16BE(off);
    off += 2;
    const wrapped = ciphertext.subarray(off, off + wrappedLen);
    off += wrappedLen;
    if (ciphertext.length < off + IV_BYTES + TAG_BYTES) throw new Error('VAULT_BAD_FORMAT');
    const iv = ciphertext.subarray(off, off + IV_BYTES);
    off += IV_BYTES;
    const tag = ciphertext.subarray(off, off + TAG_BYTES);
    off += TAG_BYTES;
    const body = ciphertext.subarray(off);

    const dek = await this.wrapper.unwrap(keyId, wrapped, aadBuf);
    try {
      const decipher = createDecipheriv('aes-256-gcm', dek, iv);
      decipher.setAAD(aadBuf);
      decipher.setAuthTag(tag);
      const token = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
      return wrapDecrypted(token);
    } catch {
      // Thông điệp cố định: không lộ chi tiết (sai AAD, bản mã bị sửa, khóa sai đều như nhau).
      throw new Error('VAULT_DECRYPT_FAILED');
    } finally {
      dek.fill(0);
    }
  }
}
