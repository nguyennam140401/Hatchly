import { describe, expect, it, vi } from 'vitest';
import { broadcastSessionEvent, listenSessionEvents } from './tab-sync';

describe('tab-sync', () => {
  it('tab gửi KHÔNG nhận sự kiện của chính mình', async () => {
    const handler = vi.fn();
    const off = listenSessionEvents(handler);
    broadcastSessionEvent('logout');
    await new Promise((r) => setTimeout(r, 30));
    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it('nhận sự kiện từ tab khác (mã tab khác)', async () => {
    const handler = vi.fn();
    const off = listenSessionEvents(handler);
    const other = new BroadcastChannel('app-session');
    other.postMessage({ type: 'logout', at: 1, from: 'tab-khac' });
    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledWith({ type: 'logout', at: 1 });
    });
    other.close();
    off();
  });

  it('bỏ qua thông điệp lạ', async () => {
    const handler = vi.fn();
    const off = listenSessionEvents(handler);
    const other = new BroadcastChannel('app-session');
    other.postMessage({ type: 'xoa-het', from: 'tab-khac' });
    await new Promise((r) => setTimeout(r, 30));
    expect(handler).not.toHaveBeenCalled();
    other.close();
    off();
  });
});
