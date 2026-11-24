import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import type { NotificationEvent } from '@app/shared/notifications';
import { beforeAll, describe, expect, it } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { AiError, type AiRequest } from '../../src/modules/ai_gateway';
import { render } from '../../src/modules/notifications/internal/templates';
import { makeAiHarness, type AiHarness } from '../contracts/ai/harness';
import { expectCustomerSafeRemedy } from '../contracts/ai/message-assert';

// 015 T057 / SC-014 (FR-031, FR-032; hiến chương III, VI): khi ngân sách AI hết (AI_BUDGET_EXHAUSTED), 100% thao tác thủ công
// (soạn/sửa, duyệt, lên lịch, đăng, tải media, gắn nhãn tay) vẫn hoàn thành vì Cổng AI KHÔNG nằm trên đường của chúng.
// Kiểm bằng bốn lớp:
//  (a) tĩnh: module của đường đăng/duyệt/nền tảng KHÔNG phụ thuộc và KHÔNG import `ai_gateway` (manifest + mã nguồn);
//      module có chức năng AI (content, media, context, trends) chỉ chạm Cổng AI ở tệp dành riêng cho AI (tên chứa `ai`);
//  (b) động: ngân sách hết → chỉ lời gọi AI bị chặn trước khi gọi nhà cung cấp, lỗi mang mã có thể xử lý, trạng thái `blocked`;
//  (c) thông điệp: lỗi không số tiền; kèm lối tiếp tục thủ công ở thông báo `ai_usage_100` (FR-031 phía server);
//  (d) giao diện: apps/web/src/lib/limits/limits.spec.tsx ('soạn tay vẫn dùng được'), apps/web/src/ui/cards/cards.spec.tsx
//      (nhãn chữ + biểu tượng) – xem acceptance-report.md.

const SRC = resolve(process.cwd(), 'src', 'modules');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/** Tệp (ngoài ai_gateway) có import từ module `ai_gateway` (đường tương đối hoặc bí danh). */
function importersOf(moduleName: string): string[] {
  return sourceFiles(join(SRC, moduleName)).filter((f) =>
    /from\s+['"][^'"]*\bai_gateway\b[^'"]*['"]|import\(\s*['"][^'"]*\bai_gateway\b/.test(
      readFileSync(f, 'utf8'),
    ),
  );
}

interface ManifestModule {
  name: string;
  allowedDeps: string[];
}
const manifest = JSON.parse(readFileSync(join(SRC, 'modules.manifest.json'), 'utf8')) as {
  modules: ManifestModule[];
};
const depsOf = (name: string): string[] =>
  manifest.modules.find((m) => m.name === name)?.allowedDeps ?? [];

describe('SC-014 (a) đường thủ công không đi qua Cổng AI', () => {
  // Đường đăng/duyệt/lên lịch/nền tảng: không được phụ thuộc Cổng AI dù chỉ ở mức khai báo.
  for (const name of [
    'publishing',
    'approval',
    'platform_gateway',
    'account',
    'notifications',
    'queue',
  ]) {
    it(`${name}: không có ai_gateway trong allowedDeps và không import ai_gateway`, () => {
      expect(depsOf(name), name).not.toContain('ai_gateway');
      expect(
        importersOf(name).map((f) => relative(SRC, f)),
        name,
      ).toEqual([]);
    });
  }

  // Module có chức năng AI: thao tác thủ công (soạn/sửa tay, tải media, gắn nhãn tay) nằm ở tệp khác tệp dùng AI.
  for (const name of ['content', 'media', 'context', 'trends']) {
    it(`${name}: chỉ tệp dành riêng cho AI (tên có "ai") mới import ai_gateway`, () => {
      const offenders = importersOf(name).filter((f) => !/ai/i.test(basename(f)));
      expect(
        offenders.map((f) => relative(SRC, f)),
        `${name}: tệp thủ công không được phụ thuộc Cổng AI`,
      ).toEqual([]);
    });
  }

  it('đường thủ công của media (tải lên bằng đường dẫn ký sẵn, gắn nhãn tay) không import Cổng AI', () => {
    const manual = sourceFiles(join(SRC, 'media')).filter(
      (f) => /(upload|presign|manual|label|tag)/i.test(basename(f)) && !/ai/i.test(basename(f)),
    );
    for (const f of manual) {
      expect(readFileSync(f, 'utf8'), relative(SRC, f)).not.toMatch(/ai_gateway|AI_GATEWAY/);
    }
  });
});

