import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { socialApi, takeFragmentToken } from '../../lib/api/endpoints/auth';
import { AppError } from '../../lib/api/errors';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import type { ErrorActionView } from '../../lib/catalogs/error-explanations';
import { TextLink } from '../../ui/nav/TextLink';
import { AuthLayout } from './AuthLayout';

// Mở liên kết trong thư "hoàn tất đăng ký" / "xác nhận liên kết" (009 – US1, US2). Mã nằm sau `#token=`
// và được XÓA khỏi thanh địa chỉ trước khi gọi API. Dùng được trên thiết bị khác với thiết bị bắt đầu.

type State = { kind: 'working' } | { kind: 'missing' } | { kind: 'invalid'; error: AppError };

// Bắt đầu lại ở trang đăng nhập sẽ gửi thư mới (liên kết cũ chỉ dùng một lần).
const RESTART: ErrorActionView[] = [
  { kind: 'navigate', label: 'Gửi lại', href: '/login' },
  { kind: 'navigate', label: 'Về đăng nhập', href: '/login' },
];

export function OAuthConfirmPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'working' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode gọi hiệu ứng hai lần – mã chỉ dùng được một lần.
    started.current = true;
    const token = takeFragmentToken();
    if (token === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- không có mã thì báo ngay
      setState({ kind: 'missing' });
      return;
    }
    socialApi.oauthConfirm(token).then(
      () => void navigate('/', { replace: true }),
      (err: unknown) => {
        if (err instanceof AppError) setState({ kind: 'invalid', error: err });
      },
    );
  }, [navigate]);

  if (state.kind === 'working') {
    return (
      <AuthLayout title="Đang xác nhận">
        <p aria-busy="true">Đang xác nhận…</p>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Liên kết không dùng được">
      {state.kind === 'invalid' ? (
        <ErrorNotice error={state.error} actions={RESTART} />
      ) : (
        <>
          <p>Hãy mở lại liên kết trong thư gần nhất, hoặc bắt đầu đăng nhập lại để nhận thư mới.</p>
          <TextLink to="/login">Gửi lại</TextLink>
          <TextLink to="/login">Về đăng nhập</TextLink>
        </>
      )}
    </AuthLayout>
  );
}
