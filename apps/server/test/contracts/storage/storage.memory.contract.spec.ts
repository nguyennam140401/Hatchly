import { describe, expect } from 'vitest';
import { MemoryObjectStorage, UploadRejected } from '../../../src/core/storage/memory/memory-storage';
import { describeObjectStorageContract } from './object-storage.contract';

// 005 T082: kho tệp bộ nhớ (pnpm test) – `simulateBrowserUpload`, đồng hồ tiêm được.

let offsetMs = 0;
const storage = new MemoryObjectStorage(() => new Date(Date.now() + offsetMs));

describe('Kho tệp – memory', () => {
  describeObjectStorageContract(() => ({
    storage,
    now: () => Date.now() + offsetMs,
    async upload(p, bytes, contentType, fields) {
      try {
        await storage.simulateBrowserUpload({ fields: { ...p.fields, ...fields } }, bytes, contentType);
        return true;
      } catch (err) {
        if (err instanceof UploadRejected) return false;
        throw err;
      }
    },
    download: (url) => Promise.resolve(storage.fetchSigned(url)),
    expire: (seconds) => {
      offsetMs += seconds * 1000;
      return Promise.resolve();
    },
    async checkTmpLifecycle(l) {
      expect(storage.tagsOf(l)).toEqual({ lifecycle: 'tmp' });
      const saved = offsetMs;
      offsetMs += 86_400_000 + 1000;
      expect(storage.sweepExpired()).toBeGreaterThanOrEqual(1);
      offsetMs = saved;
      expect((await storage.stat(l)).exists).toBe(false);
    },
  }));
});
