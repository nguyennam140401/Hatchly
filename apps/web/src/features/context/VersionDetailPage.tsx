import type { VersionDetailResponse } from '@app/shared/context';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { useSession } from '../auth/session';
import { ErrorNotice, styles } from '../auth/ui';
import { contextApi, formatVnTime, savedByLabel } from './context-api';
import { formFromFields, ProfileForm } from './ProfileForm';

// Bản cũ – chỉ xem (006 US5): cùng biểu mẫu ở chế độ readOnly, không có nút khôi phục.

const page: CSSProperties = { ...styles.page, maxWidth: 720 };

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; version: VersionDetailResponse }
  | { kind: 'error'; error: ApiError };

export function VersionDetailPage() {
  const { me } = useSession();
  const { versionId = '' } = useParams();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const canView = me.permissions.includes('context.view');

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ok', version: await contextApi.getVersion(versionId) });
    } catch (err) {
      if (err instanceof ApiError) setState({ kind: 'error', error: err });
      else throw err;
    }
  }, [versionId]);

  useEffect(() => {
    if (!canView) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tải phiên bản khi mở trang
    void load();
  }, [canView, load]);

  if (!canView) {
    return (
      <main style={page}>
        <h1 style={{ fontSize: 24 }}>Hồ sơ kinh doanh</h1>
        <div role="alert" style={{ border: '1px solid #b91c1c', borderRadius: 8, padding: 12 }}>
          <p style={{ marginTop: 0 }}>
            <span role="img" aria-label="Không có quyền">
              ⛔
            </span>{' '}
            Bạn không có quyền xem hồ sơ kinh doanh.
          </p>
          <Link to="/" style={styles.link}>
            Về Tổng quan
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={page} aria-busy={state.kind === 'loading'}>
      <p style={{ margin: '0 0 8px' }}>
        <Link to="/business-profile" style={styles.link}>
          ← Hồ sơ kinh doanh
        </Link>
      </p>
      <h1 style={{ fontSize: 24, margin: '0 0 8px' }}>Bản cũ – chỉ xem</h1>
      {state.kind === 'loading' && (
        <p>
          <span aria-hidden="true">⏳ </span>Đang tải phiên bản…
        </p>
      )}
      {state.kind === 'error' && (
        <ErrorNotice error={state.error}>
          {state.error.code === 'NOT_FOUND' ? (
            <Link to="/business-profile" style={styles.link}>
              {state.error.body?.actions[0]?.label ?? 'Về hồ sơ kinh doanh'}
            </Link>
          ) : (
            <button type="button" style={styles.secondary} onClick={() => void load()}>
              Thử lại
            </button>
          )}
        </ErrorNotice>
      )}
      {state.kind === 'ok' && (
        <>
          <p style={{ marginTop: 0, color: '#4b5563' }}>
            <span role="img" aria-label="Bản lưu trữ">
              🗂
            </span>{' '}
            Phiên bản {state.version.version}
            {state.version.isCurrent ? ' (hiện hành)' : ''} · lưu lúc{' '}
            {formatVnTime(state.version.savedAt)} (giờ Việt Nam) · bởi{' '}
            {savedByLabel(state.version.savedBy)}
          </p>
          <ProfileForm
            value={formFromFields(state.version.fields)}
            errors={{}}
            readOnly
            onChange={() => undefined}
          />
        </>
      )}
    </main>
  );
}
