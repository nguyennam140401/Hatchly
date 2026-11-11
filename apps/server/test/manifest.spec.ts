import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getManifest, modulesFor } from '../src/app/manifest';
import { MODULE_REGISTRY, buildModules } from '../src/app/module-registry';

// Bất biến của tệp kê khai module (data-model.md mục 1).
const MODULES_DIR = resolve(process.cwd(), 'src', 'modules');
const manifest = getManifest();
const byName = new Map(manifest.modules.map((m) => [m.name, m]));
const CORE_MODULES = [
  'account',
  'context',
  'media',
  'trends',
  'content',
  'approval',
  'publishing',
  'platform_gateway',
  'ai_gateway',
  'notifications',
  'queue',
];

describe('modules.manifest.json', () => {
  it('1. đủ 11 module của ADD mục 6; mỗi module có thư mục + index.ts; không có thư mục ngoài tệp kê khai', () => {
    // Thêm module mới (SC-007) không phải sửa kiểm thử này – chỉ cần 11 module gốc luôn có mặt.
    expect(manifest.modules.map((m) => m.name)).toEqual(expect.arrayContaining(CORE_MODULES));
    expect(new Set(manifest.modules.map((m) => m.name)).size).toBe(manifest.modules.length);
    for (const m of manifest.modules) {
      expect(existsSync(join(MODULES_DIR, m.name, 'index.ts')), m.name).toBe(true);
    }
    const dirs = readdirSync(MODULES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs).toEqual(manifest.modules.map((m) => m.name).sort());
  });

  it('2. mọi module có schema riêng, không trùng; approval/platform_gateway/queue đúng quy ước', () => {
    const schemas = manifest.modules.map((m) => m.schema);
    expect(schemas.every((s) => s.length > 0)).toBe(true);
    expect(new Set(schemas).size).toBe(schemas.length);
    expect(byName.get('approval')).toMatchObject({ schema: 'approval', reservedSchema: true });
    expect(byName.get('platform_gateway')?.schema).toBe('platform_gateway');
    expect(byName.get('queue')?.schema).toBe('infra');
  });

  it('3. allowedDeps trỏ tới module có thật, không tự trỏ, không vòng; queue không phụ thuộc gì', () => {
    for (const m of manifest.modules) {
      for (const dep of m.allowedDeps) {
        expect(byName.has(dep), `${m.name} → ${dep}`).toBe(true);
        expect(dep).not.toBe(m.name);
      }
    }
    expect(byName.get('queue')?.allowedDeps).toEqual([]);

    // Phát hiện vòng bằng DFS.
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (name: string, trail: string[]): void => {
      if (state.get(name) === 'done') return;
      if (state.get(name) === 'visiting') {
        throw new Error(`Vòng phụ thuộc: ${[...trail, name].join(' → ')}`);
      }
      state.set(name, 'visiting');
      for (const dep of byName.get(name)?.allowedDeps ?? []) visit(dep, [...trail, name]);
      state.set(name, 'done');
    };
    expect(() => {
      for (const m of manifest.modules) visit(m.name, []);
    }).not.toThrow();
  });

  it('4. chỉ publishing được phụ thuộc platform_gateway', () => {
    const dependents = manifest.modules
      .filter((m) => m.allowedDeps.includes('platform_gateway'))
      .map((m) => m.name);
    expect(dependents).toEqual(['publishing']);
  });

  it('5. registry khớp tệp kê khai và runsIn của API/Worker', () => {
    expect(Object.keys(MODULE_REGISTRY).sort()).toEqual(manifest.modules.map((m) => m.name).sort());
    for (const unit of ['api', 'worker'] as const) {
      const expected = modulesFor(unit).map((m) => MODULE_REGISTRY[m.name]);
      // Module có forUnit (account – 004) trả DynamicModule; so theo lớp module.
      const built = buildModules(unit).map((mod) => ('module' in mod ? mod.module : mod));
      expect(built).toEqual(expected);
    }
    expect(modulesFor('worker').map((m) => m.name)).not.toContain('approval');
    expect(modulesFor('api').map((m) => m.name)).toContain('approval');
  });
});
