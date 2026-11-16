import { useCallback, useContext, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from 'react-hook-form';
import type { Blocker } from 'react-router';
import { AppError } from '../api/errors';
import { SessionContext } from '../session/context';
import { draftStore } from './draft-store';
import { schemaResolver, type FormSchema } from './resolver';
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';

// Nền tảng biểu mẫu dùng chung (FR-013…FR-019): bọc react-hook-form; lược đồ kiểm là lược đồ Zod của @app/shared (cùng
// máy chủ). Có sẵn: chống gửi trùng, chặn mất dữ liệu, xung đột phiên bản, chỉ xem, lỗi máy chủ theo ô, bản nháp RAM.

const DRAFT_DEBOUNCE_MS = 300;

export interface UseAppFormOptions<T extends FieldValues> {
  schema: FormSchema<T>;
  defaultValues: DefaultValues<T>;
  /** Phiên bản bản ghi khi sửa (khóa lạc quan, FR-018). */
  version?: number | undefined;
  readOnly?: boolean | undefined;
  /** Có khóa → giữ bản nháp trong RAM (khôi phục khi mở lại, kể cả sau khi hết phiên). */
  draftKey?: string | undefined;
  /** Tên trường nhạy cảm KHÔNG bao giờ vào bản nháp (thêm vào quy tắc mặc định theo tên). */
  sensitiveFields?: readonly string[] | undefined;
  /** Thứ tự ô để đưa tiêu điểm tới ô lỗi đầu tiên khi máy chủ báo lỗi theo ô. */
  fieldOrder?: readonly string[] | undefined;
  /** Gửi biểu mẫu; ném `AppError` khi lỗi. KHÔNG báo thành công khi chưa có 2xx. */
  onSubmit: (values: T, ctx: { version: number | undefined }) => Promise<unknown>;
  /** Biểu mẫu "tạo mới" (mời thành viên…): sau khi gửi thành công trả các ô về giá trị ban đầu thay vì giữ giá trị vừa gửi. */
  clearOnSuccess?: boolean | undefined;
  /** Tải bản mới nhất của bản ghi (cho xử lý xung đột phiên bản). */
  loadLatest?: (() => Promise<{ values: T; version: number }>) | undefined;
}

export interface AppForm<T extends FieldValues> {
  methods: UseFormReturn<T>;
  readOnly: boolean;
  version: number | undefined;
  submitting: boolean;
  /** Lỗi chung (không theo ô, không xung đột) – hiện ở đầu biểu mẫu kèm "Thử lại". */
  submitError: AppError | null;
  /** Có xung đột phiên bản: giữ "bản của tôi" để đối chiếu. */
  /** `loaded`: đã nạp bản mới nhất vào form, chỉ còn khung "Bản của bạn" để đối chiếu. */
  conflict: { mine: T; loaded: boolean } | null;
  /** Người dùng chọn giữ bản của mình (có thể cũ hơn bản trên máy chủ). */
  stale: boolean;
  blocker: Blocker;
  submit: (event?: SyntheticEvent) => Promise<void>;
  retry: () => Promise<void>;
  loadLatest: () => Promise<void>;
  keepMine: () => Promise<void>;
  dismissConflict: () => void;
  handleServerError: (error: AppError) => void;
  dismissError: () => void;
}

export function useAppForm<T extends FieldValues>(options: UseAppFormOptions<T>): AppForm<T> {
  // Trang công khai (đăng nhập, đăng ký…) chưa có phiên: dùng chủ thể 'anonymous' và các biểu mẫu đó không đặt `draftKey`.
  const subject = useContext(SessionContext)?.me.user.id ?? 'anonymous';
  const {
    schema,
    defaultValues,
    draftKey,
    sensitiveFields,
    fieldOrder,
    readOnly = false,
    clearOnSuccess = false,
    onSubmit,
    loadLatest: loadLatestOption,
  } = options;

  const methods = useForm<T>({
    resolver: schemaResolver(schema),
    defaultValues,
    mode: 'onTouched',
  });
  const { reset, setError, setFocus, getValues, watch } = methods;

  const [version, setVersion] = useState(options.version);
  const [submitError, setSubmitError] = useState<AppError | null>(null);
  const [conflict, setConflict] = useState<{ mine: T; loaded: boolean } | null>(null);
  const [stale, setStale] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Phiên bản mới từ máy chủ (sau refetch) thay phiên bản đang giữ – trừ khi người dùng đang giữ bản cũ.
  useEffect(() => {
    if (!stale) setVersion(options.version);
  }, [options.version, stale]);

  // Khôi phục bản nháp (nếu có và cùng người dùng) một lần khi mở.
  const restored = useRef(false);
  useEffect(() => {
    if (draftKey === undefined || restored.current) return;
    restored.current = true;
    const draft = draftStore.load(subject, draftKey);
    if (draft !== undefined) {
      reset({ ...(defaultValues as object), ...draft.value } as DefaultValues<T>, {
        keepDefaultValues: true,
      });
    }
    // Chỉ chạy khi mở biểu mẫu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ghi bản nháp mỗi lần đổi (debounce 300 ms), chỉ khi có `draftKey`.
  useEffect(() => {
    if (draftKey === undefined || readOnly) return;
    // eslint-disable-next-line react-hooks/incompatible-library -- `watch` của react-hook-form: chỉ dùng để đăng ký lắng nghe
    const subscription = watch((value) => {
      clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => {
        draftStore.save(subject, draftKey, value, sensitiveFields);
      }, DRAFT_DEBOUNCE_MS);
    });
    return () => {
      subscription.unsubscribe();
      clearTimeout(draftTimer.current);
    };
  }, [watch, draftKey, subject, readOnly, sensitiveFields]);

  // Đang gửi thì không chặn: thành công thường chuyển trang ngay trong `onSubmit` (đăng nhập, tạo mới…).
  const sendingRef = useRef(false);
  const guard = useUnsavedChangesGuard(methods.formState.isDirty && !readOnly, sendingRef);

  const handleServerError = useCallback(
    (error: AppError) => {
      // Phiên hết hạn đã có `AuthGate` xử lý; bản nháp còn nguyên và nút Gửi sẽ gửi lại sau khi đăng nhập.
      if (error.kind === 'session_expired') return;
      if (error.kind === 'version_conflict') {
        setConflict({ mine: getValues(), loaded: false });
        return;
      }
      const entries = Object.entries(error.fieldErrors);
      if (entries.length > 0) {
        for (const [path, message] of entries) {
          setError(path as Path<T>, { type: 'server', message });
        }
        const order = fieldOrder ?? entries.map(([path]) => path);
        const first = order.find((path) => path in error.fieldErrors) ?? entries[0]?.[0];
        if (first !== undefined) setFocus(first as Path<T>);
        return;
      }
      setSubmitError(error);
    },
    [fieldOrder, getValues, setError, setFocus],
  );

  const run = useCallback(
    () =>
      methods.handleSubmit(async (values) => {
        setSubmitError(null);
        sendingRef.current = true;
        setSubmitting(true);
        try {
          await onSubmit(values, { version });
          if (draftKey !== undefined) draftStore.clear(subject, draftKey);
          setStale(false);
          reset(clearOnSuccess ? (defaultValues as T) : values);
        } catch (error) {
          if (error instanceof AppError) handleServerError(error);
          else throw error;
        } finally {
          sendingRef.current = false;
          setSubmitting(false);
        }
      })(),
    [
      methods,
      onSubmit,
      version,
      draftKey,
      subject,
      reset,
      handleServerError,
      clearOnSuccess,
      defaultValues,
    ],
  );

  // Chống gửi trùng: lần gửi thứ hai khi lần đầu chưa xong dùng lại cùng một lời hứa (đúng MỘT lời gọi).
  const submit = useCallback(
    (event?: SyntheticEvent) => {
      event?.preventDefault();
      if (readOnly) return Promise.resolve();
      if (inFlight.current !== null) return inFlight.current;
      const promise = run().finally(() => {
        inFlight.current = null;
      });
      inFlight.current = promise;
      return promise;
    },
    [readOnly, run],
  );

  const loadLatest = useCallback(async () => {
    if (loadLatestOption === undefined) return;
    const latest = await loadLatestOption();
    // Giữ "bản của tôi" trong `conflict.mine` để đối chiếu; form nhận bản mới nhất.
    reset(latest.values);
    setVersion(latest.version);
    setStale(false);
    setConflict((current) => (current === null ? null : { ...current, loaded: true }));
  }, [loadLatestOption, reset]);

  const keepMine = useCallback(async () => {
    // Giữ giá trị của người dùng; chỉ lấy phiên bản mới để lần gửi kế tiếp (do người dùng chủ động) không bị từ chối.
    if (loadLatestOption !== undefined) {
      const latest = await loadLatestOption();
      setVersion(latest.version);
    }
    setStale(true);
    setConflict(null);
  }, [loadLatestOption]);

  return {
    methods,
    readOnly,
    version,
    submitting,
    submitError,
    conflict,
    stale,
    blocker: guard,
    submit,
    retry: () => submit(),
    loadLatest,
    keepMine,
    dismissConflict: () => {
      setConflict(null);
    },
    handleServerError,
    dismissError: () => {
      setSubmitError(null);
    },
  };
}
