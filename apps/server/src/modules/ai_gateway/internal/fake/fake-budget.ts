import type { BudgetStore, CostLedgerEntry, Reservation } from '../budget/budget-store';

// Phần điều khiển dành cho kiểm thử / route quản trị của kho ngân sách GIẢ (005, contracts/ai-gateway.md
// mục 4). Có số tiền – CHỈ dev/test, không bao giờ ra màn hình khách hàng.

export interface FakeBudgetView {
  cycleStart: string;
  used: number;
  reserved: number;
  cap: number;
  softLimit: number;
  notified80: boolean;
  notified100: boolean;
}

export interface FakeBudgetControl {
  /** Đặt ngân sách chu kỳ của tài khoản trong ngữ cảnh (chu kỳ mới → thành chu kỳ hiện hành). */
  setBudget(b: { used?: number; reserved?: number; cap?: number; cycleStart?: string }): Promise<FakeBudgetView>;
  getBudget(): Promise<FakeBudgetView>;
  /** Ngân sách tuần hệ thống (ngữ cảnh không tài khoản). */
  setSystemBudget(b: { used?: number; reserved?: number; cap?: number; weekStart?: string }): Promise<void>;
  ledger(): Promise<CostLedgerEntry[]>;
  reservations(): Promise<Reservation[]>;
  /** Lùi `reservedAt`/`calledAt` của mọi giữ chỗ đang mở (mô phỏng thời gian trôi). */
  ageReservations(ms: number): Promise<void>;
  reset(): Promise<void>;
}

export type FakeBudgetStore = BudgetStore & FakeBudgetControl;
