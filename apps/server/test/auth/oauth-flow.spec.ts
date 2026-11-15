import { describe, expect, it } from 'vitest';
import { OAUTH_FLOW_STAGES } from '../../src/modules/account/internal/db/schema';
import { inviteEmailMatches } from '../../src/modules/account/internal/auth/invitations.service';
import {
  canTransition,
  nextStages,
  SIGNUP_MAIL_TTL_MS,
  stageTtlMs,
} from '../../src/modules/account/internal/auth/oauth/oauth-flow.service';
import { maskEmail } from '../../src/modules/account/internal/auth/oauth/oauth-login.service';

// T024 (phần thuần) + T049 (009): sơ đồ giai đoạn của lượt đăng nhập, hạn theo giai đoạn, quy tắc email
// của lời mời, che email.

const MIN = 60_000;
const config = { flowTtlMinutes: 10, linkConfirmTtlMinutes: 30 };

describe('sơ đồ chuyển giai đoạn của oauth_flows (data-model mục 3)', () => {
  const allowed: Record<string, string[]> = {
    started: [
      'signed_in',
      'needs_signup',
      'needs_email',
      'needs_link_confirm',
      'completed',
      'failed',
    ],
    needs_signup: ['completed', 'failed'],
    needs_email: ['awaiting_email', 'failed'],
    needs_link_confirm: ['completed', 'awaiting_email', 'failed'],
    awaiting_email: ['completed', 'failed'],
    signed_in: [],
    completed: [],
    failed: [],
  };

  it('mọi cặp có trong sơ đồ được phép; mọi cặp khác bị từ chối', () => {
    for (const from of OAUTH_FLOW_STAGES) {
      for (const to of OAUTH_FLOW_STAGES) {
        expect(canTransition(from, to), `${from} → ${to}`).toBe(allowed[from]?.includes(to));
      }
      expect([...nextStages(from)].sort()).toEqual([...(allowed[from] ?? [])].sort());
    }
  });

  it('giai đoạn kết thúc không đi tiếp được; không bao giờ quay lại started', () => {
    for (const end of ['signed_in', 'completed', 'failed'] as const) {
      expect(nextStages(end)).toEqual([]);
    }
    for (const from of OAUTH_FLOW_STAGES) expect(canTransition(from, 'started')).toBe(false);
    // Không nhảy cóc từ lúc bắt đầu sang chờ thư, không tự vào thẳng từ bước chờ.
    expect(canTransition('started', 'awaiting_email')).toBe(false);
    expect(canTransition('needs_email', 'completed')).toBe(false);
    expect(canTransition('needs_link_confirm', 'signed_in')).toBe(false);
  });
});

describe('hạn theo giai đoạn (research R5)', () => {
  it('started 10 phút; needs_* 30 phút; awaiting_email 24 giờ nếu email mới, 30 phút nếu trùng', () => {
    expect(stageTtlMs('started', config)).toBe(10 * MIN);
    for (const stage of ['needs_signup', 'needs_email', 'needs_link_confirm'] as const) {
      expect(stageTtlMs(stage, config)).toBe(30 * MIN);
    }
    expect(stageTtlMs('awaiting_email', config, { emailIsNew: true })).toBe(24 * 60 * MIN);
    expect(SIGNUP_MAIL_TTL_MS).toBe(24 * 60 * MIN);
    expect(stageTtlMs('awaiting_email', config)).toBe(30 * MIN);
    for (const end of ['signed_in', 'completed', 'failed'] as const) {
      expect(stageTtlMs(end, config)).toBeNull();
    }
    expect(stageTtlMs('started', { flowTtlMinutes: 5, linkConfirmTtlMinutes: 15 })).toBe(5 * MIN);
  });
});

describe('quy tắc email của lời mời khi chấp nhận bằng nhà cung cấp (research R10)', () => {
  it('trùng sau chuẩn hóa → nhận', () => {
    expect(inviteEmailMatches('minh@example.vn', 'minh@example.vn')).toBe(true);
    expect(inviteEmailMatches('  Minh@Example.VN ', 'minh@example.vn')).toBe(true);
  });
  it('khác → từ chối (dù nhà cung cấp đã xác minh hay chưa – hàm không nhận cờ đó)', () => {
    expect(inviteEmailMatches('khac@example.vn', 'minh@example.vn')).toBe(false);
    expect(inviteEmailMatches('minh@example.com', 'minh@example.vn')).toBe(false);
    expect(inviteEmailMatches('khong-phai-email', 'minh@example.vn')).toBe(false);
  });
  it('nhà cung cấp không trả email → nhận', () => {
    expect(inviteEmailMatches(null, 'minh@example.vn')).toBe(true);
  });
});

describe('maskEmail', () => {
  it('chỉ giữ ký tự đầu và tên miền', () => {
    expect(maskEmail('lan@example.vn')).toBe('l***@example.vn');
    expect(maskEmail('a@b.c')).toBe('a***@b.c');
    expect(maskEmail('khong-co-a-cong')).toBe('***');
  });
});
