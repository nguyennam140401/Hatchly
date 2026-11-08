import type { HealthResponse } from '@app/shared/core';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { getHealth } from '../lib/api-client';

// Trang khởi đầu (FR-016): trạng thái API bằng chữ tiếng Việt + biểu tượng có nhãn – không chỉ dựa
// vào màu; nút "Thử lại" ≥ 44 × 44 px; dùng được từ 360 px (nguyên tắc VI).

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; health: HealthResponse }
  | { kind: 'error'; message?: string };

const page: CSSProperties = {
  boxSizing: 'border-box',
  maxWidth: 480,
  minWidth: 0,
  margin: '0 auto',
  padding: 16,
  fontFamily: 'system-ui, sans-serif',
  lineHeight: 1.5,
  color: '#1a1a1a',
};

const statusRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 18 };

const retryButton: CSSProperties = {
  minWidth: 44,
  minHeight: 44,
  padding: '8px 16px',
  fontSize: 16,
  borderRadius: 8,
  border: '1px solid #1d4ed8',
  background: '#1d4ed8',
  color: '#fff',
  cursor: 'pointer',
};

export function StartPage() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    const result = await getHealth();
    setState(
      result.ok
        ? { kind: 'ok', health: result.data }
        : { kind: 'error', ...(result.message !== undefined ? { message: result.message } : {}) },
    );
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tải dữ liệu lần đầu khi mở trang
    void load();
  }, [load]);

  return (
    <main style={page}>
      <h1 style={{ fontSize: 24, margin: '0 0 16px' }}>Trợ lý đăng bài</h1>
      <section aria-live="polite">
        {state.kind === 'loading' && <p>Đang kiểm tra kết nối…</p>}
        {state.kind === 'ok' && (
          <>
            <p style={statusRow}>
              <span role="img" aria-label="Thành công" style={{ color: '#15803d' }}>
                ✓
              </span>
              <span>API đang hoạt động</span>
            </p>
            <p style={{ color: '#4b5563', fontSize: 14 }}>Phiên bản {state.health.version}</p>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <p style={statusRow}>
              <span role="img" aria-label="Cảnh báo" style={{ color: '#b45309' }}>
                ⚠
              </span>
              <span>Không kết nối được API</span>
            </p>
            <p>{state.message ?? 'Vui lòng kiểm tra máy chủ API đã chạy chưa rồi thử lại.'}</p>
            <button type="button" style={retryButton} onClick={() => void load()}>
              Thử lại
            </button>
          </>
        )}
      </section>
    </main>
  );
}
