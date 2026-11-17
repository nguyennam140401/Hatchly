// Tải nhiều phần (014 FR-004/005/006, contracts/media-ui.md mục 5, 7): bỏ qua phần đã có, tiến độ bắt đầu từ phần đã có,
// URL hết hạn ⇒ xin lại không báo lỗi, thử lại từng phần 1/3/10 giây, mất mạng ⇒ lỗi "retryable" để hàng đợi tạm dừng.
import { describe, expect, it, vi } from 'vitest';
import {
  PART_RETRY_DELAYS_MS,
  uploadMissingParts,
  type PartPutResult,
  type PartUrl,
} from '../../src/lib/upload/transports/multipart';
import { UploadError, type UploadSession } from '../../src/lib/upload/transports/types';

const MIB = 1024 * 1024;
const SIZE = 8 * MIB;

function setup(partCount: number, completed: number[] = []) {
  const file = new File([new Uint8Array(SIZE * (partCount - 1) + 1000)], 'v.mp4', {
    type: 'video/mp4',
  });
  const session: UploadSession = {
    uploadUrl: '',
    completionRef: 'up',
    uploadId: 'up',
    mode: 'multipart',
    partSizeBytes: SIZE,
    partCount,
    completedParts: completed,
  };
  return { file, session };
}

const urlOf = (n: number, gen = 1): PartUrl => ({
  partNumber: n,
  url: `https://kho/p${String(n)}?g=${String(gen)}`,
  contentLength: 0,
});

function deps(script: (n: number, call: number, url: string) => PartPutResult) {
  const calls = new Map<number, number>();
  const putCalls: string[] = [];
  const requested: number[][] = [];
  let generation = 1;
  return {
    putCalls,
    requested,
    deps: {
      getPartUrls: (_s: UploadSession, numbers: readonly number[]) => {
        requested.push([...numbers]);
        generation += 1;
        return Promise.resolve(numbers.map((n) => urlOf(n, generation)));
      },
      putPart: (url: string, _body: Blob, onBytes: (n: number) => void): Promise<PartPutResult> => {
        const n = Number(/p(\d+)/.exec(url)![1]);
        const call = (calls.get(n) ?? 0) + 1;
        calls.set(n, call);
        putCalls.push(String(n));
        onBytes(100);
        return Promise.resolve(script(n, call, url));
      },
      wait: vi.fn(() => Promise.resolve()),
      isOnline: () => true,
    },
  };
}

describe('uploadMissingParts', () => {
  it('bỏ qua phần đã có ở kho; tiến độ bắt đầu từ phần đã có và chạm 100', async () => {
    const { file, session } = setup(5, [1, 2, 3]);
    const { deps: d, putCalls, requested } = deps(() => 'ok');
    const progress: number[] = [];
    await uploadMissingParts(
      session,
      file,
      (p) => progress.push(p),
      new AbortController().signal,
      d,
    );
    expect(putCalls).toEqual(['4', '5']); // chỉ phần thiếu
    expect(requested).toEqual([[4, 5]]);
    expect(progress[0]).toBe(Math.floor(((3 * SIZE) / file.size) * 100)); // bắt đầu từ phần đã có, không từ 0
    expect(progress.at(-1)).toBe(100);
    expect(progress).toEqual([...progress].sort((a, b) => a - b)); // không tụt lùi
  });

  it('xin URL theo lô ≤ 20 phần', async () => {
    const { file, session } = setup(45);
    const { deps: d, requested } = deps(() => 'ok');
    await uploadMissingParts(session, file, () => undefined, new AbortController().signal, d);
    expect(requested.map((r) => r.length)).toEqual([20, 20, 5]);
  });

  it('URL hết hạn (HTTP 403) ⇒ xin URL mới cho đúng phần đó, KHÔNG báo lỗi, không tốn lượt thử', async () => {
    const { file, session } = setup(3);
    const { deps: d, requested } = deps((n, call) => (n === 2 && call === 1 ? 'expired' : 'ok'));
    await uploadMissingParts(session, file, () => undefined, new AbortController().signal, d);
    expect(requested).toEqual([[1, 2, 3], [2]]);
    expect(d.wait).not.toHaveBeenCalled();
  });

  it('lỗi tạm ⇒ thử lại phần đó sau 1/3/10 giây rồi thành công', async () => {
    const { file, session } = setup(2);
    const { deps: d, putCalls } = deps((n, call) => (n === 1 && call <= 3 ? 'retry' : 'ok'));
    await uploadMissingParts(session, file, () => undefined, new AbortController().signal, d);
    expect(d.wait.mock.calls.map((c) => (c as unknown as number[])[0])).toEqual([
      ...PART_RETRY_DELAYS_MS,
    ]);
    expect(putCalls).toEqual(['1', '1', '1', '1', '2']);
  });

  it('hết lượt thử ⇒ UploadError "retryable" (hàng đợi sẽ xử lý tiếp)', async () => {
    const { file, session } = setup(2);
    const { deps: d } = deps(() => 'retry');
    await expect(
      uploadMissingParts(session, file, () => undefined, new AbortController().signal, d),
    ).rejects.toMatchObject({ kind: 'retryable' });
  });

  it('mất mạng ⇒ UploadError "retryable" NGAY (không thử lại vô ích) để hàng đợi tạm dừng', async () => {
    const { file, session } = setup(3);
    const { deps: d, putCalls } = deps(() => 'ok');
    await expect(
      uploadMissingParts(session, file, () => undefined, new AbortController().signal, {
        ...d,
        isOnline: () => false,
      }),
    ).rejects.toBeInstanceOf(UploadError);
    expect(putCalls).toEqual([]);
  });

  it('kho từ chối (fatal) ⇒ dừng; hủy giữa chừng ⇒ AbortError', async () => {
    const { file, session } = setup(2);
    await expect(
      uploadMissingParts(
        session,
        file,
        () => undefined,
        new AbortController().signal,
        deps(() => 'fatal').deps,
      ),
    ).rejects.toMatchObject({ kind: 'fatal' });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      uploadMissingParts(session, file, () => undefined, ctrl.signal, deps(() => 'ok').deps),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('phần cuối nhỏ hơn 8 MiB được tính đúng cỡ', async () => {
    const { file, session } = setup(2);
    const sizes: number[] = [];
    const d = deps(() => 'ok').deps;
    await uploadMissingParts(session, file, () => undefined, new AbortController().signal, {
      ...d,
      putPart: (url, body, onBytes) => {
        sizes.push(body.size);
        return d.putPart(url, body, onBytes);
      },
    });
    expect(sizes).toEqual([SIZE, 1000]);
  });
});
