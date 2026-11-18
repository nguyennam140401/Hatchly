import type { VersionListItem } from '@app/shared/context';
import { useCallback, useEffect, useState } from 'react';
import { contextApi } from '../../lib/api/endpoints/context';
import { AppError } from '../../lib/api/errors';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { Button } from '../../ui/button/Button';
import { TextLink } from '../../ui/nav/TextLink';
import { formatVnTime, savedByLabel } from './labels';

// Lịch sử phiên bản (006 US5): mới nhất trước, 20 dòng/trang, "Xem thêm" tải trang kế; người đã rời →
// "Thành viên đã rời". Thu gọn trên điện thoại (<details>). `reloadKey` đổi → tải lại từ trang 1.

export function VersionHistory({ reloadKey }: { reloadKey: number }) {
  const [items, setItems] = useState<VersionListItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const [open] = useState(
    () =>
      typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 720px)').matches,
  );

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await contextApi.listVersions(p);
      setItems((prev) => (p === 1 ? res.items : [...prev, ...res.items]));
      setPage(res.page);
      setTotal(res.total);
    } catch (err) {
      if (err instanceof AppError) setError(err);
      else throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tải lịch sử khi mở/sau khi lưu
    void load(1);
  }, [load, reloadKey]);

  return (
    <details open={open} className="mt-6">
      <summary className="flex min-h-touch cursor-pointer items-center">
        <h2 className="text-heading">Lịch sử phiên bản ({total})</h2>
      </summary>
      {error !== null && (
        <ErrorNotice
          error={error}
          actions={[{ kind: 'retry', label: 'Thử lại' }]}
          onRetry={() => {
            void load(page);
          }}
        />
      )}
      {!loading && error === null && items.length === 0 && (
        <p>Chưa có phiên bản nào – lưu hồ sơ lần đầu để bắt đầu.</p>
      )}
      <ol aria-busy={loading}>
        {items.map((v) => (
          <li key={v.versionId} className="border-b border-line">
            <TextLink to={`/business-profile/versions/${v.versionId}`}>
              Phiên bản {v.version} · {formatVnTime(v.savedAt)} · {savedByLabel(v.savedBy)}
            </TextLink>
          </li>
        ))}
      </ol>
      {loading && <p>Đang tải lịch sử…</p>}
      {!loading && items.length < total && (
        <div className="mt-2">
          <Button
            variant="secondary"
            onClick={() => {
              void load(page + 1);
            }}
          >
            Xem thêm
          </Button>
        </div>
      )}
    </details>
  );
}
