import { set, type FieldErrors, type FieldValues, type Resolver } from 'react-hook-form';

// Cầu nối giữa lược đồ Zod của `@app/shared` (CÙNG lược đồ máy chủ – FR-014) và react-hook-form. Dùng giao diện cấu trúc
// `safeParse` để web không phải phụ thuộc trực tiếp vào `zod`.

export interface SchemaIssue {
  path: readonly PropertyKey[];
  message: string;
}

export interface FormSchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: readonly SchemaIssue[] } };
}

export function schemaResolver<T extends FieldValues>(schema: FormSchema<T>): Resolver<T> {
  return (values) => {
    const result = schema.safeParse(values);
    if (result.success) return { values: result.data, errors: {} };
    const errors: Record<string, unknown> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.map(String).join('.');
      // Mỗi ô chỉ giữ lỗi ĐẦU TIÊN.
      if (path === '' || errors[path] !== undefined) continue;
      set(errors, path, { type: 'validation', message: issue.message });
    }
    return { values: {}, errors: errors as FieldErrors<T> };
  };
}
