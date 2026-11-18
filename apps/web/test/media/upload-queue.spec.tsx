// Hàng đợi tải của thư viện media (014 contracts/media-ui.md mục 5, 7): trạng thái mới (đang xử lý, trùng, chờ mạng),
// mất mạng tự tiếp tục không tốn lượt thử, hủy gọi máy chủ để trả giữ chỗ, mỗi tệp báo lỗi riêng mà tệp khác vẫn chạy.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUploadQueue, type UploadItem, type UploadQueue } from '../../src/lib/upload/queue';
import {
  UploadError,
  type UploadOutcome,
  type UploadTransport,
} from '../../src/lib/upload/transports/types';
import { UploadQueue as UploadQueueView } from '../../src/ui/upload/UploadQueue';

afterEach(cleanup);

const file = (name: string, type = 'image/jpeg', size = 1000) =>
  new File([new Uint8Array(size)], name, { type });

const settle = () => new Promise((r) => setTimeout(r, 15));
const statuses = (q: UploadQueue) =>
  Object.fromEntries(q.getItems().map((i) => [i.name, i.status]));

interface Script {
  start?: (name: string, attempt: number) => 'ok' | 'quota' | 'plan' | 'expired';
  put?: (name: string, attempt: number) => 'ok' | 'network' | 'hold';
  outcome?: (name: string) => UploadOutcome | undefined;
}

function scripted(script: Script = {}) {
  const attempts = new Map<string, number>();
  const holds = new Map<string, () => void>();
  const cancelled: string[] = [];
  const transport: UploadTransport = {
    start: (f) => {
      const n = (attempts.get(f.name) ?? 0) + 1;
      attempts.set(f.name, n);
      const r = script.start?.(f.name, n) ?? 'ok';
      if (r === 'quota')
        return Promise.reject(new UploadError('Thư viện đã đầy (4,9/5 GB).', 'storage_full'));
      if (r === 'plan')
        return Promise.reject(new UploadError('Gói của bạn đã hết hạn.', 'plan_expired'));
      return Promise.resolve({
        uploadUrl: '',
        completionRef: f.name,
        uploadId: `up-${f.name}`,
        mediaId: `m-${f.name}`,
        ...(r === 'expired' ? { previousExpired: true } : {}),
      });
    },
    putPart: (_s, f, onProgress, signal) =>
      new Promise<void>((resolve, reject) => {
        const r = script.put?.(f.name, attempts.get(f.name) ?? 1) ?? 'ok';
        signal.addEventListener('abort', () => {
          reject(new DOMException('hủy', 'AbortError'));
        });
        if (r === 'ok') {
          onProgress(100);
          resolve();
        } else if (r === 'network')
          reject(new UploadError('Mất kết nối khi tải lên.', 'retryable'));
        else holds.set(f.name, resolve);
      }),
    complete: async (_s, f, _signal, hooks) => {
      hooks?.onProcessing?.();
      await settle();
      return script.outcome?.(f.name) ?? { kind: 'ready', mediaId: `m-${f.name}` };
    },
    cancel: (s) => {
      cancelled.push(s.uploadId ?? '');
      return Promise.resolve();
    },
  };
  return { transport, holds, cancelled, attempts };
}

