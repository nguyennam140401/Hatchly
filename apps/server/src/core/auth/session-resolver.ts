import type { CustomerActor, StaffActor } from '../context/actor.types';

// Đảo phụ thuộc lõi ↔ module `account` (contracts/authz-api.md mục 4): lõi khai báo giao diện và token,
// AccountModule cung cấp phần triển khai. Thiếu nhà cung cấp → API không khởi động được.

export const SESSION_RESOLVER = Symbol('SESSION_RESOLVER');

/** Kết quả tra phiên: người gọi + hết hạn tuyệt đối của phiên (giới hạn tuổi mục bộ nhớ đệm). */
export interface Resolved<A> {
  actor: A;
  absoluteExpiresAt: Date;
}

export interface SessionResolver {
  /** Phiên khách hàng còn hiệu lực theo băm mã, hoặc null. */
  resolveCustomer(tokenHash: Buffer): Promise<Resolved<CustomerActor> | null>;
  /** Phiên nhân viên còn hiệu lực theo băm mã, hoặc null. */
  resolveStaff(tokenHash: Buffer, ip: string): Promise<Resolved<StaffActor> | null>;
}
