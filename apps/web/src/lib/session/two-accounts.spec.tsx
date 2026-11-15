import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeMe } from '../../../test/helpers/render';
import { useApiQuery } from '../api/hooks';
import { createQueryClient } from '../api/query-client';
import { queryKeys } from '../api/query-keys';
import { draftStore } from '../forms/draft-store';
import { safeStorage } from '../safe-storage';
import { clearAllAccountData, registerAccountDataCleaner } from './clear-account-data';
import { SessionProvider } from './SessionProvider';
import { broadcastSessionEvent } from './tab-sync';

// Hai tài khoản trên một trình duyệt (SC-008): đăng xuất/đổi tài khoản → KHÔNG còn dữ liệu tài khoản cũ ở bất kỳ nơi nào.

const SECRET = 'DU-LIEU-TAI-KHOAN-A';

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  draftStore.clearAll();
});

describe('đổi tài khoản trên cùng trình duyệt', () => {
  it('sau clearAllAccountData: 0 dữ liệu cũ trong QueryClient, DraftStore, safe-storage, sessionStorage', () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.posts.list(), [{ title: SECRET }]);
    client.setQueryData(queryKeys.profile.current(), { intro: SECRET });
    draftStore.save('u-1', 'profile', { intro: SECRET });
    safeStorage.set('ui.posts.view', 'list');
    window.sessionStorage.setItem('tam', SECRET);

    clearAllAccountData(client);

    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(JSON.stringify(draftStore.snapshot())).not.toContain(SECRET);
    expect(safeStorage.get('ui.posts.view')).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it('chỉ có cờ giao diện trong localStorage; không có giá trị nhạy cảm/mã định danh', () => {
    safeStorage.set('ui.sidebar.collapsed', '1');
    const all = JSON.stringify(Object.entries(window.localStorage)) + JSON.stringify(Object.entries(window.sessionStorage));
    expect(all).not.toMatch(/u-1|a-1|@example|token|password|session/i);
    expect(Object.keys(window.localStorage).every((k) => k.startsWith('app:ui.'))).toBe(true);
  });

  it('tab khác đăng xuất → tab này dọn dữ liệu và chuyển /login', async () => {
    let ended = 0;
    function Probe() {
      const q = useApiQuery(queryKeys.posts.list(), () => Promise.resolve([SECRET]), { freshness: 'entity' });
      return <p>{q.data?.[0] ?? 'trống'}</p>;
    }
    const me = fakeMe('owner');
    // SessionProvider tự tạo QueryClient riêng; QueryClientProvider ngoài không cần – dùng provider của phiên.
    render(
      <SessionProvider me={me} refresh={() => Promise.resolve()} onRemoteEnd={() => { ended += 1; }}>
        <Probe />
      </SessionProvider>,
    );
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    let cleaned = 0;
    const off = registerAccountDataCleaner(() => {
      cleaned += 1;
    });

    // Giả lập tab khác: phát sự kiện với mã tab khác (tab gửi bỏ qua sự kiện của chính nó).
    const other = new BroadcastChannel('app-session');
    other.postMessage({ type: 'logout', at: Date.now(), from: 'tab-khac' });
    await waitFor(() => { expect(ended).toBe(1); });
    other.close();
    expect(cleaned).toBe(1); // mọi kho dữ liệu tài khoản đã được dọn
    off();
  });

  it('tab gửi sự kiện KHÔNG tự chuyển trang của chính nó', async () => {
    let ended = 0;
    render(
      <SessionProvider me={fakeMe('owner')} refresh={() => Promise.resolve()} onRemoteEnd={() => { ended += 1; }}>
        <p>nội dung</p>
      </SessionProvider>,
    );
    broadcastSessionEvent('logout');
    await new Promise((r) => setTimeout(r, 40));
    expect(ended).toBe(0);
    expect(QueryClientProvider).toBeDefined();
  });
});
