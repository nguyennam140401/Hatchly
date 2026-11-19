import { useEffect, useState } from 'react';
import { channelsApi } from '../../lib/api/endpoints/channels';
import { useApiMutation } from '../../lib/api/hooks';
import { MUTATIONS } from '../../lib/api/mutations';
import { t } from '../../lib/i18n/t';
import { Button } from '../../ui/button/Button';

/**
 * Nút "Kiểm tra lại" (US3, FR-011/FR-012): có trạng thái đang chạy; `429` ⇒ vô hiệu và đếm ngược; `unavailable` ⇒ "Chưa kiểm tra
 * được, thử lại sau" (trạng thái thẻ KHÔNG đổi); kết quả thông báo qua `aria-live="polite"`.
 */
export function RecheckButton({
  connectionId,
  variant = 'secondary',
}: {
  connectionId: string;
  variant?: 'secondary' | 'ghost';
}) {
  const [wait, setWait] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const check = useApiMutation({
    operation: MUTATIONS.recheckChannel.operation,
    fn: (id: string) => channelsApi.recheck(id),
    invalidates: () => MUTATIONS.recheckChannel.invalidates(undefined, undefined),
  });

  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => {
      setWait((n) => n - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [wait]);

  const run = () => {
    setMessage(null);
    check.mutate(connectionId, {
      onSuccess: (res) => {
        setMessage(
          res.result === 'unavailable'
            ? (res.messageVi ?? t('channels.recheck.unavailable'))
            : res.result === 'changed'
              ? 'Đã kiểm tra: trạng thái kênh đã được cập nhật.'
              : 'Đã kiểm tra: kênh vẫn đủ điều kiện.',
        );
      },
      onError: (err) => {
        if (err.code === 'RECHECK_TOO_SOON') {
          setWait(err.retryAfterSeconds ?? 20);
          setMessage(null);
        } else {
          setMessage(err.message);
        }
      },
    });
  };

  const waiting = wait > 0;
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant={variant}
        icon="refresh"
        loading={check.isPending}
        locked={waiting}
        lockedReason={waiting ? t('channels.recheck.wait', { seconds: wait }) : undefined}
        onClick={() => {
          if (!waiting) run();
        }}
      >
        {check.isPending
          ? t('channels.recheck.running')
          : waiting
            ? t('channels.recheck.wait', { seconds: wait })
            : t('channels.recheck')}
      </Button>
      <p aria-live="polite" className="text-caption text-ink-muted">
        {message}
      </p>
    </div>
  );
}
