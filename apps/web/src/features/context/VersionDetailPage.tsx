import type { VersionDetailResponse } from '@app/shared/context';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { contextApi } from '../../lib/api/endpoints/context';
import { AppError } from '../../lib/api/errors';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { useSession } from '../../lib/session/context';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { Page } from '../../ui/layout/Page';
import { PageHeader } from '../../ui/layout/PageHeader';
import { TextLink } from '../../ui/nav/TextLink';
import { formatVnTime, savedByLabel } from './labels';
import { formFromFields, ProfileForm } from './ProfileForm';

// Bản cũ – chỉ xem (006 US5): cùng biểu mẫu ở chế độ readOnly, không có nút khôi phục.

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; version: VersionDetailResponse }
  | { kind: 'error'; error: AppError };

function Wrap({ children, busy }: { children: React.ReactNode; busy?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-gutter py-6">
      <Page busy={busy === true}>{children}</Page>
    </div>
  );
}

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
      if (err instanceof AppError) setState({ kind: 'error', error: err });
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
      <Wrap>
        <PageHeader title="Hồ sơ kinh doanh" />
        <InlineAlert tone="error" actions={[{ kind: 'navigate', label: 'Về Tổng quan', href: '/' }]}>
          Bạn không có quyền xem hồ sơ kinh doanh.
        </InlineAlert>
      </Wrap>
    );
  }

  return (
    <Wrap busy={state.kind === 'loading'}>
      <TextLink to="/business-profile">← Hồ sơ kinh doanh</TextLink>
      <PageHeader title="Bản cũ – chỉ xem" />
      {state.kind === 'loading' && (
        <p>
          <span aria-hidden="true">⏳ </span>Đang tải phiên bản…
        </p>
      )}
      {state.kind === 'error' && (
        <ErrorNotice
          error={state.error}
          onRetry={() => {
            void load();
          }}
          actions={
            state.error.code === 'NOT_FOUND'
              ? [
                  {
                    kind: 'navigate',
                    label: state.error.actions[0].label,
                    href: '/business-profile',
                  },
                ]
              : [{ kind: 'retry', label: 'Thử lại' }]
          }
        />
      )}
      {state.kind === 'ok' && (
        <>
          <p className="text-ink-muted">
            <span aria-hidden="true">🗂 </span>
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
    </Wrap>
  );
}
