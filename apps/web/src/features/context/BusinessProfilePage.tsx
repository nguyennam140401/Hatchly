import { toFieldErrors } from '@app/shared/core';
import { ProfileFields, type OptionalProfileField, type ProfileView } from '@app/shared/context';
import { useCallback, useEffect, useReducer, useRef, type ReactNode } from 'react';
import { contextApi } from '../../lib/api/endpoints/context';
import { AppError } from '../../lib/api/errors';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { useUnsavedChangesGuard } from '../../lib/forms/useUnsavedChangesGuard';
import { useSession } from '../../lib/session/context';
import { ConfirmDialog } from '../../ui/alert/ConfirmDialog';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { Button } from '../../ui/button/Button';
import { Page } from '../../ui/layout/Page';
import { PageHeader } from '../../ui/layout/PageHeader';
import { TextLink } from '../../ui/nav/TextLink';
import { formatVnTime, savedByLabel } from './labels';
import {
  EMPTY_FORM,
  FIELD_IDS,
  FIELD_ORDER,
  fieldsFromForm,
  formFromFields,
  ProfileForm,
  type ProfileFormValue,
} from './ProfileForm';
import { VersionHistory } from './VersionHistory';

// Màn hình "Hồ sơ kinh doanh" (006 contracts/business-profile-ui.md) – MẪU cho màn hình nghiệp vụ:
// mọi trạng thái của bảng hợp đồng (chữ + biểu tượng, không chỉ màu), quyền đọc từ /auth/me CHỈ để
// ẩn/hiện (API vẫn tự chặn), kiểm hợp lệ bằng lược đồ dùng chung, thông điệp lỗi + hành động từ máy
// chủ, không thư viện trạng thái (useReducer). Thời gian hiển thị UTC+7.

/** Khung trang: cột đọc ≤ 720 px, đúng một `<main>` (qua `Page`). */
function Wrap({ children, busy }: { children: ReactNode; busy?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-gutter py-6">
      <Page busy={busy === true}>{children}</Page>
    </div>
  );
}

const OPTIONAL_LABELS: Record<OptionalProfileField, string> = {
  products: 'Sản phẩm/dịch vụ',
  policies: 'Chính sách',
  tone: 'Giọng văn mong muốn',
  keywords: 'Từ khóa riêng',
};

type Notice = { kind: 'saved'; version: number } | { kind: 'unchanged' } | null;

interface State {
  phase: 'loading' | 'ready' | 'load_error' | 'forbidden';
  loadError: AppError | null;
  profile: ProfileView | null;
  missingOptional: OptionalProfileField[];
  form: ProfileFormValue;
  baseline: ProfileFormValue;
  saving: boolean;
  notice: Notice;
  errors: Record<string, string>;
  saveError: AppError | null;
  conflict: AppError | null;
  confirmReload: boolean;
  historyKey: number;
}

type Action =
  | { type: 'loading' }
  | { type: 'loaded'; profile: ProfileView | null; missingOptional: OptionalProfileField[] }
  | { type: 'load_failed'; error: AppError }
  | { type: 'forbidden' }
  | { type: 'edit'; form: ProfileFormValue }
  | { type: 'invalid'; errors: Record<string, string> }
  | { type: 'saving' }
  | { type: 'saved'; changed: boolean; profile: ProfileView }
  | { type: 'save_failed'; error: AppError }
  | { type: 'conflict'; error: AppError }
  | { type: 'confirm_reload'; open: boolean };

const initial: State = {
  phase: 'loading',
  loadError: null,
  profile: null,
  missingOptional: [],
  form: EMPTY_FORM,
  baseline: EMPTY_FORM,
  saving: false,
  notice: null,
  errors: {},
  saveError: null,
  conflict: null,
  confirmReload: false,
  historyKey: 0,
};

