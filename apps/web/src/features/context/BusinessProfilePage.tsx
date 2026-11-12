import { toFieldErrors } from '@app/shared/core';
import { ProfileFields, type OptionalProfileField, type ProfileView } from '@app/shared/context';
import { useCallback, useEffect, useReducer, useRef, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { useSession } from '../auth/session';
import { ErrorNotice, styles } from '../auth/ui';
import { contextApi, formatVnTime, savedByLabel } from './context-api';
import {
  EMPTY_FORM,
  FIELD_IDS,
  FIELD_ORDER,
  fieldsFromForm,
  formFromFields,
  ProfileForm,
  type ProfileFormValue,
} from './ProfileForm';
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';
import { VersionHistory } from './VersionHistory';

// Màn hình "Hồ sơ kinh doanh" (006 contracts/business-profile-ui.md) – MẪU cho màn hình nghiệp vụ:
// mọi trạng thái của bảng hợp đồng (chữ + biểu tượng, không chỉ màu), quyền đọc từ /auth/me CHỈ để
// ẩn/hiện (API vẫn tự chặn), kiểm hợp lệ bằng lược đồ dùng chung, thông điệp lỗi + hành động từ máy
// chủ, không thư viện trạng thái (useReducer). Thời gian hiển thị UTC+7.

const page: CSSProperties = { ...styles.page, maxWidth: 720 };

const OPTIONAL_LABELS: Record<OptionalProfileField, string> = {
  products: 'Sản phẩm/dịch vụ',
  policies: 'Chính sách',
  tone: 'Giọng văn mong muốn',
  keywords: 'Từ khóa riêng',
};

type Notice = { kind: 'saved'; version: number } | { kind: 'unchanged' } | null;

interface State {
  phase: 'loading' | 'ready' | 'load_error' | 'forbidden';
  loadError: ApiError | null;
  profile: ProfileView | null;
  missingOptional: OptionalProfileField[];
  form: ProfileFormValue;
  baseline: ProfileFormValue;
  saving: boolean;
  notice: Notice;
  errors: Record<string, string>;
  saveError: ApiError | null;
  conflict: ApiError | null;
  confirmReload: boolean;
  historyKey: number;
}

type Action =
  | { type: 'loading' }
  | { type: 'loaded'; profile: ProfileView | null; missingOptional: OptionalProfileField[] }
  | { type: 'load_failed'; error: ApiError }
  | { type: 'forbidden' }
  | { type: 'edit'; form: ProfileFormValue }
  | { type: 'invalid'; errors: Record<string, string> }
  | { type: 'saving' }
  | { type: 'saved'; changed: boolean; profile: ProfileView }
  | { type: 'save_failed'; error: ApiError }
  | { type: 'conflict'; error: ApiError }
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
function serverFieldErrors(error: ApiError): Record<string, string> {
  return Object.fromEntries(
    Object.entries(error.fieldErrors()).map(([k, v]) => [k.replace(/^fields\./, ''), v]),
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
      if (!(err instanceof ApiError)) throw err;
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
      if (!(err instanceof ApiError)) throw err;
      if (err.code === 'VALIDATION_FAILED' && err.body?.fieldErrors !== undefined) {
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
      <main style={page}>
        <h1 style={{ fontSize: 24 }}>Hồ sơ kinh doanh</h1>
        <div role="alert" style={{ border: '1px solid #b91c1c', borderRadius: 8, padding: 12 }}>
          <p style={{ marginTop: 0 }}>
            <span role="img" aria-label="Không có quyền">
              ⛔
            </span>{' '}
            Bạn không có quyền xem hồ sơ kinh doanh.
          </p>
          <Link to="/" style={styles.link}>
            Về Tổng quan
          </Link>
        </div>
      </main>
    );
  }

  if (state.phase === 'loading' && state.profile === null) {
    return (
      <main style={page} aria-busy="true">
        <h1 style={{ fontSize: 24 }}>Hồ sơ kinh doanh</h1>
        <p>
          <span aria-hidden="true">⏳ </span>Đang tải hồ sơ…
        </p>
      </main>
    );
  }

  if (state.phase === 'load_error' && state.loadError !== null) {
    return (
      <main style={page}>
        <h1 style={{ fontSize: 24 }}>Hồ sơ kinh doanh</h1>
        <ErrorNotice error={state.loadError}>
          <button type="button" style={styles.secondary} onClick={() => void load()}>
            Thử lại
          </button>
        </ErrorNotice>
      </main>
    );
  }

  const errorCount = Object.keys(state.errors).length;
  const profile = state.profile;

  return (
    <main style={page} aria-busy={state.phase === 'loading'}>
      <p style={{ margin: '0 0 8px' }}>
        <Link to="/" style={styles.link}>
          ← Tổng quan
        </Link>
      </p>
      <h1 style={{ fontSize: 24, margin: '0 0 8px' }}>Hồ sơ kinh doanh</h1>
      {profile === null ? (
        <p style={{ marginTop: 0, color: '#4b5563' }}>
          Chưa có hồ sơ. Điền vài dòng để AI viết bài đúng với cửa hàng của bạn.
        </p>
      ) : (
        <p style={{ marginTop: 0, color: '#4b5563' }}>
          Phiên bản {profile.version} · lưu lúc {formatVnTime(profile.savedAt)} (giờ Việt Nam) · bởi{' '}
          {savedByLabel(profile.savedBy)}
        </p>
      )}

      {!canEdit && (
        <p role="note" style={{ border: '1px solid #6b7280', borderRadius: 8, padding: 12 }}>
          <span role="img" aria-label="Chỉ xem">
            👁
          </span>{' '}
          Bạn đang xem. Chỉ chủ tài khoản mới sửa được hồ sơ.
        </p>
      )}

      {canEdit && state.missingOptional.length > 0 && (
        <aside
          aria-label="Gợi ý"
          style={{ border: '1px solid #1d4ed8', borderRadius: 8, padding: 12, marginBottom: 16 }}
        >
          <span role="img" aria-label="Gợi ý">
            💡
          </span>{' '}
          AI sẽ viết tốt hơn nếu bạn bổ sung:{' '}
          {state.missingOptional.map((k) => OPTIONAL_LABELS[k]).join(', ')}.
        </aside>
      )}

      {state.notice?.kind === 'saved' && (
        <p role="status" style={{ border: '1px solid #15803d', borderRadius: 8, padding: 12 }}>
          <span role="img" aria-label="Thành công">
            ✓
          </span>{' '}
          Đã lưu phiên bản {state.notice.version}
        </p>
      )}
      {state.notice?.kind === 'unchanged' && (
        <p role="status" style={{ border: '1px solid #6b7280', borderRadius: 8, padding: 12 }}>
          <span role="img" aria-label="Thông tin">
            ℹ
          </span>{' '}
          Không có thay đổi để lưu
        </p>
      )}

      {state.conflict !== null && (
        <div
          role="alert"
          style={{ border: '1px solid #b45309', borderRadius: 8, padding: 12, marginBottom: 16 }}
        >
          <p style={{ marginTop: 0 }}>
            <span role="img" aria-label="Cảnh báo">
              ⚠
            </span>{' '}
            {state.conflict.message}
          </p>
          <button type="button" style={styles.secondary} onClick={reloadLatest}>
            {state.conflict.body?.actions[0]?.label ?? 'Tải bản mới nhất'}
          </button>
        </div>
      )}

      {state.confirmReload && (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="bp-confirm-reload"
          style={{ border: '1px solid #b45309', borderRadius: 8, padding: 12, marginBottom: 16 }}
        >
          <p id="bp-confirm-reload" style={{ marginTop: 0 }}>
            Thay nội dung đang sửa bằng bản mới nhất? Thay đổi chưa lưu sẽ mất.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" style={styles.secondary} onClick={() => void load()}>
              Thay bằng bản mới nhất
            </button>
            <button
              type="button"
              style={styles.secondary}
              onClick={() => {
                dispatch({ type: 'confirm_reload', open: false });
              }}
            >
              Giữ nội dung đang sửa
            </button>
          </div>
        </div>
      )}

      {state.saveError !== null && (
        <ErrorNotice error={state.saveError}>
          <button type="button" style={styles.secondary} onClick={() => void save()}>
            Thử lại
          </button>
        </ErrorNotice>
      )}

      {blocker.state === 'blocked' && (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="bp-confirm-leave"
          style={{ border: '1px solid #b45309', borderRadius: 8, padding: 12, marginBottom: 16 }}
        >
          <p id="bp-confirm-leave" style={{ marginTop: 0 }}>
            Bỏ các thay đổi chưa lưu?
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              style={styles.secondary}
              onClick={() => {
                blocker.reset();
              }}
            >
              Ở lại
            </button>
            <button
              type="button"
              style={styles.secondary}
              onClick={() => {
                blocker.proceed();
              }}
            >
              Bỏ thay đổi
            </button>
          </div>
        </div>
      )}

      <form
        noValidate
        aria-label="Hồ sơ kinh doanh"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {errorCount > 0 && (
          <div
            role="alert"
            style={{ border: '1px solid #b91c1c', borderRadius: 8, padding: 12, marginBottom: 16 }}
          >
            <span role="img" aria-label="Lỗi">
              ⚠
            </span>{' '}
            Hãy sửa {errorCount} ô được đánh dấu bên dưới.
          </div>
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
          <button type="submit" style={styles.primary} disabled={state.saving}>
            {state.saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        )}
      </form>

      <VersionHistory reloadKey={state.historyKey} />
    </main>
  );
}
