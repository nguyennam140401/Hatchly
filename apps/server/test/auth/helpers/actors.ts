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

export async function createActors(t: TestApp): Promise<Actors> {
  const owner = await registerAndVerify(t);
  const collaborator = await collaboratorOf(t, owner.me);
  return {
    anonymous: t.agent(),
    owner: owner.agent,
    ownerMe: owner.me,
    collaborator: collaborator.agent,
    collaboratorId: collaborator.userId,
    support: (await staffAgent(t, 'support')).agent,
    admin: (await staffAgent(t, 'admin')).agent,
  };
}
