import { describe } from 'vitest';
import {
  MemoryObjectStorage,
  UploadRejected,
} from '../../../src/core/storage/memory/memory-storage';
import { describeMultipartContract } from './multipart.contract';

// 014 T017: tải nhiều phần – kho bộ nhớ (pnpm test), đồng hồ tiêm được.

let offsetMs = 0;
const storage = new MemoryObjectStorage(() => new Date(Date.now() + offsetMs));

describe('Kho tệp tải nhiều phần – memory', () => {
  describeMultipartContract(() => ({
    storage,
    async uploadPart(url, bytes) {
      try {
        await storage.simulateBrowserUploadPart(url, bytes);
        return true;
      } catch (err) {
        if (err instanceof UploadRejected) return false;
        throw err;
      }
    },
    expire: (seconds) => {
      offsetMs += seconds * 1000;
      return Promise.resolve();
    },
    openSessions: () => storage.openMultipartCount(),
  }));
});
