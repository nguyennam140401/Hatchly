import { currentAccountId, TenantContextError } from '../core/db';

// Thành phần có kịch bản giả lập (005, contracts/runtime-config.md mục 3). Tách riêng để kho bộ nhớ không
// phải nạp schema `sandbox` (moduleSchema('sandbox') ném lỗi ngoài development/test).
export const FAKE_COMPONENTS = ['platform', 'ai', 'notifications', 'mail'] as const;
export type FakeComponent = (typeof FAKE_COMPONENTS)[number];

export type FakeStateStore = 'memory' | 'sandbox';

export interface FakeScenario {
  id: string;
  component: FakeComponent;
  /** `connection:{id}`, `oauth`, `*`… – `*` khớp mọi đích. */
  target: string;
  spec: unknown;
  /** `null` = không giới hạn (không bị tiêu khi `take`). */
  remainingUses: number | null;
  createdAt: Date;
}

export interface PutScenario {
  component: FakeComponent;
  target: string;
  spec: unknown;
  remainingUses?: number | undefined;
}

export interface ScenarioStore {
  put(input: PutScenario): Promise<FakeScenario>;
  list(): Promise<FakeScenario[]>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  /**
   * Lấy kịch bản khớp `target` (khớp chính xác trước, rồi `*`; cũ nhất trước) và tiêu một lượt dùng bằng
   * cập nhật có điều kiện (`remaining_uses > 0`); hết lượt → xóa. Không có → `null`.
   */
  take(component: FakeComponent, target: string): Promise<FakeScenario | null>;
}

/** Tài khoản của ngữ cảnh hiện hành – thiếu → TenantContextError (như tenantTx). */
export function requireFakeAccount(): string {
  const accountId = currentAccountId();
  if (accountId === null) throw new TenantContextError('TENANT_CONTEXT_MISSING');
  return accountId;
}
