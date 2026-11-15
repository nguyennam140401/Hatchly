import { useState } from 'react';
import { ApiError } from '../../lib/api-client';
import { browser, PROVIDER_LABELS, socialApi, type Provider } from './social-api';
import { ErrorNotice, styles } from './ui';

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
  const [error, setError] = useState<ApiError | null>(null);

  async function go(provider: Provider) {
    setError(null);
    setBusy(provider);
    try {
      const { authorizationUrl } = await start(provider);
      browser.assign(authorizationUrl);
    } catch (err) {
      setBusy(null);
      if (!(err instanceof ApiError)) throw err;
      setError(err);
    }
  }

  return (
    <div>
      {error !== null && <ErrorNotice error={error} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {PROVIDERS.filter((p) => only === undefined || only.includes(p)).map((provider) => (
          <button
            key={provider}
            type="button"
            style={{
              ...styles.secondary,
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              ...(disabled ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
            }}
            disabled={disabled || busy !== null}
            onClick={() => void go(provider)}
          >
            <span aria-hidden="true" style={{ fontWeight: 700 }}>
              {MARKS[provider]}
            </span>
            {busy === provider ? 'Đang chuyển…' : label(PROVIDER_LABELS[provider])}
          </button>
        ))}
      </div>
      {disabled && disabledHint !== undefined && (
        <p style={{ margin: '8px 0 0', fontSize: 14, color: '#4b5563' }}>{disabledHint}</p>
      )}
    </div>
  );
}
