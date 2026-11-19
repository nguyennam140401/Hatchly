// 010 / US4 (T029) – kho mã quyền mã hóa phong bì: round-trip, ràng buộc AAD, xoay khóa, chống sửa bản mã, không lộ bản rõ.
import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  credentialAad,
  revealCredential,
} from '../../src/modules/platform_gateway/internal/vault/credential-vault';
import { EnvMasterKeyWrapper } from '../../src/modules/platform_gateway/internal/vault/env-master-key.wrapper';
import { KmsCredentialVault } from '../../src/modules/platform_gateway/internal/vault/kms-credential-vault';
import { KmsKeyWrapper } from '../../src/modules/platform_gateway/internal/vault/kms.wrapper';

const key = () => randomBytes(32).toString('base64');
const TOKEN = 'EAAB-secret-page-token-123';
const AAD_A = credentialAad('acc-A', 'token', 'facebook_page', 'page-1');

describe('KmsCredentialVault (phong bì + EnvMasterKeyWrapper)', () => {
  it('round-trip: giải mã ra đúng mã; bản mã không chứa bản rõ', async () => {
    const vault = new KmsCredentialVault(new EnvMasterKeyWrapper(key()));
    const ct = await vault.encrypt(TOKEN, AAD_A);
    expect(ct.toString('utf8')).not.toContain(TOKEN);
    expect(revealCredential(await vault.decrypt(ct, AAD_A))).toBe(TOKEN);
  });

  it('mỗi lần mã hóa dùng DEK + IV mới: cùng mã quyền cho hai bản mã khác nhau', async () => {
    const vault = new KmsCredentialVault(new EnvMasterKeyWrapper(key()));
    const [a, b] = [await vault.encrypt(TOKEN, AAD_A), await vault.encrypt(TOKEN, AAD_A)];
    expect(a.equals(b)).toBe(false);
  });

  it('AAD sai (bản mã đem sang tài khoản/kênh/mục đích khác) ⇒ giải mã thất bại', async () => {
    const vault = new KmsCredentialVault(new EnvMasterKeyWrapper(key()));
    const ct = await vault.encrypt(TOKEN, AAD_A);
    const others = [
      credentialAad('acc-B', 'token', 'facebook_page', 'page-1'), // tài khoản khác
      credentialAad('acc-A', 'token', 'facebook_page', 'page-2'), // kênh khác
      credentialAad('acc-A', 'refresh', 'facebook_page', 'page-1'), // đổi chỗ mã quyền ↔ mã làm mới
      credentialAad('acc-A', 'token', 'instagram', 'page-1'), // loại kênh khác
    ];
    for (const aad of others) await expect(vault.decrypt(ct, aad)).rejects.toThrow('VAULT_');
  });

  it('xoay khóa: bản cũ vẫn giải mã được, bản mới dùng khóa mới (keyId đổi)', async () => {
    const oldKey = key();
    const before = new KmsCredentialVault(new EnvMasterKeyWrapper(oldKey));
    const oldCt = await before.encrypt(TOKEN, AAD_A);

    const newKey = key();
    const rotatedWrapper = new EnvMasterKeyWrapper(`${newKey},${oldKey}`);
    const rotated = new KmsCredentialVault(rotatedWrapper);
    expect(revealCredential(await rotated.decrypt(oldCt, AAD_A))).toBe(TOKEN);

    const newCt = await rotated.encrypt(TOKEN, AAD_A);
    expect(newCt.includes(Buffer.from(rotatedWrapper.currentKeyId))).toBe(true);
    // Khóa mới đứng một mình vẫn giải mã được bản mới nhưng KHÔNG giải mã được bản cũ.
    const onlyNew = new KmsCredentialVault(new EnvMasterKeyWrapper(newKey));
    expect(revealCredential(await onlyNew.decrypt(newCt, AAD_A))).toBe(TOKEN);
    await expect(onlyNew.decrypt(oldCt, AAD_A)).rejects.toThrow('VAULT_UNKNOWN_KEY');
  });

  it('bản mã bị đổi 1 bit (ở bất kỳ vùng nào) ⇒ giải mã thất bại', async () => {
    const vault = new KmsCredentialVault(new EnvMasterKeyWrapper(key()));
    const ct = await vault.encrypt(TOKEN, AAD_A);
    // Vùng dữ liệu mã hóa (cuối), vùng thẻ xác thực/IV (giữa) và vùng DEK đã bọc (đầu, sau tiêu đề).
    for (const pos of [ct.length - 1, ct.length - 10, 50]) {
      const bad = Buffer.from(ct);
      bad[pos] = (bad[pos]!) ^ 0x01;
      await expect(vault.decrypt(bad, AAD_A)).rejects.toThrow('VAULT_');
    }
  });

  it('bản mã sai định dạng/cắt cụt ⇒ lỗi định dạng, không ném lỗi lạ', async () => {
    const vault = new KmsCredentialVault(new EnvMasterKeyWrapper(key()));
    await expect(vault.decrypt(Buffer.alloc(0), AAD_A)).rejects.toThrow('VAULT_BAD_FORMAT');
    await expect(vault.decrypt(Buffer.from([2, 0]), AAD_A)).rejects.toThrow('VAULT_BAD_FORMAT');
    const ct = await vault.encrypt(TOKEN, AAD_A);
    await expect(vault.decrypt(ct.subarray(0, 20), AAD_A)).rejects.toThrow('VAULT_');
  });

  it('DecryptedCredential in/JSON ra "[credential]", không lộ mã', async () => {
    const vault = new KmsCredentialVault(new EnvMasterKeyWrapper(key()));
    const cred = await vault.decrypt(await vault.encrypt(TOKEN, AAD_A), AAD_A);
    expect(JSON.stringify({ cred })).toBe('{"cred":"[credential]"}');
    expect(inspect(cred)).toBe('[credential]');
    expect(inspect({ cred })).not.toContain(TOKEN);
  });
});

describe('EnvMasterKeyWrapper / KmsKeyWrapper – cấu hình', () => {
  it('khóa chủ không đúng 256 bit hoặc trống ⇒ từ chối', () => {
    expect(() => new EnvMasterKeyWrapper(randomBytes(16).toString('base64'))).toThrow('32 byte');
    expect(() => new EnvMasterKeyWrapper('')).toThrow();
  });

  it('KMS chưa có hiện thực (chờ K5) ⇒ lỗi RÕ, không im lặng', async () => {
    const vault = new KmsCredentialVault(new KmsKeyWrapper('key-1'));
    await expect(vault.encrypt(TOKEN, AAD_A)).rejects.toThrow('KMS_NOT_IMPLEMENTED');
    expect(() => new KmsKeyWrapper(undefined)).toThrow('KMS_KEY_ID');
  });
});
