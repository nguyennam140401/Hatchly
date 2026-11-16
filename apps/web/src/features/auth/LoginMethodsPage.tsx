import type { LoginMethod, LoginMethodsResponse } from '@app/shared/auth';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { browser, PROVIDER_LABELS, socialApi, type Provider } from '../../lib/api/endpoints/auth';
import { AppError } from '../../lib/api/errors';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { objectSchema } from '../../lib/forms/rules';
import { useAppForm } from '../../lib/forms/useAppForm';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { Modal } from '../../ui/alert/Modal';
import { Button } from '../../ui/button/Button';
import { Form } from '../../ui/form/Form';
import { TextLink } from '../../ui/nav/TextLink';
import { AuthLayout } from './AuthLayout';
import { PasswordField } from '../../ui/form/fields/PasswordField';
import { ProviderButtons } from './ProviderButtons';

// Cài đặt → Cách đăng nhập (009 – US5). Luôn ba dòng: mật khẩu, Google, Facebook. Liên kết, gỡ, tạo
// mật khẩu đòi "mới xác nhận lại đây là bạn" trong 10 phút: máy chủ trả REAUTH_REQUIRED → trang mở hộp
// xác nhận lại rồi TỰ làm lại thao tác đang dở. Dùng được cho chủ, cộng tác viên, người ở tài khoản chờ.

type Kind = LoginMethod['kind'];
const LABELS: Record<Kind, string> = {
  password: 'Mật khẩu',
  google: 'Google',
  facebook: 'Facebook',
};

type OAuthResult =
  | { ok: true; purpose: 'link' | 'reauth'; provider: Provider }
  | { ok: false; message: string | null };

/** Thao tác đang dở, làm lại sau khi xác nhận lại danh tính. */
interface Pending {
  label: string;
  run: () => Promise<void>;
}

