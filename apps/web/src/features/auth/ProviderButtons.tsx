import { useState } from 'react';
import { browser, PROVIDER_LABELS, socialApi, type Provider } from '../../lib/api/endpoints/auth';
import { AppError } from '../../lib/api/errors';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { Button } from '../../ui/button/Button';

// Hai nút "Tiếp tục với Google / Facebook" (009 – US1). Bấm → hỏi máy chủ địa chỉ của nhà cung cấp rồi
// chuyển trình duyệt sang đó. Vùng chạm ≥ 44 × 44 px; có chữ + biểu tượng (không chỉ dựa vào màu).
// `start` cho phép trang khác (lời mời, cách đăng nhập) dùng lại nút với mục đích riêng.

const PROVIDERS: readonly Provider[] = ['google', 'facebook'];
const MARKS: Record<Provider, string> = { google: 'G', facebook: 'f' };

export function ProviderButtons({
  start = (provider) => socialApi.oauthStart(provider),
  label = (name) => `Tiếp tục với ${name}`,
  only,
  disabled = false,
  disabledHint,
}: {
  start?: (provider: Provider) => Promise<{ authorizationUrl: string }>;
  label?: (providerName: string) => string;
  /** Chỉ hiện các nhà cung cấp này (vd cách đã liên kết khi xác nhận lại danh tính). */
  only?: readonly Provider[];
  disabled?: boolean;
  /** Lời giải thích khi nút bị khóa (vd chưa tích ô đồng ý). */
  disabledHint?: string;
}) {
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  async function go(provider: Provider) {
    setError(null);
    setBusy(provider);
    try {
      const { authorizationUrl } = await start(provider);
      browser.assign(authorizationUrl);
    } catch (err) {
      setBusy(null);
      if (!(err instanceof AppError)) throw err;
      setError(err);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error !== null && <ErrorNotice error={error} />}
      <div className="flex flex-col gap-2">
        {PROVIDERS.filter((p) => only === undefined || only.includes(p)).map((provider) => (
          <Button
            key={provider}
            variant="secondary"
            fullWidth
            locked={disabled || busy !== null}
            onClick={() => void go(provider)}
          >
            <span aria-hidden="true" className="font-semibold">
              {MARKS[provider]}
            </span>
            {busy === provider ? 'Đang chuyển…' : label(PROVIDER_LABELS[provider])}
          </Button>
        ))}
      </div>
      {disabled && disabledHint !== undefined && (
        <p className="text-body-sm text-ink-muted">{disabledHint}</p>
      )}
    </div>
  );
}
