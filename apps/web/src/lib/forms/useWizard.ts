import { useCallback, useMemo } from 'react';
import type { FieldValues } from 'react-hook-form';
import { useUrlState } from '../url-state';
import { schemaResolver, type FormSchema } from './resolver';
import type { AppForm } from './useAppForm';

// Biểu mẫu nhiều bước (FR-020): một `useAppForm` dùng chung, mỗi bước có lược đồ riêng; bước hiện tại nằm trong URL
// (`?step=`) để tải lại/quay lại trình duyệt đúng chỗ (không nhạy cảm).

export interface WizardStep<T extends FieldValues> {
  id: string;
  schema: FormSchema<Partial<T>>;
  /** Cho phép "Bỏ qua". */
  skippable?: boolean;
}

export interface Wizard {
  stepId: string;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  skippable: boolean;
  /** Kiểm theo lược đồ của bước hiện tại; chuyển bước nếu hợp lệ. Trả `true` khi đã chuyển. */
  next: () => Promise<boolean>;
  /** Bỏ qua bước (chỉ khi `skippable`). */
  skip: () => boolean;
  back: () => void;
  goTo: (id: string) => void;
}

export function useWizard<T extends FieldValues>(
  form: AppForm<T>,
  steps: readonly WizardStep<T>[],
): Wizard {
  const first = steps[0]?.id ?? '';
  const [stepParam, setStep] = useUrlState('step', first);
  const index = Math.max(
    0,
    steps.findIndex((s) => s.id === stepParam),
  );
  const current = steps[index];

  const goTo = useCallback(
    (id: string) => {
      setStep(id === first ? null : id);
    },
    [first, setStep],
  );

  return useMemo<Wizard>(() => {
    const move = (delta: number) => {
      const target = steps[index + delta];
      if (target !== undefined) goTo(target.id);
    };
    return {
      stepId: current?.id ?? first,
      index,
      isFirst: index === 0,
      isLast: index === steps.length - 1,
      skippable: current?.skippable === true,
      next: async () => {
        if (current === undefined) return false;
        const { getValues, setError } = form.methods;
        const check = await schemaResolver(current.schema as FormSchema<T>)(
          getValues(),
          undefined,
          { fields: {}, shouldUseNativeValidation: false },
        );
        const errors = check.errors as Record<string, { message?: string } | undefined>;
        const names = Object.keys(errors);
        if (names.length > 0) {
          for (const name of names) {
            const message = errors[name]?.message;
            if (message !== undefined) setError(name as never, { type: 'validation', message });
          }
          return false;
        }
        move(1);
        return true;
      },
      skip: () => {
        if (current?.skippable !== true) return false;
        move(1);
        return true;
      },
      back: () => {
        move(-1);
      },
      goTo,
    };
  }, [current, first, form.methods, goTo, index, steps]);
}
