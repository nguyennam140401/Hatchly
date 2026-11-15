import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkWebRules, scanSource } from '../check-web-rules.mjs';

// SC-002: mẫu vi phạm bị bắt kèm tệp:dòng, mẫu đúng không báo gì.
type Found = { line: number; rule: string; message: string }[];
const scan = scanSource as (raw: string, o: { customerArea: boolean }) => Found;
const rules = (src: string, customerArea = true) => scan(src, { customerArea }).map((v) => v.rule);

describe('check-web-rules: mẫu sai bị bắt', () => {
  it('màu viết cứng', () => {
    expect(rules(`const a = '#1a2b3c';`)).toContain('hard-coded-color');
    expect(rules(`const a = '#FFF';`)).toContain('hard-coded-color');
    expect(rules('const a = `rgb(1,2,3)`;')).toContain('hard-coded-color');
    expect(rules(`const a = 'hsl(10 20% 30%)';`)).toContain('hard-coded-color');
  });
  it('style={{}} có màu/cỡ chữ/khoảng cách/kích thước', () => {
    expect(rules(`<p style={{ color: 'red' }} />`)).toContain('inline-style');
    expect(rules(`<p style={{ fontSize: 14 }} />`)).toContain('inline-style');
    expect(rules(`<p style={{ marginTop: 8, padding: 4 }} />`)).toContain('inline-style');
    expect(rules(`<p style={{\n  width: 200,\n}} />`)).toContain('inline-style');
  });
  it('giá trị tùy ý trong className', () => {
    expect(rules(`<p className="w-[300px]" />`)).toContain('arbitrary-value');
    expect(rules(`<p className="bg-[#fff]" />`)).toContain('arbitrary-value');
    expect(rules(`<p className="text-[14px] p-2" />`)).toContain('arbitrary-value');
  });
  it('định dạng tiền ở khu vực khách hàng', () => {
    expect(rules(`t('Chi phí $12')`)).toContain('money-format');
    expect(rules(`const l = 'USD';`)).toContain('money-format');
    expect(rules(`const l = '500 đ';`)).toContain('money-format');
    expect(rules(`const l = '1000 VND';`)).toContain('money-format');
    expect(rules(`const costMicroUsd = 1;`)).toContain('money-format');
  });
  it('báo đúng số dòng', () => {
    const found = scan(`a\nb\nconst x = '#123456';\n`, { customerArea: true });
    expect(found.map((v) => v.line)).toEqual([3]);
  });
});

describe('check-web-rules: mẫu đúng không báo gì', () => {
  it('lớp token, biến CSS động, biến thể có điều kiện', () => {
    expect(rules(`<p className="bg-brand text-ink p-4 min-h-touch data-[state=open]:bg-brand-soft" />`)).toEqual([]);
    expect(rules(`<i style={{ '--value': \`\${pct}%\` }} className="w-(--value)" />`)).toEqual([]);
    expect(rules(`<a href="#main">Bỏ qua</a>`)).toEqual([]);
  });
  it('chữ tiếng Việt chứa "đ" không bị nhầm là đồng', () => {
    expect(rules(`const s = 'Có 5 đã duyệt, 3 điều chỉnh';`)).toEqual([]);
  });
  it('chú thích không bị quét', () => {
    expect(rules(`// giá USD $5 #ffffff\n/* rgb(1,2,3) */\nconst a = 1;`)).toEqual([]);
  });
  it('khu vực nội bộ được phép nhắc tiền', () => {
    expect(rules(`const l = 'USD';`, false)).toEqual([]);
  });
  it('ngoại lệ có chú thích lý do', () => {
    expect(rules(`// web-rules-ignore: màu của logo bên thứ ba\nconst a = '#123456';`)).toEqual([]);
  });
  it('chuỗi chứa // không cắt dòng', () => {
    expect(rules(`const u = 'http://x.vn'; const c = '#aabbcc';`)).toContain('hard-coded-color');
  });
});

describe('check-web-rules: quét thư mục', () => {
  function workspace(files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), 'webrules-'));
    for (const [rel, content] of Object.entries(files)) {
      const full = join(root, 'apps', 'web', 'src', rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    return root;
  }
  const run = checkWebRules as (o: { root: string; scope?: string }) => {
    violations: { file: string; line: number; rule: string }[];
    files: number;
  };

  it('bỏ qua styles/, kiểm thử; internal/ được nhắc tiền', () => {
    const root = workspace({
      'styles/x.ts': `export const c = '#123456';`,
      'ui/A.spec.tsx': `const c = '#123456';`,
      'internal/Cost.tsx': `export const l = 'USD';`,
      'ui/Good.tsx': `export const a = 1;`,
    });
    expect(run({ root }).violations).toEqual([]);
  });
  it('báo tệp:dòng', () => {
    const root = workspace({ 'features/X.tsx': `export const a = 1;\nexport const b = 'USD';` });
    const { violations } = run({ root });
    expect(violations).toEqual([expect.objectContaining({ file: 'apps/web/src/features/X.tsx', line: 2 })]);
  });
});
