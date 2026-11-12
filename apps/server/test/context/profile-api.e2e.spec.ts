// Nhóm (b) – API × vai trò của hồ sơ kinh doanh (006 contracts/context-http-api.md, US1, US2, US3, US4,
// US5). ApiAppModule THẬT trên CSDL thử (`pnpm test:db`), mọi lỗi kiểm bằng `ErrorResponse.safeParse`.
// Chép mẫu này khi: thêm điểm cuối nghiệp vụ – mỗi dòng của bảng hợp đồng × mỗi vai trò (chủ, cộng tác
// viên, hỗ trợ, quản trị, chưa đăng nhập) là một ca; lỗi phải đúng mã, thông điệp, hành động.
import { ErrorResponse } from '@app/shared/core';
import {
  GetProfileResponse,
  SaveProfileResponse,
  VersionDetailResponse,
  VersionListResponse,
  type ProfileFieldsInput,
} from '@app/shared/context';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { ACCOUNT_PUBLIC_API, type AccountPublicApi } from '../../src/modules/account';
import { QueueLifecycle } from '../../src/modules/queue';
import { collaboratorOf, staffAgent } from '../auth/helpers/actors';
import {
  createTestApp,
  registerAndVerify,
  type Agent,
  type MeBody,
  type TestApp,
} from '../auth/helpers/app';
import { asOwner, describeDb } from '../db/helpers/db';

const P = '/api/v1/context/profile';

export const sampleFields = (over: Partial<ProfileFieldsInput> = {}): ProfileFieldsInput => ({
  industryCode: 'fashion',
  industryOther: null,
  introduction: 'Tiệm áo dài may đo ở Huế.',
  products: 'Áo dài, khăn đóng',
  policies: null,
  tone: null,
  keywords: ['áo dài'],
  ...over,
});

function expectError(
  res: { status: number; body: unknown },
  status: number,
  code: string,
): ErrorResponse['error'] {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  const parsed = ErrorResponse.safeParse(res.body);
  expect(parsed.success, JSON.stringify(res.body)).toBe(true);
  const error = parsed.data!.error;
  expect(error.code).toBe(code);
  return error;
}

async function versionCount(accountId: string): Promise<number> {
  return asOwner(async (c) => {
    const r = await c.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM context.profile_versions WHERE account_id = $1',
      [accountId],
    );
    return Number(r.rows[0]?.n ?? 0);
  });
}

