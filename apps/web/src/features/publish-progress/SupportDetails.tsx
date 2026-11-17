import { useState } from 'react';
import { publishingApi } from '../../lib/api/endpoints/publishing';
import { useApiQuery } from '../../lib/api/hooks';
import { queryKeys } from '../../lib/api/query-keys';
import { Button } from '../../ui/button/Button';

/**
 * "Chi tiết cho hỗ trợ" – THU GỌN mặc định (nguyên tắc VI: mã lỗi gốc chỉ hiện ở đây). Chỉ gọi API khi người dùng mở.
 * "Gửi cho hỗ trợ" sao chép mã lượt đăng + mã theo dõi để dán vào kênh hỗ trợ.
 */
export function SupportDetails({ attemptId }: { attemptId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const query = useApiQuery(
    queryKeys.publishing.support(attemptId),
    () => publishingApi.supportDetails(attemptId),
    { freshness: 'volatile', enabled: open },
  );
  const d = query.data;

  const copy = async () => {
    const text = [
      `Mã lượt đăng: ${attemptId}`,
      d?.traceId !== undefined ? `Mã theo dõi: ${d.traceId}` : '',
      d?.rawCode ? `Mã lỗi: ${d.rawCode}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <details
      className="rounded-md border border-line px-3 py-2 text-caption text-ink"
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
      }}
    >
      <summary className="min-h-touch cursor-pointer py-2 text-label text-brand">
        Chi tiết cho hỗ trợ
      </summary>
      <div className="flex flex-col gap-2 pb-2">
        {query.isPending && <p>Đang tải…</p>}
        {query.isError && <p>Chưa tải được chi tiết. Hãy thử mở lại sau ít phút.</p>}
        {d !== undefined && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-ink-muted">Mã lượt đăng</dt>
            <dd className="break-all">{d.attemptId}</dd>
            <dt className="text-ink-muted">Mã lỗi gốc</dt>
            <dd className="break-all">{d.rawCode ?? 'Không có'}</dd>
            {d.errorCategoryLabel !== null && (
              <>
                <dt className="text-ink-muted">Loại lỗi</dt>
                <dd>{d.errorCategoryLabel}</dd>
              </>
            )}
            <dt className="text-ink-muted">Mã theo dõi</dt>
            <dd className="break-all">{d.traceId}</dd>
            <dt className="text-ink-muted">Lần chạy</dt>
            <dd>{d.runNo}</dd>
          </dl>
        )}
        <div>
          <Button variant="secondary" onClick={() => void copy()}>
            {copied ? 'Đã sao chép – dán vào tin nhắn cho hỗ trợ' : 'Gửi cho hỗ trợ'}
          </Button>
        </div>
      </div>
    </details>
  );
}
