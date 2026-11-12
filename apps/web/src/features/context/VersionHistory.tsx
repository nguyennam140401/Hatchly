import type { VersionListItem } from '@app/shared/context';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { ErrorNotice, styles } from '../auth/ui';
import { contextApi, formatVnTime, savedByLabel } from './context-api';

// Lịch sử phiên bản (006 US5): mới nhất trước, 20 dòng/trang, "Xem thêm" tải trang kế; người đã rời →
// "Thành viên đã rời". Thu gọn trên điện thoại (<details>). `reloadKey` đổi → tải lại từ trang 1.

export function VersionHistory({ reloadKey }: { reloadKey: number }) {
  const [items, setItems] = useState<VersionListItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
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
      if (err instanceof ApiError) setError(err);
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
    <details open={open} style={{ marginTop: 24 }}>
      <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Lịch sử phiên bản ({total})</h2>
      </summary>
      {error !== null && (
        <ErrorNotice error={error}>
          <button type="button" style={styles.secondary} onClick={() => void load(page)}>
            Thử lại
          </button>
        </ErrorNotice>
      )}
      {!loading && error === null && items.length === 0 && (
        <p>Chưa có phiên bản nào – lưu hồ sơ lần đầu để bắt đầu.</p>
      )}
      <ol style={{ listStyle: 'none', padding: 0, margin: 0 }} aria-busy={loading}>
        {items.map((v) => (
          <li key={v.versionId} style={{ borderBottom: '1px solid #e5e7eb' }}>
            <Link to={`/business-profile/versions/${v.versionId}`} style={styles.link}>
              Phiên bản {v.version} · {formatVnTime(v.savedAt)} · {savedByLabel(v.savedBy)}
            </Link>
          </li>
        ))}
      </ol>
      {loading && <p>Đang tải lịch sử…</p>}
      {!loading && items.length < total && (
        <button
          type="button"
          style={{ ...styles.secondary, marginTop: 8 }}
          onClick={() => void load(page + 1)}
        >
          Xem thêm
        </button>
      )}
    </details>
  );
}
