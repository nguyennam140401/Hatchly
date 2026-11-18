import type { DataDeletionStatusResponse } from '@app/shared/auth';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { socialApi } from '../../lib/api/endpoints/auth';
import { AppError } from '../../lib/api/errors';
import { formatDateTime } from '../../lib/format/datetime';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { Icon } from '../../ui/icons/Icon';
import { TextLink } from '../../ui/nav/TextLink';
import { AuthLayout } from './AuthLayout';

// Trang trạng thái CÔNG KHAI của yêu cầu xóa dữ liệu gửi từ Facebook (009, FR-009a). Không có dữ liệu
// cá nhân: chỉ trạng thái và thời điểm nhận. Mã trong đường dẫn là mã xác nhận ngẫu nhiên do Meta giữ.

type State =
  { kind: 'loading' } | { kind: 'ok'; data: DataDeletionStatusResponse } | { kind: 'missing' };

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
        if (err instanceof AppError) setState({ kind: 'missing' });
      },
    );
  }, [code]);

  const done = state.kind === 'ok' && state.data.status === 'completed';

  return (
    <AuthLayout title="Yêu cầu xóa dữ liệu từ Facebook">
      {state.kind === 'loading' && <p aria-busy="true">Đang tải…</p>}
      {state.kind === 'ok' && (
        <div role="status" className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-heading">
            <span role="img" aria-label={done ? 'Hoàn tất' : 'Thông tin'}>
              <Icon name={done ? 'check' : 'info'} />
            </span>
            {done ? 'Đã xử lý' : 'Không có dữ liệu để xóa'}
          </p>
          <p>
            {done
              ? 'Cách đăng nhập bằng Facebook đã được gỡ khỏi tài khoản tương ứng.'
              : 'Chúng tôi không lưu cách đăng nhập bằng Facebook nào cho yêu cầu này.'}
          </p>
          <p className="text-ink-muted">
            Nhận yêu cầu lúc {formatDateTime(state.data.receivedAt)}.
          </p>
        </div>
      )}
      {state.kind === 'missing' && (
        <InlineAlert
          tone="error"
          actions={[{ kind: 'navigate', label: 'Về trang đầu', href: '/' }]}
        >
          Không tìm thấy yêu cầu với mã này. Hãy kiểm tra lại liên kết Facebook đã gửi cho bạn.
        </InlineAlert>
      )}
      {state.kind !== 'missing' && <TextLink to="/">Về trang đầu</TextLink>}
    </AuthLayout>
  );
}
