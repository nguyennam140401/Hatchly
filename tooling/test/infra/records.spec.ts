import { describe, expect, it } from 'vitest';
import {
  appliedKey,
  hasStagingRecord,
  listApplyRecords,
  protectionRemovedAddresses,
  writeApplyRecord,
} from '../../infra/lib/records.mjs';

// T087 (007): bản ghi áp dụng đúng lược đồ, khóa, chỉ-thêm.

function fakeS3() {
  const store = new Map<string, unknown>();
  return {
    store,
    putJson: (key: string, value: unknown, o: { onlyIfAbsent?: boolean } = {}) => {
      if (o.onlyIfAbsent === true && store.has(key)) {
        return Promise.reject(
          Object.assign(new Error('exists'), { $metadata: { httpStatusCode: 412 } }),
        );
      }
      store.set(key, value);
      return Promise.resolve();
    },
    getJson: (key: string) => Promise.resolve(store.get(key) ?? null),
    list: (prefix: string) =>
      Promise.resolve(
        [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })),
      ),
  };
}

const input = (stack: string, extra = {}) => ({
  stack,
  definitionHash: 'sha256:aaa',
  paramsHash: 'sha256:ppp',
  gitCommit: 'c0ffee',
  appliedAt: `2026-11-14T00:00:0${stack === 'cloud' ? 1 : 2}Z`,
  operator: 'tester',
  summary: { create: 2, update: 1, replace: 0, delete: 0 },
  ...extra,
});

describe('bản ghi áp dụng', () => {
  it('đúng lược đồ và khóa records/applied/<dấu>/<stack>-<appliedAt>.json', async () => {
    const s3 = fakeS3();
    const key = await writeApplyRecord('staging', input('cloud'), { s3 });
    expect(key).toBe('records/applied/sha256-aaa/cloud-2026-11-14T00:00:01Z.json');
    expect(Object.keys(s3.store.get(key) as object).sort()).toEqual(
      [
        'appliedAt',
        'dataLossConfirmed',
        'definitionHash',
        'environment',
        'gitCommit',
        'operator',
        'paramsHash',
        'protectedChanges',
        'protectionRemoved',
        'stack',
        'summary',
      ].sort(),
    );
    expect(appliedKey({ definitionHash: 'sha256:aaa', stack: 'cloud', appliedAt: 'T' })).toContain(
      'sha256-aaa/cloud-T',
    );
  });

  it('chỉ-thêm: ghi đè cùng khóa bị từ chối', async () => {
    const s3 = fakeS3();
    await writeApplyRecord('staging', input('cloud'), { s3 });
    await expect(writeApplyRecord('staging', input('cloud'), { s3 })).rejects.toThrow();
  });

  it('hasStagingRecord đúng ⇔ có bản ghi của cả hai stack', async () => {
    const s3 = fakeS3();
    await writeApplyRecord('staging', input('cloud'), { s3 });
    expect(await hasStagingRecord('sha256:aaa', { s3 })).toBe(false);
    await writeApplyRecord('staging', input('platform'), { s3 });
    expect(await hasStagingRecord('sha256:aaa', { s3 })).toBe(true);
    expect(await hasStagingRecord('sha256:khac', { s3 })).toBe(false);
  });

  it('listApplyRecords mới nhất trước; protectionRemovedAddresses gộp địa chỉ đã gỡ bảo vệ', async () => {
    const s3 = fakeS3();
    await writeApplyRecord(
      'production',
      input('cloud', { protectionRemoved: ['module.x.aws_s3_bucket.media[0]'] }),
      { s3 },
    );
    await writeApplyRecord('production', input('platform'), { s3 });
    const list = (await listApplyRecords('production', { deps: { s3 } })) as { stack: string }[];
    expect(list.map((r) => r.stack)).toEqual(['platform', 'cloud']);
    expect(await protectionRemovedAddresses('production', { s3 })).toEqual(
      new Set(['module.x.aws_s3_bucket.media[0]']),
    );
  });
});
