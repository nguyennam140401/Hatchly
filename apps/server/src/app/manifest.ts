import { z } from 'zod';
import manifestJson from '../modules/modules.manifest.json';

// Đọc và kiểm tra tệp kê khai module khi khởi động (contracts/module-manifest.md).

const snakeCase = z.string().regex(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
const Unit = z.enum(['api', 'worker']);

export const ModuleDescriptor = z.object({
  name: snakeCase,
  title: z.string().min(1),
  kind: z.enum(['business', 'gateway', 'infra']),
  schema: snakeCase,
  reservedSchema: z.boolean().optional(),
  runsIn: z.array(Unit).min(1),
  allowedDeps: z.array(snakeCase),
});
export type ModuleDescriptor = z.infer<typeof ModuleDescriptor>;

export const ModulesManifest = z.object({
  $schema: z.string().optional(),
  sharedAllowedPackages: z.array(z.string()),
  aiProviderPackagePatterns: z.array(z.string()),
  modules: z.array(ModuleDescriptor).min(1),
});
export type ModulesManifest = z.infer<typeof ModulesManifest>;

let cached: ModulesManifest | undefined;

/** Tệp kê khai đã kiểm tra. Ném lỗi khi khởi động nếu tệp sai định dạng. */
export function getManifest(): ModulesManifest {
  cached ??= ModulesManifest.parse(manifestJson);
  return cached;
}

/** Các module chạy ở một đơn vị triển khai. */
export function modulesFor(unit: z.infer<typeof Unit>): ModuleDescriptor[] {
  return getManifest().modules.filter((m) => m.runsIn.includes(unit));
}
