import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MicroUsd } from '../src/core/index.js';

// Nguyên tắc III / R16: hợp đồng cho khách hàng (src/modules/*/index.ts) không được chứa MicroUsd.
// Hợp đồng nội bộ/hỗ trợ đặt ở src/modules/<m>/internal-support.ts và được miễn (không nhập ở đây).

const here = dirname(fileURLToPath(import.meta.url));
const MODULES_DIR = join(here, '..', 'src', 'modules');
// Đọc trực tiếp tệp kê khai (chỉ trong kiểm thử – mã nguồn shared không phụ thuộc apps/**).
const MANIFEST = join(
  here,
  '..',
  '..',
  '..',
  'apps',
  'server',
  'src',
  'modules',
  'modules.manifest.json',
);

/** Duyệt cây lược đồ Zod, trả true nếu gặp đúng lược đồ MicroUsd. */
function containsMicroUsd(schema: unknown, seen = new Set<unknown>()): boolean {
  if (schema === MicroUsd) return true;
  if (schema === null || typeof schema !== 'object' || seen.has(schema)) return false;
  seen.add(schema);
  if (schema instanceof z.ZodType) {
    return containsMicroUsd((schema as unknown as { _zod: { def: unknown } })._zod.def, seen);
  }
  const values = Array.isArray(schema) ? schema : Object.values(schema);
  return values.some((value) => containsMicroUsd(value, seen));
}

async function loadModuleContracts(): Promise<{ module: string; name: string; schema: unknown }[]> {
  const found: { module: string; name: string; schema: unknown }[] = [];
  for (const entry of readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const url = pathToFileURL(join(MODULES_DIR, entry.name, 'index.ts')).href;
    const exports = (await import(url)) as Record<string, unknown>;
    for (const [name, schema] of Object.entries(exports)) {
      if (schema instanceof z.ZodType) found.push({ module: entry.name, name, schema });
    }
  }
  return found;
}

describe('Hợp đồng cho khách hàng không lộ chi phí AI', () => {
  it('bộ dò phát hiện được MicroUsd lồng sâu (tự kiểm)', () => {
    const leaky = z.object({ usage: z.array(z.object({ cost: MicroUsd.optional() })) });
    expect(containsMicroUsd(leaky)).toBe(true);
    expect(containsMicroUsd(z.object({ percent: z.int() }))).toBe(false);
  });

  it('mỗi module trong tệp kê khai có thư mục hợp đồng và ngược lại', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { modules: { name: string }[] };
    const dirs = readdirSync(MODULES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs).toEqual(manifest.modules.map((m) => m.name).sort());
    expect(dirs.length).toBeGreaterThanOrEqual(11);
  });

  it('không lược đồ nào trong src/modules/*/index.ts chứa MicroUsd', async () => {
    const offenders = (await loadModuleContracts())
      .filter((c) => containsMicroUsd(c.schema))
      .map((c) => `${c.module}.${c.name}`);
    expect(offenders).toEqual([]);
  });
});
