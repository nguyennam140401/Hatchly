import { toFieldErrors } from '@app/shared/core';
import type { z } from 'zod';
import { AppConfigSchema, secretRegistry, type AppConfig } from './config.schema';

/** Một biến cấu hình thiếu/sai – chỉ có tên biến và lý do, KHÔNG có giá trị. */
export interface ConfigIssue {
  variable: string;
  reason: string;
}

/** Lỗi cấu hình khi khởi động. Thông điệp chỉ chứa tên biến + lý do (nguyên tắc VII). */
export class ConfigError extends Error {
  constructor(readonly issues: ConfigIssue[]) {
    super(
      `Cấu hình môi trường chưa hợp lệ:\n${issues.map((i) => `  - ${i.variable}: ${i.reason}`).join('\n')}`,
    );
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

function isSecret(schema: z.ZodObject, variable: string): boolean {
  const field = (schema.shape as Record<string, z.ZodType | undefined>)[variable];
  return field !== undefined && secretRegistry.has(field);
}

/** Kiểm tra `env` theo một lược đồ bất kỳ (dùng lại cho biến của WBS 1.2/1.5). */
export function loadConfigFrom<S extends z.ZodObject>(schema: S, env: Env): z.infer<S> {
  // Chuỗi rỗng coi như chưa đặt để giá trị mặc định có hiệu lực.
  const cleaned: Env = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }

  const result = schema.safeParse(cleaned);
  if (result.success) return result.data;

  const fieldErrors = toFieldErrors(result.error);
  const issues = result.error.issues.map((issue, index): ConfigIssue => {
    const variable = String(issue.path[0] ?? '(gốc)');
    const missing = cleaned[variable] === undefined;
    let reason: string;
    if (missing) reason = 'bắt buộc';
    else if (isSecret(schema, variable)) reason = 'giá trị chưa hợp lệ';
    else if (issue.code === 'invalid_value')
      reason = `phải là một trong: ${issue.values.map(String).join(', ')}`;
    else reason = fieldErrors[index]?.message ?? 'giá trị chưa hợp lệ';
    return { variable, reason };
  });
  throw new ConfigError(issues);
}

/** Đọc cấu hình của ứng dụng từ biến môi trường. */
export function loadConfig(env: Env = process.env): AppConfig {
  return loadConfigFrom(AppConfigSchema, env);
}
