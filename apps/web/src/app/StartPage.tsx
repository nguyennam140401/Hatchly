import type { HealthResponse } from '@app/shared/core';
import { useCallback, useContext, useEffect, useState } from 'react';
import { authApi } from '../lib/api/endpoints/auth';
import { healthApi } from '../lib/api/endpoints/health';
import { AppError } from '../lib/api/errors';
import { SessionContext } from '../lib/session/context';
import { Button } from '../ui/button/Button';
import { Page } from '../ui/layout/Page';
import { PageHeader } from '../ui/layout/PageHeader';
import { TextLink } from '../ui/nav/TextLink';

// Trang khởi đầu (FR-016): trạng thái API bằng chữ tiếng Việt + biểu tượng có nhãn – không chỉ dựa
// vào màu; nút "Thử lại" ≥ 44 × 44 px; dùng được từ 360 px (nguyên tắc VI).

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; health: HealthResponse }
  | { kind: 'error'; message?: string };

export function StartPage() {
  const session = useContext(SessionContext);
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ok', health: await healthApi.get() });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      // Chỉ lỗi do máy chủ trả về mới có lời giải thích riêng; mạng/sai hình dùng lời nhắn mặc định.
      setState(err.kind === 'network' || err.kind === 'invalid_response' ? { kind: 'error' } : { kind: 'error', message: err.message });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tải dữ liệu lần đầu khi mở trang
    void load();
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-md px-gutter py-6">
      <Page>
        <PageHeader title="Trợ lý đăng bài" />
        {session !== null && (
          <nav aria-label="Tài khoản" className="flex flex-wrap items-center gap-2">
            <span>Xin chào, {session.me.user.displayName}</span>
            <TextLink to="/business-profile">Hồ sơ kinh doanh</TextLink>
            {session.me.permissions.includes('members.manage') && (
              <TextLink to="/settings/members">Thành viên</TextLink>
            )}
            <TextLink to="/settings/security">Bảo mật</TextLink>
            <Button
              variant="secondary"
              onClick={() => {
                void authApi.logout().finally(() => {
                  window.location.assign('/login');
                });
              }}
            >
              Đăng xuất
            </Button>
          </nav>
        )}
        <section aria-live="polite" className="flex flex-col gap-2">
          {state.kind === 'loading' && <p>Đang kiểm tra kết nối…</p>}
          {state.kind === 'ok' && (
            <>
              <p className="flex items-center gap-2 text-heading">
                <span role="img" aria-label="Thành công" className="text-success">
                  ✓
                </span>
                <span>API đang hoạt động</span>
              </p>
              <p className="text-caption text-ink-muted">Phiên bản {state.health.version}</p>
            </>
          )}
          {state.kind === 'error' && (
            <>
              <p className="flex items-center gap-2 text-heading">
                <span role="img" aria-label="Cảnh báo" className="text-warning">
                  ⚠
                </span>
                <span>Không kết nối được API</span>
              </p>
              <p>{state.message ?? 'Vui lòng kiểm tra máy chủ API đã chạy chưa rồi thử lại.'}</p>
              <div>
                <Button onClick={() => void load()}>Thử lại</Button>
              </div>
            </>
          )}
        </section>
      </Page>
    </div>
  );
}
