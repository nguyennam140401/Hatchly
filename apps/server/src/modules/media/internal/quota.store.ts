// Bộ đếm dung lượng 5 GB (014 data-model.md mục 1.3, FR-008, FR-028). Mọi thao tác là MỘT câu UPDATE có điều kiện
// chạy trong giao dịch (`tenantTx`) của CHÍNH nơi gọi – không giao dịch riêng – nên giữ chỗ, tạo `media`/phiên và
// tạo việc cùng thành công hoặc cùng hủy (hiến pháp II/V). RLS giới hạn mọi UPDATE vào đúng dòng của tài khoản trong
// ngữ cảnh; CHECK của bảng là chốt chặn cuối. KHÔNG cache.
import { gte, sql } from 'drizzle-orm';
import { buildQuota, type Quota } from '@app/shared/media';
import { currentAccountId, type Db } from '../../../core';
import { storageQuotas } from './db/schema';

/** Hết chỗ: không giữ chỗ được (web hiện "Thư viện đã đầy"). */
export class QuotaExceededError extends Error {
  readonly code = 'MEDIA_QUOTA_EXCEEDED';
  constructor(readonly quota: Quota) {
    super('Hết dung lượng thư viện');
    this.name = 'QuotaExceededError';
  }
}

export class QuotaStore {
  constructor(private readonly defaultLimitBytes: number) {}

  /** Bảo đảm có dòng cho tài khoản (idempotent, an toàn khi nhiều yêu cầu đầu tiên đến cùng lúc). */
  private async ensureRow(db: Db): Promise<void> {
    const accountId = currentAccountId();
    if (accountId === null) throw new Error('Thiếu ngữ cảnh tài khoản');
    await db
      .insert(storageQuotas)
      .values({ account_id: accountId, limit_bytes: this.defaultLimitBytes })
      .onConflictDoNothing({ target: storageQuotas.account_id });
  }

  /** Số liệu hiện tại, đọc thẳng từ CSDL; chưa có dòng ⇒ 0/0/hạn mức mặc định. */
  async read(db: Db): Promise<Quota> {
    const rows = await db
      .select({
        used: storageQuotas.used_bytes,
        reserved: storageQuotas.reserved_bytes,
        limit: storageQuotas.limit_bytes,
      })
      .from(storageQuotas)
      .limit(1);
    const r = rows[0];
    return r === undefined
      ? buildQuota(0, 0, this.defaultLimitBytes)
      : buildQuota(r.used, r.reserved, r.limit);
  }

  /**
   * Giữ chỗ `n` byte: `reserved += n WHERE used + reserved + n <= limit`. 0 dòng ⇒ hết chỗ
   * (`QuotaExceededError`, kèm số liệu hiện tại).
   */
  async reserve(db: Db, n: number): Promise<void> {
    await this.ensureRow(db);
    const updated = await db
      .update(storageQuotas)
      .set({ reserved_bytes: sql`${storageQuotas.reserved_bytes} + ${n}` })
      .where(
        sql`${storageQuotas.used_bytes} + ${storageQuotas.reserved_bytes} + ${n} <= ${storageQuotas.limit_bytes}`,
      )
      .returning({ id: storageQuotas.id });
    if (updated.length === 0) throw new QuotaExceededError(await this.read(db));
  }

  /**
   * Chốt khi xác nhận đạt: `reserved -= declared, used += real WHERE reserved >= declared`.
   * Trả `false` khi không còn chỗ giữ (đã chốt/trả trước đó) – gọi lại an toàn.
   */
  async commit(db: Db, declared: number, real: number): Promise<boolean> {
    const updated = await db
      .update(storageQuotas)
      .set({
        reserved_bytes: sql`${storageQuotas.reserved_bytes} - ${declared}`,
        used_bytes: sql`${storageQuotas.used_bytes} + ${real}`,
      })
      .where(gte(storageQuotas.reserved_bytes, declared))
      .returning({ id: storageQuotas.id });
    return updated.length > 0;
  }

  /** Trả giữ chỗ (hủy / lỗi / hết hạn): `reserved -= d WHERE reserved >= d`; đã trả ⇒ `false`, bỏ qua. */
  async releaseReservation(db: Db, declared: number): Promise<boolean> {
    const updated = await db
      .update(storageQuotas)
      .set({ reserved_bytes: sql`${storageQuotas.reserved_bytes} - ${declared}` })
      .where(gte(storageQuotas.reserved_bytes, declared))
      .returning({ id: storageQuotas.id });
    return updated.length > 0;
  }

  /**
   * Trả dung lượng đã chốt (xóa / trùng / không xử lý được): `used -= b WHERE used >= b`. CHỈ gọi khi dòng `media`
   * vừa chuyển trạng thái nhờ `UPDATE … WHERE status IN (…) RETURNING` (chạy lại không trả hai lần).
   */
  async refundUsed(db: Db, bytes: number): Promise<boolean> {
    const updated = await db
      .update(storageQuotas)
      .set({ used_bytes: sql`${storageQuotas.used_bytes} - ${bytes}` })
      .where(gte(storageQuotas.used_bytes, bytes))
      .returning({ id: storageQuotas.id });
    return updated.length > 0;
  }
}