function missingOf(form: ProfileFormValue): OptionalProfileField[] {
  return (['products', 'policies', 'tone', 'keywords'] as const).filter((k) =>
    k === 'keywords' ? form.keywords.length === 0 : form[k].trim() === '',
  );
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loading':
      return { ...state, phase: 'loading', loadError: null };
    case 'loaded': {
      const form = action.profile === null ? EMPTY_FORM : formFromFields(action.profile.fields);
      return {
        ...state,
        phase: 'ready',
        profile: action.profile,
        missingOptional: action.missingOptional,
        form,
        baseline: form,
        errors: {},
        saveError: null,
        conflict: null,
        confirmReload: false,
        historyKey: state.historyKey + 1,
      };
    }
    case 'load_failed':
      return { ...state, phase: 'load_error', loadError: action.error };
    case 'forbidden':
      return { ...state, phase: 'forbidden' };
    case 'edit':
      return { ...state, form: action.form, notice: null };
    case 'invalid':
      return { ...state, errors: action.errors, notice: null, saving: false };
    case 'saving':
      return { ...state, saving: true, notice: null, saveError: null, errors: {} };
    case 'saved': {
      const form = formFromFields(action.profile.fields);
      return {
        ...state,
        saving: false,
        profile: action.profile,
        form,
        baseline: form,
        missingOptional: missingOf(form),
        conflict: null,
        notice: action.changed
          ? { kind: 'saved', version: action.profile.version }
          : { kind: 'unchanged' },
        historyKey: action.changed ? state.historyKey + 1 : state.historyKey,
      };
    }
    case 'save_failed':
      return { ...state, saving: false, saveError: action.error };
    case 'conflict':
      // Giữ NGUYÊN nội dung đang gõ (FR-005).
      return { ...state, saving: false, conflict: action.error };
    case 'confirm_reload':
      return { ...state, confirmReload: action.open };
  }
}

const sameForm = (a: ProfileFormValue, b: ProfileFormValue) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Lỗi theo ô từ máy chủ: bỏ tiền tố `fields.` (đường dẫn của SaveProfileRequest). */
function serverFieldErrors(error: AppError): Record<string, string> {
  return Object.fromEntries(
    Object.entries(error.fieldErrors).map(([k, v]) => [k.replace(/^fields\./, ''), v]),
  );
}

function focusFirstError(errors: Record<string, string>): void {
  const first = FIELD_ORDER.find((f) =>
    Object.keys(errors).some((k) => k === f || k.startsWith(`${f}.`)),
  );
  if (first !== undefined) document.getElementById(FIELD_IDS[first])?.focus();
}

