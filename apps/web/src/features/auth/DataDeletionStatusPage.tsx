import type { DataDeletionStatusResponse } from '@app/shared/auth';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { AuthLayout } from './AuthLayout';
import { socialApi } from './social-api';
import { styles } from './ui';

// Trang trạng thái CÔNG KHAI của yêu cầu xóa dữ liệu gửi từ Facebook (009, FR-009a). Không có dữ liệu
// cá nhân: chỉ trạng thái và thời điểm nhận. Mã trong đường dẫn là mã xác nhận ngẫu nhiên do Meta giữ.

type State =
  { kind: 'loading' } | { kind: 'ok'; data: DataDeletionStatusResponse } | { kind: 'missing' };

function dateTimeVi(iso: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function DataDeletionStatusPage() {
  const { code } = useParams();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (code === undefined) return;
    socialApi.dataDeletionStatus(code).then(
      (data) => {
        setState({ kind: 'ok', data });
      },
      (err: unknown) => {
        if (err instanceof ApiError) setState({ kind: 'missing' });
      },
    );
  }, [code]);

  return (
    <AuthLayout title="Yêu cầu xóa dữ liệu từ Facebook">
      {state.kind === 'loading' && <p aria-busy="true">Đang tải…</p>}
      {state.kind === 'ok' && (
        <div role="status">
          <p style={{ fontSize: 18 }}>
            <span
              role="img"
              aria-label={state.data.status === 'completed' ? 'Hoàn tất' : 'Thông tin'}
            >
              {state.data.status === 'completed' ? '✓' : 'ℹ'}
            </span>{' '}
            {state.data.status === 'completed' ? 'Đã xử lý' : 'Không có dữ liệu để xóa'}
          </p>
          <p>
            {state.data.status === 'completed'
              ? 'Cách đăng nhập bằng Facebook đã được gỡ khỏi tài khoản tương ứng.'
              : 'Chúng tôi không lưu cách đăng nhập bằng Facebook nào cho yêu cầu này.'}
          </p>
          <p style={{ color: '#4b5563' }}>Nhận yêu cầu lúc {dateTimeVi(state.data.receivedAt)}.</p>
        </div>
      )}
      {state.kind === 'missing' && (
        <p role="alert">
          <span role="img" aria-label="Cảnh báo">
            ⚠
          </span>{' '}
          Không tìm thấy yêu cầu với mã này. Hãy kiểm tra lại liên kết Facebook đã gửi cho bạn.
        </p>
      )}
      <p>
        <Link to="/" style={styles.link}>
          Về trang đầu
        </Link>
      </p>
    </AuthLayout>
  );
}
