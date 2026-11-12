import { describe, expect, it } from 'vitest';
import { runWithJobContext } from '../../../src/core/context/bind-account';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { InvalidRequestError, loc, StorageAccessDenied } from '../../../src/core/storage';
import { assertKeyInScope, resolveKey } from '../../../src/core/storage/location';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect as vexpect } from 'vitest';
import { TEST_LOG_DIR } from '../../setup/log-capture';

// 005 T083: bố cục khóa (data-model.md mục 4), kiểm định dạng, kiểm lần hai tiền tố.

const acc = uuidV7();
const inAcc = <T>(fn: () => T, jobId?: string) =>
  runWithJobContext({ traceId: uuidV7(), accountId: acc, ...(jobId ? { jobId } : {}) }, async () => fn());

describe('StorageLocation', () => {
  it('5 khuôn khóa, mọi khóa (kể cả job_tmp) dưới tenants/{acc}/', async () => {
    const m = uuidV7();
    const f = uuidV7();
    const j = uuidV7();
    const keys = await inAcc(
      () => [
        resolveKey(loc.mediaOriginal(m)),
        resolveKey(loc.mediaNormalized(m, 'w1080.jpg')),
        resolveKey(loc.mediaThumb(m)),
        resolveKey(loc.contextFile(f)),
        resolveKey(loc.jobTmp('frame-01.jpg')),
      ],
      j,
    );
    expect(keys).toEqual([
      `tenants/${acc}/media/${m}/original`,
      `tenants/${acc}/media/${m}/normalized/w1080.jpg`,
      `tenants/${acc}/media/${m}/thumb`,
      `tenants/${acc}/context/${f}`,
      `tenants/${acc}/tmp/${j}/frame-01.jpg`,
    ]);
  });

  it('mã không phải UUID / name sai khuôn → từ chối; thiếu ngữ cảnh → TenantContextError', async () => {
    expect(() => loc.mediaOriginal('abc')).toThrow(InvalidRequestError);
    expect(() => loc.mediaNormalized(uuidV7(), 'X')).toThrow(InvalidRequestError);
    expect(() => loc.mediaNormalized(uuidV7(), 'a'.repeat(41))).toThrow(InvalidRequestError);
    expect(() => resolveKey(loc.mediaOriginal(uuidV7()))).toThrow(expect.objectContaining({ name: 'TenantContextError' }));
    await expect(inAcc(() => loc.jobTmp('a.mp3'))).rejects.toMatchObject({ name: 'TenantContextError' });
  });

  it('kiểm lần hai: khóa ngoài tiền tố → StorageAccessDenied + storage.access_denied chỉ có kind', async () => {
    const other = `tenants/${uuidV7()}/media/${uuidV7()}/original`;
    const err = await inAcc(() => {
      try {
        assertKeyInScope(other, 'media_original');
        return null;
      } catch (e) {
        return e as Error;
      }
    });
    expect(err).toBeInstanceOf(StorageAccessDenied);
    expect(err?.message).not.toContain('tenants/');
    await expect(inAcc(() => assertKeyInScope(`tenants/${acc}/../x`, 'job_tmp'))).rejects.toBeInstanceOf(StorageAccessDenied);
    const log = readFileSync(resolve(TEST_LOG_DIR, 'location.spec.ndjson'), 'utf8');
    vexpect(log).toContain('storage.access_denied');
    vexpect(log).toContain('"storage_kind":"media_original"');
    vexpect(log).not.toContain(other);
  });
});
