import { describe, expect, it, vi } from 'vitest';
import {
  createUploadQueue,
  MAX_CONCURRENT_UPLOADS,
  RETRY_DELAYS_MS,
  type UploadQueue,
} from './queue';
import { UploadError, type UploadTransport } from './transports/types';
import { MAX_VIDEO_BYTES, validateFile } from './validate';

const file = (name: string, type = 'image/jpeg', size = 1000) =>
  new File([new Uint8Array(size)], name, { type });
const bigVideo = (name: string) => ({ name, type: 'video/mp4', size: MAX_VIDEO_BYTES + 1 });

/** Vận chuyển giả: mỗi tệp có thể được điều khiển riêng. */
function fakeTransport(
  behaviour: (name: string, attempt: number) => 'ok' | 'retry' | 'full' | 'fatal' | 'hold',
) {
  const attempts = new Map<string, number>();
  const holds = new Map<string, () => void>();
  const transport: UploadTransport = {
    start: (f) => {
      const n = (attempts.get(f.name) ?? 0) + 1;
      attempts.set(f.name, n);
      return Promise.resolve({ uploadUrl: `https://kho.example/${f.name}`, completionRef: f.name });
    },
    putPart: (_s, f, onProgress, signal) =>
      new Promise<void>((resolve, reject) => {
        const outcome = behaviour(f.name, attempts.get(f.name) ?? 1);
        signal.addEventListener('abort', () => {
          reject(new DOMException('hủy', 'AbortError'));
        });
        if (outcome === 'ok') {
          onProgress(50);
          resolve();
        } else if (outcome === 'retry') reject(new UploadError('mạng', 'retryable'));
        else if (outcome === 'full') reject(new UploadError('đầy', 'storage_full'));
        else if (outcome === 'fatal') reject(new UploadError('từ chối', 'fatal'));
        else holds.set(f.name, resolve);
      }),
    complete: () => Promise.resolve(),
  };
  return { transport, attempts, holds };
}

async function settle(): Promise<void> {
  await vi.waitFor(() => undefined, { interval: 5 });
  await new Promise((r) => setTimeout(r, 10));
}

const statuses = (q: UploadQueue) =>
  Object.fromEntries(q.getItems().map((i) => [i.name, i.status]));

describe('validateFile', () => {
  it('ảnh/video hợp lệ; video > 500 MB bị từ chối kèm lời giải thích', () => {
    expect(validateFile({ name: 'a.jpg', type: 'image/jpeg', size: 1000 }).ok).toBe(true);
    expect(validateFile({ name: 'v.mp4', type: 'video/mp4', size: 1000 }).ok).toBe(true);
    const tooBig = validateFile(bigVideo('v.mp4'));
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.message).toContain('500 MB');
    expect(validateFile({ name: 'a.exe', type: 'application/x-msdownload', size: 5 }).ok).toBe(
      false,
    );
    expect(validateFile({ name: 'a.jpg', type: 'image/jpeg', size: 0 }).ok).toBe(false);
  });
});

describe('UploadQueue', () => {
  it('chỉ tải tối đa 3 tệp đồng thời', async () => {
    const { transport, holds } = fakeTransport(() => 'hold');
    const q = createUploadQueue({ transport });
    q.add([file('1.jpg'), file('2.jpg'), file('3.jpg'), file('4.jpg'), file('5.jpg')]);
    await settle();
    expect(q.getItems().filter((i) => i.status === 'uploading')).toHaveLength(
      MAX_CONCURRENT_UPLOADS,
    );
    expect(q.getItems().filter((i) => i.status === 'queued')).toHaveLength(2);
    holds.get('1.jpg')?.();
    await settle();
    expect(q.getItems().filter((i) => i.status === 'uploading')).toHaveLength(3);
  });

  it('lỗi một tệp không dừng tệp khác; lỗi kiểm tra báo theo từng tệp', async () => {
    const { transport } = fakeTransport((name) => (name === 'hong.jpg' ? 'fatal' : 'ok'));
    const q = createUploadQueue({ transport });
    q.add([file('tot.jpg'), file('hong.jpg'), file('sai.exe', 'application/x-msdownload')]);
    await settle();
    expect(statuses(q)).toEqual({ 'tot.jpg': 'done', 'hong.jpg': 'error', 'sai.exe': 'error' });
    expect(q.getItems().find((i) => i.name === 'sai.exe')?.errorKind).toBe('invalid');
  });

  it('thử lại giãn cách 1 s, 3 s, 10 s rồi mới báo lỗi', async () => {
    const waits: number[] = [];
    const { transport } = fakeTransport(() => 'retry');
    const q = createUploadQueue({
      transport,
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    q.add([file('mang.jpg')]);
    await settle();
    expect(waits).toEqual([...RETRY_DELAYS_MS]);
    expect(q.getItems()[0]).toMatchObject({ status: 'error', errorKind: 'failed' });
  });

  it('thành công sau lần thử lại', async () => {
    const { transport } = fakeTransport((_n, attempt) => (attempt < 3 ? 'retry' : 'ok'));
    const q = createUploadQueue({ transport, wait: () => Promise.resolve() });
    q.add([file('chap-chon.jpg')]);
    await settle();
    expect(q.getItems()[0]?.status).toBe('done');
  });

  it('kho đầy → dừng ngay (không thử lại), đánh dấu storage_full', async () => {
    const waits: number[] = [];
    const { transport } = fakeTransport(() => 'full');
    const q = createUploadQueue({
      transport,
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    q.add([file('day.jpg')]);
    await settle();
    expect(waits).toEqual([]);
    expect(q.getItems()[0]).toMatchObject({ status: 'error', errorKind: 'storage_full' });
  });

  it('hủy và thử lại từng tệp', async () => {
    const { transport, holds } = fakeTransport((name, attempt) =>
      name === 'a.jpg' && attempt === 1 ? 'hold' : 'ok',
    );
    const q = createUploadQueue({ transport });
    q.add([file('a.jpg'), file('b.jpg')]);
    await settle();
    const a = q.getItems().find((i) => i.name === 'a.jpg');
    expect(a?.status).toBe('uploading');
    q.cancel(a?.id ?? '');
    await settle();
    expect(statuses(q)).toEqual({ 'a.jpg': 'canceled', 'b.jpg': 'done' });
    holds.clear();
    q.retry(a?.id ?? '');
    await settle();
    expect(statuses(q)['a.jpg']).toBe('done');
  });

  it('không giữ tên tệp/đường dẫn ký sẵn ở bộ lưu cục bộ', async () => {
    const { transport } = fakeTransport(() => 'ok');
    const q = createUploadQueue({ transport });
    q.add([file('bi-mat.jpg')]);
    await settle();
    expect(JSON.stringify(Object.entries(window.localStorage))).not.toContain('bi-mat');
    expect(JSON.stringify(Object.entries(window.sessionStorage))).not.toContain('kho.example');
  });
});
