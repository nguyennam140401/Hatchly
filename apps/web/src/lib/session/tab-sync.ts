// Đồng bộ phiên giữa các tab bằng BroadcastChannel (FR-028): đăng xuất/đổi tài khoản ở tab này → tab khác dọn dữ liệu
// và về /login. Không truyền dữ liệu tài khoản, chỉ loại sự kiện + thời điểm + mã tab (để tab gửi bỏ qua sự kiện của chính nó).

export interface SessionSyncEvent {
  type: 'logout' | 'switched';
  at: number;
}

const CHANNEL = 'app-session';
/** Mã ngẫu nhiên của tab này (không chứa thông tin người dùng). */
const TAB_ID = `${String(Date.now())}-${String(Math.random()).slice(2)}`;

function open(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
}

export function broadcastSessionEvent(type: SessionSyncEvent['type']): void {
  const channel = open();
  if (channel === null) return;
  channel.postMessage({ type, at: Date.now(), from: TAB_ID });
  channel.close();
}

/** Nghe sự kiện từ tab KHÁC (không nhận sự kiện của chính tab này). Trả hàm hủy. */
export function listenSessionEvents(handler: (event: SessionSyncEvent) => void): () => void {
  const channel = open();
  if (channel === null) return () => undefined;
  channel.onmessage = (message: MessageEvent<unknown>) => {
    const data = message.data as (Partial<SessionSyncEvent> & { from?: string }) | null;
    if (data === null || data.from === TAB_ID) return;
    if (data.type === 'logout' || data.type === 'switched') {
      handler({ type: data.type, at: typeof data.at === 'number' ? data.at : Date.now() });
    }
  };
  return () => {
    channel.close();
  };
}
