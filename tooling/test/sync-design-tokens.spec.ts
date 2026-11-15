import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyBlock, BEGIN, buildThemeBlock, END, syncDesignTokens } from '../sync-design-tokens.mjs';

// SC-012: giá trị thiết kế chỉ ở figma-tokens.json; đồng bộ lại không đổi gì nếu JSON không đổi.
const here = dirname(fileURLToPath(import.meta.url));
const realJson = join(here, '..', '..', 'apps', 'web', 'src', 'styles', 'figma-tokens.json');

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'tokens-'));
  const dir = join(root, 'apps', 'web', 'src', 'styles');
  mkdirSync(dir, { recursive: true });
  cpSync(realJson, join(dir, 'figma-tokens.json'));
  return { root, dir };
}

describe('sync-design-tokens', () => {
  it('tạo tokens.css lần đầu rồi chạy lại không đổi', () => {
    const { root, dir } = workspace();
    expect(syncDesignTokens(root).changed).toBe(true);
    const first = readFileSync(join(dir, 'tokens.css'), 'utf8');
    expect(syncDesignTokens(root).changed).toBe(false);
    expect(readFileSync(join(dir, 'tokens.css'), 'utf8')).toBe(first);
  });

  it('đổi một màu → chỉ khối giữa BEGIN/END đổi, phần viết tay giữ nguyên', () => {
    const { root, dir } = workspace();
    syncDesignTokens(root);
    const cssPath = join(dir, 'tokens.css');
    writeFileSync(cssPath, `${readFileSync(cssPath, 'utf8')}\n/* viết tay */\n`);
    const json = JSON.parse(readFileSync(join(dir, 'figma-tokens.json'), 'utf8')) as {
      colors: Record<string, string>;
    };
    json.colors['brand'] = '#123456';
    writeFileSync(join(dir, 'figma-tokens.json'), JSON.stringify(json));
    syncDesignTokens(root);
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toContain('--color-brand: #123456;');
    expect(css).toContain('/* viết tay */');
  });

  it('khoảng cách không có 5 và 7; có đủ cỡ chữ và mốc bố cục', () => {
    const json = JSON.parse(readFileSync(realJson, 'utf8')) as Parameters<typeof buildThemeBlock>[0];
    const block = buildThemeBlock(json);
    expect(block).not.toMatch(/--spacing-[57]:/);
    for (const n of ['1', '2', '3', '4', '6', '8']) expect(block).toContain(`--spacing-${n}:`);
    for (const s of ['display', 'title', 'heading', 'body', 'body-sm', 'label', 'caption']) {
      expect(block).toContain(`--text-${s}:`);
    }
    for (const s of ['touch: 44px', 'topbar: 56px', 'navbar: 64px', 'sidebar: 248px']) {
      expect(block).toContain(s);
    }
    expect(block.match(/--color-(?!\*)[\w-]+:/g)).toHaveLength(22);
  });

  it('báo lỗi khi tokens.css thiếu dấu mốc', () => {
    expect(() => applyBlock('body{}', `${BEGIN}\n${END}`)).toThrow(/BEGIN\/END/);
  });
});
