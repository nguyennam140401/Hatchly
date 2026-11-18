// Tạo một việc THEO TÀI KHOẢN từ một việc HỆ THỐNG (vd quét định kỳ `media.sweep` → `media.cleanup` cho từng tài khoản).
// Việc hệ thống không có ngữ cảnh tenant nên không gọi `enqueue` trực tiếp được: hàm này đặt ngữ cảnh của ĐÚNG tài khoản
// (mã đến từ truy vấn hệ thống đã lọc, không từ đầu vào người dùng) rồi tạo việc trong giao dịch tenant (hiến pháp I, V).
import { runWithJobContext } from '../../core/context/bind-account';
import { tenantTx } from '../../core/db/transaction';
import { uuidV7 } from '../../core/ids/uuid-v7';
import { enqueue } from './internal/producer';
import type { EnqueueOptions, EnqueueResult, JobTypeDefinition } from './public-api';

export function enqueueForAccount<P>(
  accountId: string,
  def: JobTypeDefinition<P>,
  payload: P,
  opts?: EnqueueOptions,
): Promise<EnqueueResult> {
  return runWithJobContext({ traceId: uuidV7(), accountId }, () =>
    tenantTx(() => enqueue(def, payload, opts)),
  );
}
