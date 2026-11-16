import type { FormSchema, SchemaIssue } from './resolver';

// Quy tắc kiểm tra tối giản cho biểu mẫu chỉ cần kiểm "bắt buộc / độ dài" ở trình duyệt (máy chủ vẫn kiểm lại đầy đủ).
// Biểu mẫu có lược đồ Zod trong `@app/shared` thì dùng thẳng lược đồ đó (cùng máy chủ).
export type Rule<V> = (value: V) => string | undefined;

export function objectSchema<T extends Record<string, unknown>>(rules: {
  [K in keyof T]?: Rule<T[K]>;
}): FormSchema<T> {
  return {
    safeParse(value) {
      const input = value as T;
      const issues: SchemaIssue[] = [];
      for (const [key, rule] of Object.entries(rules) as [string, Rule<unknown> | undefined][]) {
        const message = rule?.(input[key]);
        if (message !== undefined) issues.push({ path: [key], message });
      }
      return issues.length === 0
        ? { success: true as const, data: input }
        : { success: false as const, error: { issues } };
    },
  };
}

export const minLength =
  (n: number, message: string): Rule<unknown> =>
  (value) =>
    typeof value === 'string' && value.trim().length >= n ? undefined : message;

export const required = (message: string): Rule<unknown> => minLength(1, message);

/** Mật khẩu: không cắt khoảng trắng hai đầu, chỉ đếm ký tự. */
export const minChars =
  (n: number, message: string): Rule<unknown> =>
  (value) =>
    typeof value === 'string' && Array.from(value).length >= n ? undefined : message;

export const isChecked =
  (message: string): Rule<unknown> =>
  (value) =>
    value === true ? undefined : message;

export const nonEmptyList =
  (message: string): Rule<unknown> =>
  (value) =>
    Array.isArray(value) && value.length > 0 ? undefined : message;
