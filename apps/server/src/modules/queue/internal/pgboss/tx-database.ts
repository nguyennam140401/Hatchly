// Bộ nối IDatabase trên kết nối của giao dịch đang mở (research R4): pg-boss ghi việc trên ĐÚNG
// PoolClient của tenantTx/systemTx → việc và dữ liệu nghiệp vụ cùng xác nhận hoặc cùng hoàn tác.
//
// Nhập thẳng `core/db/transaction` (không qua core/index.ts): `currentTxHandle()` lộ kết nối của giao
// dịch – chỉ lớp hàng chờ được dùng, module nghiệp vụ không bao giờ cầm kết nối "trần".
import type { PoolClient } from 'pg';
import { currentTxHandle, type TxContext } from '../../../../core/db/transaction';
import { queueError } from '../errors';
import type { BossDatabase } from './boss-loader';

/** IDatabase chạy trên một kết nối cụ thể (giao dịch của tenantTx/systemTx hoặc của bể điều khiển). */
export function clientDatabase(client: PoolClient): BossDatabase {
  return { executeSql: (text, values) => client.query(text, values as unknown[] | undefined) };
}

/** Giao dịch đang mở; ngoài giao dịch → `QUEUE_TX_REQUIRED` (FR-007). */
export function requireCurrentTx(): TxContext {
  const tx = currentTxHandle();
  if (tx === undefined) throw queueError('QUEUE_TX_REQUIRED');
  return tx;
}

/** IDatabase của giao dịch hiện tại. */
export function txDatabase(tx: TxContext): BossDatabase {
  return clientDatabase(tx.db.$client);
}