export function LoginMethodsPage() {
  const location = useLocation();
  const [data, setData] = useState<LoginMethodsResponse | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reauthFor, setReauthFor] = useState<Pending | null>(null);
  const shown = useRef(false);

  const load = useCallback(async () => {
    try {
      setData(await socialApi.loginMethods());
    } catch (err) {
      if (err instanceof AppError) setError(err);
      else throw err;
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tải danh sách khi mở trang
    void load();
    if (shown.current) return;
    shown.current = true;
    // Kết quả sau vòng nhà cung cấp (OAuthResultPage chuyển về đây kèm trạng thái điều hướng).
    const result = (location.state as { oauthResult?: OAuthResult } | null)?.oauthResult;
    if (result === undefined) return;
    if (result.ok) {
      setNotice(
        result.purpose === 'link'
          ? `Đã liên kết ${PROVIDER_LABELS[result.provider]}.`
          : 'Đã xác nhận đây là bạn. Bạn có thể tiếp tục thao tác.',
      );
    } else {
      setNotice(result.message ?? 'Chưa thực hiện được. Hãy thử lại.');
    }
  }, [load, location.state]);

  /** Chạy một thao tác; gặp REAUTH_REQUIRED thì mở hộp xác nhận lại và nhớ thao tác để làm lại. */
  async function attempt(action: Pending) {
    setError(null);
    setNotice(null);
    try {
      await action.run();
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      if (err.code === 'REAUTH_REQUIRED') setReauthFor(action);
      else setError(err);
    }
  }

  const link = (provider: Provider): Pending => ({
    label: `liên kết ${PROVIDER_LABELS[provider]}`,
    run: async () => {
      const { authorizationUrl } = await socialApi.loginMethodStart(provider, 'link');
      browser.assign(authorizationUrl);
    },
  });
  const remove = (kind: Kind): Pending => ({
    label: `gỡ ${LABELS[kind]}`,
    run: async () => {
      await socialApi.removeLoginMethod(kind);
      setNotice(`Đã gỡ cách đăng nhập bằng ${LABELS[kind]}.`);
      await load();
    },
  });
  const createPassword: Pending = {
    label: 'tạo mật khẩu',
    run: async () => {
      await socialApi.requestPassword();
      setNotice('Chúng tôi đã gửi thư tạo mật khẩu tới email của bạn.');
    },
  };

  const linked = data?.methods.filter((m) => m.linked) ?? [];

  return (
    <AuthLayout title="Cách đăng nhập">
      <p>Bạn có thể đăng nhập bằng bất kỳ cách nào đã liên kết dưới đây.</p>
      {notice !== null && <InlineAlert tone="info">{notice}</InlineAlert>}
      {error !== null && (
        <ErrorNotice
          error={error}
          actions={[{ kind: 'retry', label: 'Tải lại' }]}
          onRetry={() => {
            void load();
          }}
        />
      )}
      {data === null && error === null && <p aria-busy="true">Đang tải…</p>}

      {data !== null && (
        <ul className="flex flex-col">
          {data.methods.map((method) => (
            <li
              key={method.kind}
              aria-label={LABELS[method.kind]}
              className="flex flex-col gap-2 border-t border-line py-3"
            >
              <p className="text-label">{LABELS[method.kind]}</p>
              {/* Trạng thái bằng chữ + biểu tượng – không chỉ dựa vào màu. */}
              <p>
                <span aria-hidden="true">{method.linked ? '✓ ' : '○ '}</span>
                {method.linked ? 'Đã liên kết' : 'Chưa liên kết'}
                {method.linked && method.kind !== 'password' && (
                  <>
                    {' · '}
                    {[method.providerDisplayName, method.providerEmail]
                      .filter((v) => v !== undefined)
                      .join(' – ')}
                  </>
                )}
              </p>
              <div>
                {method.linked ? (
                  <Button variant="secondary" onClick={() => void attempt(remove(method.kind))}>
                    Gỡ {LABELS[method.kind]}
                  </Button>
                ) : method.kind === 'password' ? (
                  <Button variant="secondary" onClick={() => void attempt(createPassword)}>
                    Tạo mật khẩu
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => void attempt(link(method.kind as Provider))}
                  >
                    Liên kết {LABELS[method.kind]}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {reauthFor !== null && (
        <ReauthDialog
          action={reauthFor}
          linked={linked.map((m) => m.kind)}
          onDone={() => {
            const action = reauthFor;
            setReauthFor(null);
            void attempt(action);
          }}
          onCancel={() => {
            setReauthFor(null);
          }}
        />
      )}

      <p className="flex flex-wrap gap-4">
        <TextLink to="/settings/security">Bảo mật</TextLink>
        <TextLink to="/">Về trang chính</TextLink>
      </p>
    </AuthLayout>
  );
}

interface ReauthValues extends Record<string, unknown> {
  password: string;
}

/** Hộp "Hãy xác nhận lại đây là bạn": ô mật khẩu nếu có mật khẩu, nút nhà cung cấp đã liên kết. */
function ReauthDialog({
  action,
  linked,
  onDone,
  onCancel,
}: {
  action: Pending;
  linked: Kind[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const providers = linked.filter((k): k is Provider => k !== 'password');
  const form = useAppForm<ReauthValues>({
    schema: objectSchema<ReauthValues>({}),
    defaultValues: { password: '' },
    onSubmit: async (values) => {
      try {
        await socialApi.reauth(values.password);
        onDone();
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        form.methods.setValue('password', '');
        if (err.code === 'INVALID_CREDENTIALS') {
          throw new AppError({
            kind: 'validation',
            status: err.status,
            code: err.code,
            message: err.message,
            actions: err.actions,
            fieldErrors: { password: err.message },
            support: err.support,
          });
        }
        throw err;
      }
    },
  });
  const password = form.methods.watch('password');

  return (
    <Modal
      open
      role="alertdialog"
      title="Hãy xác nhận lại đây là bạn"
      description={`Để ${action.label}, bạn cần xác nhận lại danh tính. Sau đó thao tác sẽ tự tiếp tục.`}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      {linked.includes('password') && (
        <Form
          form={form}
          submitLabel="Xác nhận"
          {...(password === '' ? { submitLocked: 'Nhập mật khẩu để xác nhận.' } : {})}
          errorActions={(e) => e.actions}
        >
          <PasswordField name="password" label="Mật khẩu" autoComplete="current-password" />
        </Form>
      )}
      {providers.length > 0 && (
        <ProviderButtons
          only={providers}
          label={(name) => `Xác nhận bằng ${name}`}
          start={(provider) => socialApi.loginMethodStart(provider, 'reauth')}
        />
      )}
      <div>
        <Button variant="secondary" onClick={onCancel}>
          Hủy
        </Button>
      </div>
    </Modal>
  );
}
