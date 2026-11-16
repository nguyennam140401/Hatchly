import type { FormSchema, SchemaIssue } from '../../../lib/forms/resolver';

// Lược đồ tối giản dùng cho biểu mẫu MẪU của danh mục (biểu mẫu thật dùng lược đồ Zod của @app/shared).
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

export const nonEmptyList =
  (message: string): Rule<unknown> =>
  (value) =>
    Array.isArray(value) && value.length > 0 ? undefined : message;
