// Kiểm thử đơn vị thuần của Đăng bài (013): bảng chuyển trạng thái, chính sách thử lại/đối soát, dựng bước hiển thị,
// hành động cho phép theo vai trò, và quy tắc kiến trúc "không đổi `status` ngoài state-machine".
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ATTEMPT_STATUSES, type AttemptStatus } from '@app/shared/content';
import { toDisplayStatus } from '@app/shared/publishing';
import {
  ALLOWED_TRANSITIONS,
  isAllowedTransition,
} from '../../src/modules/publishing/internal/state-machine';
import {
  isTooLate,
  nextReconcileAction,
  nextTransientDelay,
  reconcileExpired,
} from '../../src/modules/publishing/internal/retry-policy';
import {
  allowedActionsFor,
  buildSteps,
} from '../../src/modules/publishing/internal/progress.query';
import { sanitizeRawCode } from '../../src/modules/publishing/internal/step-log';
import type { PublishStepRow } from '../../src/modules/publishing/internal/db/publish-steps.log-table';

describe('máy trạng thái lượt đăng', () => {
  const valid: [AttemptStatus, AttemptStatus][] = [
    ['scheduled', 'processing'],
    ['scheduled', 'cancelled'],
    ['processing', 'succeeded'],
    ['processing', 'retry_wait'],
    ['processing', 'needs_user'],
    ['processing', 'unknown'],
    ['retry_wait', 'processing'],
    ['unknown', 'succeeded'],
    ['unknown', 'retry_wait'],
    ['unknown', 'needs_check'],
    ['needs_check', 'succeeded'],
    ['needs_check', 'scheduled'],
    ['needs_user', 'scheduled'],
  ];

  it('mọi chuyển hợp lệ của research R1 được chấp nhận', () => {
    for (const [from, to] of valid)
      expect(isAllowedTransition(from, to), `${from}→${to}`).toBe(true);
  });

  it('succeeded và cancelled là trạng thái cuối; đăng lại kênh đã đăng không có đường', () => {
    expect(ALLOWED_TRANSITIONS.succeeded).toEqual([]);
    expect(ALLOWED_TRANSITIONS.cancelled).toEqual([]);
    expect(isAllowedTransition('succeeded', 'scheduled')).toBe(false);
  });

  it('các cặp ngoài bảng bị từ chối (vd nhảy thẳng scheduled → succeeded, needs_user → processing)', () => {
    const bad: [AttemptStatus, AttemptStatus][] = [
      ['scheduled', 'succeeded'],
      ['scheduled', 'unknown'],
      ['needs_user', 'processing'],
      ['needs_check', 'processing'],
      ['retry_wait', 'succeeded'],
      ['unknown', 'processing'],
      ['cancelled', 'scheduled'],
    ];
    for (const [from, to] of bad)
      expect(isAllowedTransition(from, to), `${from}→${to}`).toBe(false);
  });

  it('gộp 8 trạng thái nội bộ thành 5 trạng thái hiển thị; người dùng không thấy retry_wait/unknown', () => {
    const shown = new Set(ATTEMPT_STATUSES.map(toDisplayStatus));
    expect(shown).toEqual(
      new Set(['scheduled', 'publishing', 'needs_action', 'published', 'cancelled']),
    );
    expect(toDisplayStatus('retry_wait')).toBe('publishing');
    expect(toDisplayStatus('unknown')).toBe('publishing');
    expect(toDisplayStatus('needs_check')).toBe('needs_action');
  });
});

