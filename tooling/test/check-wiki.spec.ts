import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkWiki, parseFrontmatter } from '../check-wiki.mjs';

// wiki:check bắt trang thiếu frontmatter, nguồn không tồn tại, link gãy, trang chưa vào index, log sai tiền tố.

const run = checkWiki as (o: { root: string }) => {
  errors: { file: string; message: string }[];
  pages: number;
};

function write(root: string, file: string, content: string) {
  const full = join(root, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}
const page = (extra = '', sources = '[README.md]') =>
  `---\ntype: concept\ntitle: T\nsources: ${sources}\nupdated: 2026-11-14\nstatus: current\n${extra}---\n\nNội dung\n`;

function workspace(mutate?: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'wiki-'));
  write(root, 'README.md', '# r');
  write(root, 'docs/wiki/index.md', '# Index\n- [A](concepts/a.md)\n');
  write(root, 'docs/wiki/log.md', '# Log\n\n## [2026-11-14] ingest | Khởi tạo\n');
  write(root, 'docs/wiki/concepts/a.md', page());
  mutate?.(root);
  return root;
}

describe('wiki:check', () => {
  it('chấp nhận wiki hợp lệ', () => {
    expect(run({ root: workspace() }).errors).toEqual([]);
  });
  it('đọc frontmatter nhiều dòng', () => {
    const fm = parseFrontmatter('---\nsources:\n  [a.md,\n    b.md,\n  ]\n---\n');
    expect(fm?.sources).toEqual(['a.md', 'b.md']);
  });
  it('đọc frontmatter dạng mảng', () => {
    expect(parseFrontmatter(page())?.sources).toEqual(['README.md']);
  });
  it('báo thiếu frontmatter', () => {
    const root = workspace((r) => {
      write(r, 'docs/wiki/concepts/a.md', 'không có\n');
    });
    expect(run({ root }).errors.map((e) => e.message)).toContain('thiếu frontmatter');
  });
  it('báo nguồn không tồn tại', () => {
    const root = workspace((r) => {
      write(r, 'docs/wiki/concepts/a.md', page('', '[khong/co.md]'));
    });
    expect(
      run({ root }).errors.some((e) => e.message.includes('sources trỏ tới tệp không tồn tại')),
    ).toBe(true);
  });
  it('báo link gãy', () => {
    const root = workspace((r) => {
      write(r, 'docs/wiki/concepts/a.md', page() + '[x](b.md)\n');
    });
    expect(run({ root }).errors.some((e) => e.message.startsWith('link gãy'))).toBe(true);
  });
  it('báo trang chưa có trong index', () => {
    const root = workspace((r) => {
      write(r, 'docs/wiki/concepts/b.md', page());
    });
    expect(
      run({ root }).errors.some((e) => e.file.endsWith('b.md') && e.message.includes('index')),
    ).toBe(true);
  });
  it('báo tiêu đề log sai', () => {
    const root = workspace((r) => {
      write(r, 'docs/wiki/log.md', '## hôm nay\n');
    });
    expect(run({ root }).errors.some((e) => e.file.endsWith('log.md'))).toBe(true);
  });
});
