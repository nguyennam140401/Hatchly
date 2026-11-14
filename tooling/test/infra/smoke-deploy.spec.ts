import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// T060/T079 (007): bộ kê khai triển khai tạm – ảnh theo digest, không bản giả lập ở phát hành, không hostNetwork.

const root = join(__dirname, '..', '..', '..', 'infra', 'smoke-deploy');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(root);
const yaml = files.filter((f) => f.endsWith('.yaml'));
const rel = (f: string) => f.slice(root.length + 1).replaceAll('\\', '/');

/** Nội dung bỏ dòng chú thích `#` (chú thích được phép nhắc tên biến). */
const code = (file: string) =>
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('#'))
    .join(' ');

const imageRefs = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/^\s*image:\s*(\S+)/gm)].map((m) => m[1] ?? '');

describe('ảnh trong bộ kê khai tạm', () => {
  it('overlay: mọi ảnh tham chiếu theo digest (@sha256:…), không theo thẻ', () => {
    const offenders = yaml
      .filter((f) => rel(f).startsWith('overlays/'))
      .flatMap((f) => imageRefs(f).map((ref) => ({ file: rel(f), ref })))
      .filter(({ ref }) => !/@sha256:[0-9a-f]{64}$/.test(ref));
    expect(offenders).toEqual([]);
  });

  it('base: chỉ tên ảnh trần (server/web) để overlay thay bằng digest – không thẻ, không `latest`', () => {
    const offenders = yaml
      .filter((f) => rel(f).startsWith('base/'))
      .flatMap((f) => imageRefs(f).map((ref) => ({ file: rel(f), ref })))
      .filter(({ ref }) => ref.includes(':') || !['server', 'web'].includes(ref));
    expect(offenders).toEqual([]);
  });

  it('có ít nhất một ảnh ở mỗi overlay (kiểm thử không rỗng vô nghĩa)', () => {
    const overlays = readdirSync(join(root, 'overlays'));
    expect(overlays.length).toBeGreaterThan(0);
    for (const o of overlays) {
      const refs = yaml.filter((f) => rel(f).startsWith(`overlays/${o}/`)).flatMap(imageRefs);
      expect(refs.length, o).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('phát hành chạy đúng ảnh đã kiểm (FR-009)', () => {
  it('images.yaml của staging và production tham chiếu cùng digest', () => {
    const staging = join(root, 'overlays', 'staging', 'images.yaml');
    const production = join(root, 'overlays', 'production', 'images.yaml');
    if (!existsSync(production)) return;
    const digests = (file: string) => imageRefs(file).map((ref) => ref.split('@')[1]);
    expect(digests(production)).toEqual(digests(staging));
  });
});

describe('an toàn cơ bản của kê khai', () => {
  it('không hostNetwork, không chạy root', () => {
    for (const f of yaml.filter((x) => rel(x).startsWith('base/'))) {
      const text = readFileSync(f, 'utf8');
      expect(text, rel(f)).not.toMatch(/hostNetwork:\s*true/);
      expect(text, rel(f)).not.toMatch(/runAsUser:\s*0\b/);
    }
  });

  it('Deployment api/worker/web có ≥ 2 bản và trải khác máy', () => {
    for (const name of ['api.yaml', 'worker.yaml', 'web.yaml']) {
      const text = readFileSync(join(root, 'base', name), 'utf8');
      expect(text, name).toMatch(/replicas:\s*2/);
      expect(text, name).toContain('topologySpreadConstraints');
      expect(text, name).toContain('registry-pull');
    }
  });

  it('worker: đủ grace 35 giây và giới hạn đĩa tạm 4 GB (FR-010)', () => {
    const text = readFileSync(join(root, 'base', 'worker.yaml'), 'utf8');
    expect(text).toMatch(/terminationGracePeriodSeconds:\s*35/);
    expect(text).toMatch(/ephemeral-storage:\s*4Gi/);
  });

  it('web không đặt API_UPSTREAM (môi trường thật gọi thẳng api)', () => {
    expect(readFileSync(join(root, 'base', 'web.yaml'), 'utf8')).not.toMatch(
      /name:\s*API_UPSTREAM/,
    );
  });
});

describe('bản giả lập chỉ ở thử nghiệm (R15, T079)', () => {
  const production = join(root, 'overlays', 'production', 'config.env');

  it('overlay thử nghiệm bật STAGING_ALLOW_FAKES cùng FAKE_STATE_STORE=sandbox', () => {
    const text = readFileSync(join(root, 'overlays', 'staging', 'config.env'), 'utf8');
    expect(text).toMatch(/^STAGING_ALLOW_FAKES=true$/m);
    expect(text).toMatch(/^FAKE_STATE_STORE=sandbox$/m);
    expect(text).toMatch(/^APP_ENV=staging$/m);
  });

  it('overlay phát hành (nếu có) không có STAGING_ALLOW_FAKES hay driver fake', () => {
    if (!existsSync(production)) return;
    const text = code(production);
    expect(text).not.toMatch(/STAGING_ALLOW_FAKES/);
    expect(text).not.toMatch(/_DRIVER=fake/);
    expect(text).not.toMatch(/FAKE_STATE_STORE/);
    expect(text).toMatch(/APP_ENV=production/);
  });

  it('không tệp nào ngoài overlay thử nghiệm đặt STAGING_ALLOW_FAKES', () => {
    const offenders = files
      .filter((f) => !rel(f).startsWith('overlays/staging/'))
      .filter((f) => code(f).includes('STAGING_ALLOW_FAKES'))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