describe('SC-014 (b) hết ngân sách chỉ chặn lời gọi AI', () => {
  let h: AiHarness;
  beforeAll(async () => {
    h = await makeAiHarness('memory', () => Promise.resolve(uuidV7()), {
      onCrossed: () => Promise.resolve(),
      count: () => Promise.resolve(0),
    });
  });
  const CAP = 4_000_000;
  const req: AiRequest = {
    task: 'post_generation',
    prompt: { system: 'Bạn là trợ lý viết bài.', delta: 'Viết bài khai trương.' },
    maxOutputTokens: 400,
  };

  it('ngân sách hết: lời gọi AI bị chặn TRƯỚC khi gọi nhà cung cấp (AI_BUDGET_EXHAUSTED), không giữ chỗ, không sổ', async () => {
    await h.inAccount(uuidV7(), async () => {
      await h.fake.setBudget({ used: CAP });
      const before = h.bundle.primary.calls.length + h.bundle.fallback.calls.length;
      const err = await h
        .gateway()
        .generate(req)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AiError);
      expect((err as AiError).code).toBe('AI_BUDGET_EXHAUSTED');
      expect((err as AiError).retryable).toBe(false);
      expect(h.bundle.primary.calls.length + h.bundle.fallback.calls.length).toBe(before);
      expect(await h.fake.reservations()).toEqual([]);
      expect(await h.fake.ledger()).toEqual([]);
    });
  });

  it('ngân sách hết: getUsage vẫn đọc được (không ném), trạng thái blocked, chỉ phần trăm', async () => {
    await h.inAccount(uuidV7(), async () => {
      await h.fake.setBudget({ used: CAP });
      const usage = await h.gateway().getUsage();
      expect(usage.state).toBe('blocked');
      expect(usage.percent).toBe(100);
      expect(Object.keys(usage).sort()).toEqual(['nextCycleStartsAt', 'percent', 'state']);
    });
  });

  it('chặn của một tài khoản không ảnh hưởng tài khoản khác (vẫn gọi được)', async () => {
    await h.inAccount(uuidV7(), async () => {
      await h.fake.setBudget({ used: CAP });
    });
    await h.inAccount(uuidV7(), async () => {
      const out = await h.gateway().generate(req);
      expect(out.text.length).toBeGreaterThan(0);
    });
  });
});

describe('SC-014 (c) thông điệp khi hết AI: không số tiền, có lối tiếp tục thủ công (FR-031)', () => {
  it('AI_BUDGET_EXHAUSTED: messageVi tiếng Việt đời thường, không số tiền/đơn vị tiền, không mã lỗi gốc', () => {
    const e = new AiError('AI_BUDGET_EXHAUSTED');
    expect(e.messageVi).toContain('giới hạn AI');
    expect(e.messageVi).toContain('tự soạn');
    expectCustomerSafeRemedy(e.messageVi);
  });

  it('AI_NOT_CONFIGURED và AI_PROVIDER_UNAVAILABLE: không số tiền, có hành động khắc phục; vẫn soạn tay/tự soạn được', () => {
    expect(new AiError('AI_NOT_CONFIGURED').messageVi).toContain('soạn tay');
    expect(new AiError('AI_PROVIDER_UNAVAILABLE').messageVi).toContain('tự soạn bài');
    for (const code of [
      'AI_NOT_CONFIGURED',
      'AI_PROVIDER_UNAVAILABLE',
      'AI_BUDGET_EXHAUSTED',
      'AI_INVALID_REQUEST',
      'AI_DUPLICATE_REQUEST',
      'AI_SYSTEM_BUDGET_EXHAUSTED',
    ] as const) {
      expectCustomerSafeRemedy(new AiError(code).messageVi, code);
    }
  });

  it('thông báo ai_usage_100: nêu rõ vẫn soạn tay, duyệt, lên lịch, đăng; có hành động mở mức dùng; không số tiền', () => {
    const event: NotificationEvent = {
      type: 'ai_usage_100',
      refs: { cycleStart: '2026-11-01' },
      params: { percent: 100 },
    };
    const out = render(event, 'https://app.example');
    const text = `${out.titleVi} ${out.bodyVi}`;
    for (const word of ['soạn tay', 'duyệt', 'lên lịch', 'đăng']) expect(text).toContain(word);
    expect(out.actions.length).toBeGreaterThan(0);
    expect(out.actions.some((a) => a.kind === 'open_usage')).toBe(true);
    expect(text).not.toMatch(/\$|usd|micro|₫|vnd/i);
  });

  it('thông báo ai_usage_80: cũng nêu soạn/duyệt/đăng vẫn bình thường (cảnh báo sớm)', () => {
    const event: NotificationEvent = {
      type: 'ai_usage_80',
      refs: { cycleStart: '2026-11-01' },
      params: { percent: 80 },
    };
    const out = render(event, 'https://app.example');
    expect(out.bodyVi).toMatch(/soạn/);
    expect(out.bodyVi).toMatch(/đăng/);
  });
});
