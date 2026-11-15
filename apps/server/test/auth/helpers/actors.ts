import { ACCOUNT_PUBLIC_API, type AccountPublicApi } from '../../../src/modules/account';
import {
  registerAndVerify,
  STRONG_PASSWORD,
  uniqueEmail,
  type Agent,
  type MeBody,
  type TestApp,
} from './app';

// Tạo đủ các loại người gọi cho ma trận quyền (SC-003): chủ, cộng tác viên, hỗ trợ, quản trị.

export interface Actors {
  anonymous: Agent;
  owner: Agent;
  ownerMe: MeBody;
  collaborator: Agent;
  collaboratorId: string;
  /** 009: người đã bị gỡ khỏi tài khoản, đang ở "tài khoản chờ" (`unclaimed`). */
  detached: Agent;
  support: Agent;
  admin: Agent;
}

export async function staffAgent(
  t: TestApp,
  role: 'support' | 'admin',
  ip?: string,
): Promise<{ agent: Agent; email: string; id: string }> {
  const accounts = t.app.get<AccountPublicApi>(ACCOUNT_PUBLIC_API);
  const email = uniqueEmail(role);
  const { id } = await accounts.createStaff({
    email,
    displayName: role === 'admin' ? 'Quản trị' : 'Hỗ trợ',
    role,
    password: STRONG_PASSWORD,
  });
  const agent = t.agent(ip === undefined ? {} : { ip });
  const res = await agent.post('/api/v1/internal/auth/login', { email, password: STRONG_PASSWORD });
  if (res.status !== 200) throw new Error(`staff login ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, email, id };
}

export async function collaboratorOf(
  t: TestApp,
  owner: MeBody,
): Promise<{ agent: Agent; userId: string; email: string }> {
  const accounts = t.app.get<AccountPublicApi>(ACCOUNT_PUBLIC_API);
  const email = uniqueEmail('ctv');
  const { userId } = await accounts.addMember({
    accountId: owner.account.id,
    displayName: 'Cộng tác viên',
    email,
    password: STRONG_PASSWORD,
    emailVerified: true,
    addedByUserId: owner.user.id,
  });
  const agent = t.agent();
  const res = await agent.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
  if (res.status !== 200) throw new Error(`collaborator login ${res.status}`);
  return { agent, userId, email };
}

/**
 * 009: người ở tài khoản chờ – thêm một cộng tác viên rồi để chủ gỡ (đường thật `DELETE /members/{id}`),
 * sau đó đăng nhập lại: có phiên nhưng `account.status = 'unclaimed'`.
 */
export async function detachedOf(
  t: TestApp,
  owner: { agent: Agent; me: MeBody },
): Promise<{ agent: Agent; userId: string; email: string; me: MeBody }> {
  const member = await collaboratorOf(t, owner.me);
  const removed = await owner.agent.delete(`/api/v1/members/${member.userId}`);
  if (removed.status !== 204) throw new Error(`remove ${removed.status} ${removed.text}`);
  const agent = t.agent();
  const login = await agent.post('/api/v1/auth/login', {
    email: member.email,
    password: STRONG_PASSWORD,
  });
  if (login.status !== 200) throw new Error(`detached login ${login.status} ${login.text}`);
  return { agent, userId: member.userId, email: member.email, me: login.body as MeBody };
}

/** 009: chủ vừa đăng ký, CHƯA bấm liên kết xác minh email – có phiên nhưng `emailVerified = false`. */
export async function unverifiedOwner(t: TestApp): Promise<{ agent: Agent; email: string }> {
  const email = uniqueEmail('chuaxm');
  const agent = t.agent();
  const reg = await agent.post('/api/v1/auth/register', {
    displayName: 'Chủ chưa xác minh',
    email,
    password: STRONG_PASSWORD,
    acceptTerms: true,
    termsVersion: '2026-11',
  });
  if (reg.status !== 202) throw new Error(`register ${reg.status} ${JSON.stringify(reg.body)}`);
  const login = await agent.post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
  if (login.status !== 200) throw new Error(`login ${login.status} ${login.text}`);
  return { agent, email };
}

export async function createActors(t: TestApp): Promise<Actors> {
  const owner = await registerAndVerify(t);
  const collaborator = await collaboratorOf(t, owner.me);
  const detached = await detachedOf(t, owner);
  return {
    anonymous: t.agent(),
    owner: owner.agent,
    ownerMe: owner.me,
    collaborator: collaborator.agent,
    collaboratorId: collaborator.userId,
    detached: detached.agent,
    support: (await staffAgent(t, 'support')).agent,
    admin: (await staffAgent(t, 'admin')).agent,
  };
}