describe('hàng đợi tải – kết quả cuối', () => {
  it('tải xong → "Đang xử lý" rồi "Sẵn sàng"; báo cho lưới làm mới (onSettled)', async () => {
    const { transport } = scripted();
    const onSettled = vi.fn();
    const q = createUploadQueue({ transport, onSettled });
    q.add([file('a.jpg')]);
    await vi.waitFor(
      () => {
        expect(q.getItems()[0]?.status).toBe('processing');
      },
      { interval: 2 },
    );
    await vi.waitFor(() => {
      expect(q.getItems()[0]).toMatchObject({
        status: 'done',
        mediaStatus: 'ready',
        mediaId: 'm-a.jpg',
      });
    });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('không xử lý được → xong kèm mediaStatus "unprocessable" (tệp vẫn có trong thư viện để xóa)', async () => {
    const { transport } = scripted({
      outcome: (n) => ({ kind: 'unprocessable', mediaId: `m-${n}` }),
    });
    const q = createUploadQueue({ transport });
    q.add([file('hong.jpg')]);
    await vi.waitFor(() => {
      expect(q.getItems()[0]).toMatchObject({ status: 'done', mediaStatus: 'unprocessable' });
    });
  });

  it('trùng nội dung → trạng thái "duplicate" + liên kết tệp đã có; không có lựa chọn giữ thêm bản', async () => {
    const dup = { mediaId: 'm-old', displayName: 'cu.jpg' };
    const { transport } = scripted({ outcome: () => ({ kind: 'duplicate', duplicateOf: dup }) });
    const q = createUploadQueue({ transport });
    q.add([file('moi.jpg')]);
    await vi.waitFor(() => {
      expect(q.getItems()[0]).toMatchObject({ status: 'duplicate', duplicateOf: dup });
    });
    const onOpenExisting = vi.fn();
    const onDismiss = vi.fn();
    const { container } = render(
      <UploadQueueView
        items={q.getItems()}
        onCancel={() => undefined}
        onRetry={() => undefined}
        onOpenExisting={onOpenExisting}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText('Tệp này đã có trong thư viện')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xem tệp đã có' }));
    expect(onOpenExisting).toHaveBeenCalledWith('m-old');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onDismiss).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /giữ thêm|Giữ cả hai/i })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('phiên cũ hết hạn khi chọn lại tệp → thông báo "đang tải lại từ đầu"', async () => {
    const { transport, holds } = scripted({ start: () => 'expired', put: () => 'hold' });
    const q = createUploadQueue({ transport });
    q.add([file('a.jpg')]);
    await vi.waitFor(() => {
      expect(q.getItems()[0]?.notice).toBe('Lần tải trước đã hết hạn, đang tải lại từ đầu.');
    });
    holds.get('a.jpg')?.();
  });
});

describe('hàng đợi tải – lỗi theo từng tệp', () => {
  it('6 tệp: tối đa 3 tải song song; tệp sai loại/quá cỡ bị từ chối TRƯỚC khi tải kèm lý do + cách khắc phục, tệp khác vẫn chạy', async () => {
    const { transport, holds } = scripted({ put: () => 'hold' });
    const q = createUploadQueue({ transport });
    q.add([
      file('1.jpg'),
      file('2.jpg'),
      file('3.png', 'image/png'),
      file('4.jpg'),
      file('virus.exe', 'application/x-msdownload'),
      new File([new Uint8Array(1)], 'to.jpg', { type: 'image/jpeg' }),
    ]);
    Object.defineProperty(q.getItems()[5], 'size', { value: 21 * 1024 * 1024 });
    await settle();
    const items = q.getItems();
    expect(items.filter((i) => i.status === 'uploading')).toHaveLength(3);
    const bad = items.find((i) => i.name === 'virus.exe');
    expect(bad).toMatchObject({ status: 'error', errorKind: 'invalid' });
    expect(bad?.error).toContain('Chỉ nhận ảnh (JPG, PNG, WebP, HEIC) và video (MP4, MOV)');
    for (const h of holds.values()) h();
  });

  it('hết chỗ ở bước bắt đầu → "storage_full" (không thử lại), hiện cách xử lý; gói hết hạn → "plan_expired" + "Gia hạn gói"', async () => {
    const { transport } = scripted({ start: (n) => (n === 'a.jpg' ? 'quota' : 'plan') });
    const q = createUploadQueue({ transport });
    q.add([file('a.jpg'), file('b.jpg')]);
    await vi.waitFor(() => {
      expect(statuses(q)).toEqual({ 'a.jpg': 'error', 'b.jpg': 'error' });
    });
    const items = q.getItems();
    expect(items[0]).toMatchObject({ errorKind: 'storage_full', attempt: 0 });
    expect(items[1]).toMatchObject({ errorKind: 'plan_expired', attempt: 0 });
    const { container } = render(
      <UploadQueueView
        items={items}
        onCancel={() => undefined}
        onRetry={() => undefined}
        freeUpHref="/media"
        renewHref="/settings"
      />,
    );
    expect(screen.getByText('Thư viện đã đầy (4,9/5 GB).')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem danh sách để xóa' })).toHaveAttribute(
      'href',
      '/media',
    );
    expect(screen.getByRole('link', { name: 'Gia hạn gói' })).toHaveAttribute('href', '/settings');
    expect(screen.queryByRole('button', { name: 'Thử lại tệp' })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('hàng đợi tải – mất mạng và hủy', () => {
  it('mất mạng ⇒ "Tạm dừng – đang chờ mạng", có mạng lại tự tiếp tục KHÔNG tốn lượt thử, không cần bấm', async () => {
    let online = false;
    let resume: () => void = () => undefined;
    const { transport } = scripted({ put: (_n, attempt) => (attempt === 1 ? 'network' : 'ok') });
    const wait = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
    const q = createUploadQueue({
      transport,
      wait,
      isOnline: () => online,
      waitOnline: () =>
        new Promise<void>((resolve) => {
          resume = () => {
            online = true;
            resolve();
          };
        }),
    });
    q.add([file('a.jpg')]);
    await vi.waitFor(() => {
      expect(q.getItems()[0]?.status).toBe('waiting_network');
    });
    expect(wait).not.toHaveBeenCalled(); // không chờ giãn cách – chờ sự kiện `online`
    const { container } = render(
      <UploadQueueView items={q.getItems()} onCancel={() => undefined} onRetry={() => undefined} />,
    );
    expect(screen.getByText('Tạm dừng – đang chờ mạng')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    resume();
    await vi.waitFor(() => {
      expect(q.getItems()[0]).toMatchObject({ status: 'done', mediaStatus: 'ready' });
    });
    expect(q.getItems()[0]?.attempt).toBe(0); // lượt thử không tăng
  });

  it('hủy một tệp đang tải ⇒ gọi máy chủ hủy phiên (trả giữ chỗ)', async () => {
    const { transport, cancelled } = scripted({ put: () => 'hold' });
    const q = createUploadQueue({ transport });
    q.add([file('a.jpg'), file('b.jpg')]);
    await settle();
    q.cancel(q.getItems()[0]!.id);
    await settle();
    expect(statuses(q)['a.jpg']).toBe('canceled');
    expect(cancelled).toEqual(['up-a.jpg']);
    expect(statuses(q)['b.jpg']).toBe('uploading'); // tệp khác không bị ảnh hưởng
  });

  it('lỗi tạm thời ⇒ thử lại giãn cách rồi báo lỗi kèm nút thử lại; thử lại từng tệp không cần chọn lại', async () => {
    const { transport } = scripted({ put: () => 'network' });
    const wait = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
    const q = createUploadQueue({ transport, wait, isOnline: () => true });
    q.add([file('a.jpg')]);
    await vi.waitFor(() => {
      expect(q.getItems()[0]?.status).toBe('error');
    });
    expect(wait.mock.calls.map((c) => c[0])).toEqual([1000, 3000, 10_000]);
    expect(q.getItems()[0]?.error).toBe('Tệp bị lỗi khi tải. Hãy thử lại.');
    const item: UploadItem = q.getItems()[0]!;
    const { container } = render(
      <UploadQueueView items={[item]} onCancel={() => undefined} onRetry={q.retry} />,
    );
    const view = within(container);
    expect(view.getByRole('button', { name: 'Thử lại tệp' })).toBeInTheDocument();
  });
});
