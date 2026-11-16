import type { ReactNode } from 'react';
import { FormProvider, type FieldValues } from 'react-hook-form';
import { useNavigate } from 'react-router';
import type { AppError } from '../../lib/api/errors';
import type { ErrorActionView } from '../../lib/catalogs/error-explanations';
import type { AppForm } from '../../lib/forms/useAppForm';
import { t } from '../../lib/i18n/t';
import { ConfirmDialog } from '../alert/ConfirmDialog';
import { InlineAlert } from '../alert/InlineAlert';
import { Button } from '../button/Button';
import { ConflictNotice } from './ConflictNotice';
import { FormUiContext } from './form-context';

export interface FormProps<T extends FieldValues> {
  form: AppForm<T>;
  title?: string;
  submitLabel: string;
  onCancel?: () => void;
  cancelLabel?: string;
  /** Lý do khi chỉ xem (mặc định "Chỉ chủ tài khoản mới sửa được"). */
  readOnlyReason?: string;
  /** Dựng khung "Bản của bạn" khi xung đột; mặc định liệt kê giá trị đơn giản. */
  renderMine?: (mine: T) => ReactNode;
  /** Hành động khắc phục của lỗi chung (mặc định: "Thử lại"); vd đăng nhập sai → "Quên mật khẩu". Luôn ≥ 1. */
  /** Khóa nút Gửi kèm lý do hiện dưới nút (vd chưa tích ô đồng ý). Nút vẫn focus được để đọc lý do. */
  submitLocked?: string;
  errorActions?: (error: AppError) => [ErrorActionView, ...ErrorActionView[]];
  children: ReactNode;
}

function defaultMine(mine: Record<string, unknown>): ReactNode {
  return (
    <dl className="flex flex-col gap-1">
      {Object.entries(mine).map(([key, value]) => (
        <div key={key}>
          <dt className="inline text-label">{key}: </dt>
          <dd className="inline">{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Vỏ biểu mẫu: `<form noValidate>`, lỗi chung ở đầu (kèm "Thử lại"), vùng nút Gửi/Hủy, thông báo chỉ xem, xung đột phiên bản
 * và hộp "Bỏ các thay đổi chưa lưu?" khi rời trang.
 */
export function Form<T extends FieldValues>({
  form,
  title,
  submitLabel,
  onCancel,
  cancelLabel,
  readOnlyReason,
  renderMine,
  errorActions,
  submitLocked,
  children,
}: FormProps<T>) {
  const { blocker } = form;
  const navigate = useNavigate();
  return (
    <FormProvider {...form.methods}>
      <FormUiContext.Provider value={{ readOnly: form.readOnly }}>
        <form
          noValidate
          onSubmit={(event) => {
            void form.submit(event);
          }}
          aria-busy={form.submitting || undefined}
          className="flex flex-col gap-4"
        >
          {title !== undefined && <h2 className="text-heading text-ink">{title}</h2>}

          {form.readOnly && (
            <InlineAlert tone="info">{readOnlyReason ?? t('form.readOnly')}</InlineAlert>
          )}

          {form.submitError !== null && (
            <InlineAlert
              tone="error"
              actions={
                errorActions?.(form.submitError) ?? [{ kind: 'retry', label: t('common.retry') }]
              }
              onAction={(action) => {
                if (action.kind === 'navigate' && action.href !== undefined)
                  void navigate(action.href);
                else void form.retry();
              }}
              support={{ traceId: form.submitError.support.traceId, code: form.submitError.code }}
            >
              {form.submitError.message}
            </InlineAlert>
          )}

          {form.conflict !== null && (
            <ConflictNotice
              loaded={form.conflict.loaded}
              mine={
                renderMine !== undefined
                  ? renderMine(form.conflict.mine)
                  : defaultMine(form.conflict.mine)
              }
              onLoadLatest={() => {
                void form.loadLatest();
              }}
              onKeepMine={() => {
                void form.keepMine();
              }}
              onDismiss={form.dismissConflict}
            />
          )}

          {form.stale && <InlineAlert tone="warning">{t('form.conflict.keep')}</InlineAlert>}

          {children}

          {!form.readOnly && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                loading={form.submitting}
                {...(submitLocked !== undefined
                  ? { locked: true, lockedReason: submitLocked }
                  : {})}
              >
                {submitLabel}
              </Button>
              {onCancel !== undefined && (
                <Button variant="secondary" onClick={onCancel}>
                  {cancelLabel ?? t('common.cancel')}
                </Button>
              )}
            </div>
          )}
        </form>

        <ConfirmDialog
          open={blocker.state === 'blocked'}
          onOpenChange={(open) => {
            if (!open && blocker.state === 'blocked') blocker.reset();
          }}
          tone="danger"
          title={t('form.discard.title')}
          confirmLabel={t('form.discard.confirm')}
          cancelLabel={t('form.discard.stay')}
          onConfirm={() => {
            if (blocker.state === 'blocked') blocker.proceed();
          }}
        />
      </FormUiContext.Provider>
    </FormProvider>
  );
}