describe('chính sách thử lại lỗi tạm thời', () => {
  const t0 = new Date('2026-11-20T02:00:00Z');
  const after = (sec: number) => new Date(t0.getTime() + sec * 1000);

  it('giãn cách 60/180/360/600/600, tối đa 5 lần rồi hết', () => {
    const delays: number[] = [];
    let at = 0;
    for (let i = 0; i < 5; i++) {
      const d = nextTransientDelay(i, i === 0 ? null : t0, after(at), undefined);
      expect(d.kind).toBe('retry');
      if (d.kind === 'retry') {
        delays.push(d.delaySec);
        at += d.delaySec;
      }
    }
    expect(delays).toEqual([60, 180, 360, 600, 600]);
    expect(at).toBe(1800);
    expect(nextTransientDelay(5, t0, after(1800), undefined)).toEqual({ kind: 'exhausted' });
  });

  it('quá cửa sổ 30 phút thì hết dù chưa đủ 5 lần', () => {
    expect(nextTransientDelay(2, t0, after(1500), undefined)).toEqual({ kind: 'exhausted' });
  });

  it('nền tảng báo chờ lâu hơn thì lấy giá trị lớn hơn nhưng không vượt cửa sổ', () => {
    expect(nextTransientDelay(0, null, after(0), 300)).toMatchObject({
      kind: 'retry',
      delaySec: 300,
    });
    expect(nextTransientDelay(0, t0, after(0), 4000)).toEqual({ kind: 'exhausted' });
  });
});

describe('chính sách đối soát và quá giờ hẹn', () => {
  const t0 = new Date('2026-11-20T02:00:00Z');
  const after = (sec: number) => new Date(t0.getTime() + sec * 1000);

  it('lần đầu sau 2 phút, sau đó mỗi 2 phút; bỏ cuộc ở 10 phút', () => {
    expect(nextReconcileAction(t0, null, after(30))).toEqual({ kind: 'wait', delaySec: 90 });
    expect(nextReconcileAction(t0, null, after(120))).toEqual({ kind: 'check_now' });
    expect(nextReconcileAction(t0, after(120), after(180))).toEqual({ kind: 'wait', delaySec: 60 });
    expect(nextReconcileAction(t0, after(120), after(240))).toEqual({ kind: 'check_now' });
    expect(reconcileExpired(t0, after(599))).toBe(false);
    expect(reconcileExpired(t0, after(600))).toBe(true);
  });

  it('quá 60 phút so với giờ hẹn thì không tự đăng; đúng 60 phút vẫn đăng', () => {
    expect(isTooLate(t0, after(3600))).toBe(false);
    expect(isTooLate(t0, after(3601))).toBe(true);
  });
});

describe('dựng bước hiển thị', () => {
  const row = (
    key: string,
    event: 'started' | 'finished',
    outcome: string | null,
    extra: Partial<PublishStepRow> = {},
    sec = 0,
  ): PublishStepRow => ({
    id: 'x',
    account_id: 'a',
    attempt_id: 'b',
    run_no: 1,
    step_no: 1,
    step_key: key,
    event,
    outcome,
    error_category: null,
    raw_code: null,
    message_vi: null,
    remedies: null,
    note: null,
    occurred_at: new Date(Date.UTC(2026, 10, 20, 2, 0, sec)),
    trace_id: 't',
    ...extra,
  });

  it('lỗi ở bước 2: bước 1 xong, bước 2 lỗi kèm giải thích + cách sửa, bước 3-5 chưa chạy/bị bỏ qua', () => {
    const built = buildSteps(
      [
        row('precheck', 'started', null),
        row('precheck', 'finished', 'succeeded'),
        row('prepare_media', 'started', null),
        row('prepare_media', 'finished', 'failed', {
          message_vi: 'Ảnh không phù hợp.',
          remedies: [{ action: 'edit_media', labelVi: 'Chọn ảnh khác' }],
        }),
        row('submit', 'finished', 'skipped'),
      ],
      'needs_user',
    );
    expect(built.steps.map((s) => s.state)).toEqual([
      'succeeded',
      'failed',
      'skipped',
      'not_run',
      'not_run',
    ]);
    expect(built.steps[1]?.messageVi).toBe('Ảnh không phù hợp.');
    expect(built.failedRemedies).toEqual([{ action: 'edit_media', labelVi: 'Chọn ảnh khác' }]);
  });

  it('lượt đang tự thử lại: lỗi tạm thời KHÔNG lộ ra (hiển thị đang thực hiện, không thông điệp lỗi)', () => {
    const built = buildSteps(
      [
        row('submit', 'finished', 'failed', {
          error_category: 'transient',
          message_vi: 'Lỗi tạm',
          remedies: [{ action: 'retry_later', labelVi: 'Chờ' }],
        }),
      ],
      'retry_wait',
    );
    expect(built.steps[2]).toMatchObject({ state: 'running', messageVi: null, remedies: [] });
  });

  it('bài đã đăng nhờ đối soát: bước "không xác định" trước đó thành công, không còn lỗi', () => {
    const built = buildSteps(
      [row('submit', 'finished', 'failed', { error_category: 'unknown', message_vi: 'x' })],
      'succeeded',
    );
    expect(built.steps[2]?.state).toBe('succeeded');
  });

  it('lượt scheduled: mọi bước chưa chạy kể cả khi còn nhật ký của lần chạy trước', () => {
    const built = buildSteps(
      [row('precheck', 'finished', 'failed', { message_vi: 'x' })],
      'scheduled',
    );
    expect(built.steps.every((s) => s.state === 'not_run')).toBe(true);
  });
});