export function BusinessProfilePage() {
  const { me } = useSession();
  const canView = me.permissions.includes('context.view');
  const canEdit = me.permissions.includes('context.edit');
  const [state, dispatch] = useReducer(reducer, initial);
  const savingRef = useRef(false);
  const dirty = canEdit && !sameForm(state.form, state.baseline);
  const blocker = useUnsavedChangesGuard(dirty);

  const load = useCallback(async () => {
    dispatch({ type: 'loading' });
    try {
      const res = await contextApi.getProfile();
      dispatch({ type: 'loaded', profile: res.profile, missingOptional: res.missingOptional });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      dispatch(
        err.code === 'FORBIDDEN' ? { type: 'forbidden' } : { type: 'load_failed', error: err },
      );
    }
  }, []);

  useEffect(() => {
    if (!canView) return;
    void load();
  }, [canView, load]);

  const save = async () => {
    // Chống bấm hai lần: một lần lưu tại một thời điểm.
    if (savingRef.current) return;
    const parsed = ProfileFields.safeParse(fieldsFromForm(state.form));
    if (!parsed.success) {
      const errors = Object.fromEntries(
        toFieldErrors(parsed.error).map((e) => [e.path.join('.'), e.message]),
      );
      dispatch({ type: 'invalid', errors });
      focusFirstError(errors);
      return;
    }
    savingRef.current = true;
    dispatch({ type: 'saving' });
    try {
      const res = await contextApi.saveProfile({
        expectedVersion: state.profile?.version ?? 0,
        fields: fieldsFromForm(state.form),
      });
      dispatch({ type: 'saved', changed: res.changed, profile: res.profile });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      if (err.code === 'VALIDATION_FAILED' && Object.keys(err.fieldErrors).length > 0) {
        const errors = serverFieldErrors(err);
        dispatch({ type: 'invalid', errors });
        focusFirstError(errors);
      } else if (err.code === 'VERSION_CONFLICT') {
        dispatch({ type: 'conflict', error: err });
      } else {
        dispatch({ type: 'save_failed', error: err });
      }
    } finally {
      savingRef.current = false;
    }
  };

  const reloadLatest = () => {
    if (dirty && !state.confirmReload) {
      dispatch({ type: 'confirm_reload', open: true });
      return;
    }
    void load();
  };

  if (!canView || state.phase === 'forbidden') {
    return (
      <Wrap>
        <PageHeader title="Hồ sơ kinh doanh" />
        <InlineAlert
          tone="error"
          actions={[{ kind: 'navigate', label: 'Về Tổng quan', href: '/' }]}
        >
          Bạn không có quyền xem hồ sơ kinh doanh.
        </InlineAlert>
      </Wrap>
    );
  }

  if (state.phase === 'loading' && state.profile === null) {
    return (
      <Wrap busy>
        <PageHeader title="Hồ sơ kinh doanh" />
        <p>
          <span aria-hidden="true">⏳ </span>Đang tải hồ sơ…
        </p>
      </Wrap>
    );
  }

  if (state.phase === 'load_error' && state.loadError !== null) {
    return (
      <Wrap>
        <PageHeader title="Hồ sơ kinh doanh" />
        <ErrorNotice
          error={state.loadError}
          actions={[{ kind: 'retry', label: 'Thử lại' }]}
          onRetry={() => {
            void load();
          }}
        />
      </Wrap>
    );
  }

  const errorCount = Object.keys(state.errors).length;
  const profile = state.profile;

  return (
    <Wrap busy={state.phase === 'loading'}>
      <TextLink to="/">← Tổng quan</TextLink>
      <PageHeader
        title="Hồ sơ kinh doanh"
        description={
          profile === null
            ? 'Chưa có hồ sơ. Điền vài dòng để AI viết bài đúng với cửa hàng của bạn.'
            : `Phiên bản ${String(profile.version)} · lưu lúc ${formatVnTime(profile.savedAt)} (giờ Việt Nam) · bởi ${savedByLabel(profile.savedBy)}`
        }
      />

      {!canEdit && (
        <InlineAlert tone="info">Bạn đang xem. Chỉ chủ tài khoản mới sửa được hồ sơ.</InlineAlert>
      )}

      {canEdit && state.missingOptional.length > 0 && (
        <aside
          aria-label="Gợi ý"
          className="rounded-md border border-brand bg-brand-soft p-4 text-body-sm"
        >
          <span aria-hidden="true">💡 </span>
          AI sẽ viết tốt hơn nếu bạn bổ sung:{' '}
          {state.missingOptional.map((k) => OPTIONAL_LABELS[k]).join(', ')}.
        </aside>
      )}

      {state.notice?.kind === 'saved' && (
        <InlineAlert tone="info">{`Đã lưu phiên bản ${String(state.notice.version)}`}</InlineAlert>
      )}
      {state.notice?.kind === 'unchanged' && (
        <InlineAlert tone="info">Không có thay đổi để lưu</InlineAlert>
      )}

      {state.conflict !== null && (
        <InlineAlert
          tone="error"
          actions={[
            { kind: 'retry', label: state.conflict.actions[0].label || 'Tải bản mới nhất' },
          ]}
          onAction={reloadLatest}
        >
          {state.conflict.message}
        </InlineAlert>
      )}

      <ConfirmDialog
        open={state.confirmReload}
        role="alertdialog"
        onOpenChange={(open) => {
          if (!open) dispatch({ type: 'confirm_reload', open: false });
        }}
        title="Thay nội dung đang sửa bằng bản mới nhất?"
        body="Thay đổi chưa lưu sẽ mất."
        confirmLabel="Thay bằng bản mới nhất"
        cancelLabel="Giữ nội dung đang sửa"
        onConfirm={() => void load()}
      />

      {state.saveError !== null && (
        <ErrorNotice
          error={state.saveError}
          actions={[{ kind: 'retry', label: 'Thử lại' }]}
          onRetry={() => void save()}
        />
      )}

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        role="alertdialog"
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset();
        }}
        tone="danger"
        title="Bỏ các thay đổi chưa lưu?"
        confirmLabel="Bỏ thay đổi"
        cancelLabel="Ở lại"
        onConfirm={() => {
          if (blocker.state === 'blocked') blocker.proceed();
        }}
      />

      <form
        noValidate
        aria-label="Hồ sơ kinh doanh"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {errorCount > 0 && (
          <InlineAlert tone="error" actions={[{ kind: 'fix_input', label: 'Sửa thông tin' }]}>
            Hãy sửa {errorCount} ô được đánh dấu bên dưới.
          </InlineAlert>
        )}
        <ProfileForm
          value={state.form}
          errors={state.errors}
          readOnly={!canEdit}
          onChange={(form) => {
            dispatch({ type: 'edit', form });
          }}
        />
        {canEdit && (
          <div>
            <Button type="submit" loading={state.saving}>
              Lưu
            </Button>
          </div>
        )}
      </form>

      <VersionHistory reloadKey={state.historyKey} />
    </Wrap>
  );
}