describeDb('API hồ sơ kinh doanh (e2e)', () => {
  let t: TestApp;
  let owner: { agent: Agent; me: MeBody };
  let collaborator: { agent: Agent; userId: string };

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.get(QueueLifecycle).whenStarted(15_000);
    owner = await registerAndVerify(t, { displayName: 'Chị Lan' });
    collaborator = await collaboratorOf(t, owner.me);
  });
  afterAll(async () => {
    await t.close();
  });

  describe('US1 – chủ điền và cập nhật', () => {
    it('chưa có hồ sơ → 200 profile null + gợi ý đủ 4 trường', async () => {
      const res = await owner.agent.get(P);
      expect(res.status).toBe(200);
      expect(GetProfileResponse.parse(res.body)).toEqual({
        profile: null,
        missingOptional: ['products', 'policies', 'tone', 'keywords'],
      });
    });

    it('lưu lần đầu (expectedVersion 0) → v1; sửa → v2; lưu lại giống (khác khoảng trắng) → changed false', async () => {
      const first = await owner.agent.put(P, { expectedVersion: 0, fields: sampleFields() });
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const v1 = SaveProfileResponse.parse(first.body);
      expect(v1.changed).toBe(true);
      expect(v1.profile.version).toBe(1);
      expect(v1.profile.savedBy).toEqual({
        userId: owner.me.user.id,
        displayName: 'Chị Lan',
        memberStatus: 'active',
      });

      const second = await owner.agent.put(P, {
        expectedVersion: 1,
        fields: sampleFields({ tone: 'Thân thiện' }),
      });
      const v2 = SaveProfileResponse.parse(second.body);
      expect(v2).toMatchObject({ changed: true, profile: { version: 2 } });
      expect(v2.profile.fields.tone).toBe('Thân thiện');

      const same = await owner.agent.put(P, {
        expectedVersion: 2,
        fields: sampleFields({
          tone: '  Thân thiện  ',
          introduction: ' Tiệm áo dài may đo ở Huế. ',
        }),
      });
      expect(SaveProfileResponse.parse(same.body)).toMatchObject({
        changed: false,
        profile: { version: 2 },
      });
      expect(await versionCount(owner.me.account.id)).toBe(2);

      const got = GetProfileResponse.parse((await owner.agent.get(P)).body);
      expect(got.profile?.version).toBe(2);
      expect(got.missingOptional).toEqual(['policies']);
    });

    it('thân sai → 400 VALIDATION_FAILED, fieldErrors theo fields.<tên>, cùng thông điệp với web', async () => {
      const res = await owner.agent.put(P, {
        expectedVersion: 2,
        fields: sampleFields({ introduction: '', tone: 'x'.repeat(501) }),
      });
      const error = expectError(res, 400, 'VALIDATION_FAILED');
      expect(error.actions[0]?.kind).toBe('fix_input');
      expect(error.fieldErrors).toEqual([
        {
          path: ['fields', 'introduction'],
          message: 'Hãy viết vài dòng giới thiệu (tối đa 2.000 ký tự).',
        },
        { path: ['fields', 'tone'], message: 'Phần giọng văn dài quá 500 ký tự – hãy rút gọn.' },
      ]);
      // Nhật ký từ chối có mã + route mẫu, không có nội dung người dùng.
      const line = t.logs.find(
        (l) => l.msg === 'request.rejected' && l.code === 'VALIDATION_FAILED',
      );
      expect(line).toMatchObject({ route: '/api/v1/context/profile', method: 'PUT' });
      expect(t.rawLogs.join('\n')).not.toContain('x'.repeat(501));
    });
  });

  describe('US4 – xung đột phiên bản', () => {
    it('expectedVersion cũ → 409 VERSION_CONFLICT, "Tải bản mới nhất"', async () => {
      const res = await owner.agent.put(P, { expectedVersion: 1, fields: sampleFields() });
      const error = expectError(res, 409, 'VERSION_CONFLICT');
      expect(error.message).toBe('Hồ sơ vừa được cập nhật ở nơi khác. Tải bản mới nhất để xem.');
      expect(error.actions).toEqual([{ kind: 'retry', label: 'Tải bản mới nhất' }]);
    });

    it('expectedVersion 0 khi đã có hồ sơ → xung đột (không tạo hồ sơ thứ hai)', async () => {
      const res = await owner.agent.put(P, { expectedVersion: 0, fields: sampleFields() });
      expectError(res, 409, 'VERSION_CONFLICT');
    });

    it('bấm "Lưu" hai lần liên tiếp cùng nội dung → không tạo hai phiên bản', async () => {
      const before = await versionCount(owner.me.account.id);
      const body = { expectedVersion: 2, fields: sampleFields({ policies: 'Đổi trong 3 ngày' }) };
      const [r1, r2] = await Promise.all([owner.agent.put(P, body), owner.agent.put(P, body)]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([200, 409]);
      expect(await versionCount(owner.me.account.id)).toBe(before + 1);
    });
  });

  describe('US2 – cộng tác viên chỉ xem, chặn ở máy chủ', () => {
    it('cộng tác viên GET → 200 đầy đủ nội dung', async () => {
      const res = await collaborator.agent.get(P);
      expect(res.status).toBe(200);
      expect(GetProfileResponse.parse(res.body).profile?.version).toBe(3);
    });

    it('cộng tác viên PUT → 403 FORBIDDEN "Nhờ chủ tài khoản cập nhật", không có phiên bản mới', async () => {
      const before = await versionCount(owner.me.account.id);
      const res = await collaborator.agent.put(P, { expectedVersion: 3, fields: sampleFields() });
      const error = expectError(res, 403, 'FORBIDDEN');
      expect(error.message).toBe('Chỉ chủ tài khoản mới sửa được hồ sơ kinh doanh.');
      expect(error.actions).toContainEqual({
        kind: 'contact_owner',
        label: 'Nhờ chủ tài khoản cập nhật',
      });
      expect(await versionCount(owner.me.account.id)).toBe(before);
      expect(t.logs.some((l) => l.msg === 'request.rejected' && l.reason === 'forbidden')).toBe(
        true,
      );
      expect(t.logs.some((l) => l.msg === 'auth.denied')).toBe(true);
    });

    it('chưa đăng nhập → 401 UNAUTHENTICATED, hành động navigate', async () => {
      for (const res of [
        await t.agent().get(P),
        await t.agent().put(P, { expectedVersion: 0, fields: sampleFields() }),
        await t.agent().get(`${P}/versions`),
        await t.agent().get(`${P}/versions/${uuidV7()}`),
      ]) {
        const error = expectError(res, 401, 'UNAUTHENTICATED');
        expect(error.actions[0]?.kind).toBe('navigate');
      }
    });

    it('nhân viên hỗ trợ/quản trị (cookie nội bộ) không vào được cả 4 điểm cuối (FR-012)', async () => {
      for (const role of ['support', 'admin'] as const) {
        const { agent } = await staffAgent(t, role);
        for (const res of [
          await agent.get(P),
          await agent.put(P, { expectedVersion: 0, fields: sampleFields() }),
          await agent.get(`${P}/versions`),
          await agent.get(`${P}/versions/${uuidV7()}`),
        ]) {
          expect([401, 403], `${role} ${res.status}`).toContain(res.status);
          expect(ErrorResponse.safeParse(res.body).success).toBe(true);
        }
      }
    });
  });

  describe('US3 – phiên bản theo mã: của mình 200, của người khác và mã ngẫu nhiên cùng 404', () => {
    let versionIdA: string;

    beforeAll(async () => {
      const list = VersionListResponse.parse((await owner.agent.get(`${P}/versions`)).body);
      versionIdA = list.items.at(-1)!.versionId;
    });

    it('chủ mở phiên bản 1 của mình → 200 đúng nội dung, isCurrent false', async () => {
      const res = await owner.agent.get(`${P}/versions/${versionIdA}`);
      expect(res.status).toBe(200);
      const v = VersionDetailResponse.parse(res.body);
      expect(v).toMatchObject({ version: 1, isCurrent: false });
      expect(v.fields.tone).toBeNull();
    });

    it('versionId sai định dạng → 400', async () => {
      expectError(await owner.agent.get(`${P}/versions/abc`), 400, 'VALIDATION_FAILED');
    });

    it('tài khoản B đọc phiên bản của A và mã ngẫu nhiên → cùng 404 "Không tìm thấy phiên bản này."', async () => {
      const b = await registerAndVerify(t);
      const other = expectError(await b.agent.get(`${P}/versions/${versionIdA}`), 404, 'NOT_FOUND');
      const random = expectError(await b.agent.get(`${P}/versions/${uuidV7()}`), 404, 'NOT_FOUND');
      expect(other.message).toBe('Không tìm thấy phiên bản này.');
      expect(other.actions).toEqual(random.actions);
      expect(other.actions[0]).toMatchObject({ kind: 'navigate', label: 'Về hồ sơ kinh doanh' });
    });
  });

  describe('US5 – lịch sử phiên bản', () => {
    it('chưa có hồ sơ → items rỗng, total 0', async () => {
      const fresh = await registerAndVerify(t);
      const res = await fresh.agent.get(`${P}/versions`);
      expect(VersionListResponse.parse(res.body)).toEqual({
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
      });
    });

    it('21 phiên bản → trang 1 có 20 dòng mới nhất trước, trang 2 có 1 dòng; page=0 → 400', async () => {
      const o = await registerAndVerify(t);
      for (let v = 0; v < 21; v++) {
        const res = await o.agent.put(P, {
          expectedVersion: v,
          fields: sampleFields({ introduction: `Giới thiệu lần ${v + 1}` }),
        });
        expect(res.status).toBe(200);
      }
      const p1 = VersionListResponse.parse((await o.agent.get(`${P}/versions`)).body);
      expect(p1.total).toBe(21);
      expect(p1.pageSize).toBe(20);
      expect(p1.items).toHaveLength(20);
      expect(p1.items[0]?.version).toBe(21);
      expect(p1.items[19]?.version).toBe(2);
      const p2 = VersionListResponse.parse((await o.agent.get(`${P}/versions?page=2`)).body);
      expect(p2.items.map((i) => i.version)).toEqual([1]);
      expectError(await o.agent.get(`${P}/versions?page=0`), 400, 'VALIDATION_FAILED');
    });

    it('người lưu đã bị gỡ → "left" không tên; bị khóa → vẫn hiện tên', async () => {
      const o = await registerAndVerify(t);
      await o.agent.put(P, { expectedVersion: 0, fields: sampleFields() });
      await o.agent.put(P, { expectedVersion: 1, fields: sampleFields({ tone: 'Vui' }) });
      const accounts = t.app.get<AccountPublicApi>(ACCOUNT_PUBLIC_API);
      const removed = await collaboratorOf(t, o.me);
      const disabled = await collaboratorOf(t, o.me);
      // Dữ liệu mồi: gán người lưu của v1/v2 là hai cộng tác viên (owner – không qua RLS/REVOKE).
      await asOwner(async (c) => {
        await c.query(
          `UPDATE context.profile_versions SET saved_by_user_id = CASE version_number
             WHEN 1 THEN $2::uuid ELSE $3::uuid END WHERE account_id = $1`,
          [o.me.account.id, removed.userId, disabled.userId],
        );
      });
      await accounts.removeMember({
        accountId: o.me.account.id,
        userId: removed.userId,
        byUserId: o.me.user.id,
      });
      await accounts.disableMember({
        accountId: o.me.account.id,
        userId: disabled.userId,
        byUserId: o.me.user.id,
      });
      const list = VersionListResponse.parse((await o.agent.get(`${P}/versions`)).body);
      const byVersion = Object.fromEntries(list.items.map((i) => [i.version, i.savedBy]));
      expect(byVersion[1]).toEqual({
        userId: removed.userId,
        displayName: null,
        memberStatus: 'left',
      });
      expect(byVersion[2]).toEqual({
        userId: disabled.userId,
        displayName: 'Cộng tác viên',
        memberStatus: 'active',
      });
    });
  });
});