describe('hành động cho phép', () => {
  it('needs_user do quyền hết hạn: chủ có Kết nối lại + Đăng lại; cộng tác viên nhờ chủ kết nối lại', () => {
    expect(allowedActionsFor('needs_user', 'token_expired', true, 'owner')).toEqual([
      'reconnect',
      'republish',
      'contact_support',
    ]);
    expect(allowedActionsFor('needs_user', 'token_expired', true, 'collaborator')).toEqual([
      'ask_owner_to_reconnect',
      'republish',
      'contact_support',
    ]);
  });

  it('needs_check: Đã đăng + Đăng lại; không quyền thì chỉ liên hệ hỗ trợ', () => {
    expect(allowedActionsFor('needs_check', 'uncertain_result', true, 'owner')).toEqual([
      'mark_published',
      'republish',
      'contact_support',
    ]);
    expect(allowedActionsFor('needs_check', 'uncertain_result', false, 'owner')).toEqual([
      'contact_support',
    ]);
  });

  it('quá giờ / hết hạn mức gợi ý đổi giờ; kênh đã đăng không có đăng lại', () => {
    expect(allowedActionsFor('needs_user', 'overdue', true, 'owner')).toContain('change_time');
    expect(allowedActionsFor('succeeded', null, true, 'owner')).toEqual([]);
    expect(allowedActionsFor('processing', null, true, 'owner')).toEqual([]);
  });
});

describe('lọc mã lỗi gốc', () => {
  it('chỉ giữ ký tự an toàn, cắt 64, rỗng → UNKNOWN', () => {
    expect(sanitizeRawCode('FB:190')).toBe('FB:190');
    expect(sanitizeRawCode('bad code <script>')).toBe('badcodescript');
    expect(sanitizeRawCode('x'.repeat(100))).toHaveLength(64);
    expect(sanitizeRawCode('!!!')).toBe('UNKNOWN');
    expect(sanitizeRawCode(undefined)).toBeNull();
  });
});

describe('quy tắc kiến trúc publishing-no-raw-status-update', () => {
  const root = join(__dirname, '..', '..', 'src', 'modules', 'publishing');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });

  it('chỉ state-machine.ts được `UPDATE … SET status`; không nơi nào khác ghi cột status', () => {
    const offenders: string[] = [];
    for (const file of walk(root)) {
      const rel = relative(root, file).split(sep).join('/');
      if (rel === 'internal/state-machine.ts' || rel.includes('/db/')) continue;
      const src = readFileSync(file, 'utf8');
      // `.set({ … status: …` hoặc SQL thô `SET status`.
      if (/\.set\(\s*\{[^}]*\bstatus\s*:/s.test(src) || /SET\s+status\b/i.test(src))
        offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('không có `submit` nào gọi ngoài submit.ts (bước gửi duy nhất)', () => {
    const offenders: string[] = [];
    for (const file of walk(root)) {
      const rel = relative(root, file).split(sep).join('/');
      if (rel === 'internal/executor/submit.ts') continue;
      if (readFileSync(file, 'utf8').includes('gateway.submit(')) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
