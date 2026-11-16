// Hành động của người dùng trên một lượt đăng (013): "Đăng lại" (FR-006) và "Đã đăng" (FR-021).
// Mỗi hành động là MỘT giao dịch: cập nhật có điều kiện theo trạng thái + phiên bản (khóa lạc quan), tạo việc, ghi
// kiểm toán. KHÔNG BAO GIỜ tự quyết thay người dùng; "Đã đăng" không gọi nền tảng.
import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type {
  MarkPublishedResponse,
  RepublishResponse,
  SupportAttemptDetails,
} from '@app/shared/publishing';
import { auditLog } from '../../../core/db/audit-log.log-table';
import { currentAccountId, getExecutionContext, tenantTx, type Db } from '../../../core';
import { enqueue } from '../../queue';
import { runAttemptDedupeKey, runAttemptJob } from '../jobs';
import { loadAttempt } from './attempts.repository';
import { publishAttempts, type PublishAttemptRow } from './db/schema';
import {
  attemptNotFound,
  notCheckable,
  notRepublishable,
  publishVersionConflict,
} from './publish-errors';
import { transition } from './state-machine';

async function audit(
  db: Db,
  userId: string,
  action: 'publish.republish' | 'publish.mark_published',
  row: PublishAttemptRow,
): Promise<void> {
  // CHỈ mã tham chiếu và trạng thái – không nội dung bài, không mã quyền.
  await db.insert(auditLog).values({
    account_id: currentAccountId(),
    actor_type: 'user',
    actor_id: userId,
    action,
    trace_id: getExecutionContext()?.traceId ?? null,
    metadata: {
      attemptId: row.id,
      postId: row.post_id,
      fromStatus: row.status,
      reason: row.needs_reason,
    },
  });
}

const CATEGORY_LABEL: Record<string, string> = {
  transient: 'Lỗi tạm thời của nền tảng',
  user_action: 'Cần người dùng xử lý',
  unknown: 'Không xác định',
};

@Injectable()
export class AttemptActionsService {
  /** "Đăng lại": `needs_user | needs_check → scheduled` trên CÙNG dòng, giờ đăng = bây giờ, tạo việc mới. */
  async republish(
    attemptId: string,
    version: number,
    actorUserId: string,
  ): Promise<RepublishResponse> {
    return tenantTx(async (db) => {
      const before = await loadAttempt(db, attemptId);
      if (before === null) throw attemptNotFound();
      const moved = await transition(
        db,
        attemptId,
        ['needs_user', 'needs_check'],
        'scheduled',
        {
          scheduled_at: sql`now()`,
          phase: 'none',
          content_hash: null,
          submitted_at: null,
          processing_id: null,
          needs_reason: null,
          reconcile_retry_used: false,
          transient_attempts: 0,
          transient_window_started_at: null,
          last_error_category: null,
          last_raw_code: null,
        },
        { extra: sql`${publishAttempts.version} = ${version}` },
      );
      if (!moved.ok) {
        // Phân biệt lý do để người dùng biết phải làm gì: lượt đã đổi trạng thái hay phiên bản lệch.
        const now = await loadAttempt(db, attemptId);
        if (now === null) throw attemptNotFound();
        if (now.status !== 'needs_user' && now.status !== 'needs_check') throw notRepublishable();
        throw publishVersionConflict();
      }
      await enqueue(
        runAttemptJob,
        { attemptId },
        { runAfter: new Date(), dedupeKey: runAttemptDedupeKey(attemptId) },
      );
      await audit(db, actorUserId, 'publish.republish', before);
      return {
        attemptId,
        status: 'scheduled',
        ...(before.status === 'needs_check' ? { warning: 'possible_duplicate' as const } : {}),
      };
    });
  }

  /** "Đã đăng": người dùng tự kiểm tra trên trang rồi xác nhận; KHÔNG gọi nền tảng. Chỉ từ `needs_check`. */
  async markPublished(
    attemptId: string,
    version: number,
    permalink: string | undefined,
    actorUserId: string,
  ): Promise<MarkPublishedResponse> {
    return tenantTx(async (db) => {
      const before = await loadAttempt(db, attemptId);
      if (before === null) throw attemptNotFound();
      const moved = await transition(
        db,
        attemptId,
        'needs_check',
        'succeeded',
        {
          phase: 'finished',
          confirmed_by: 'user',
          needs_reason: null,
          ...(permalink !== undefined ? { permalink } : {}),
        },
        { extra: sql`${publishAttempts.version} = ${version}` },
      );
      if (!moved.ok) {
        const now = await loadAttempt(db, attemptId);
        if (now === null) throw attemptNotFound();
        if (now.status !== 'needs_check') throw notCheckable();
        throw publishVersionConflict();
      }
      await audit(db, actorUserId, 'publish.mark_published', before);
      return { attemptId, status: 'published', permalink: moved.row.permalink };
    });
  }

  /** Nội dung vùng "Chi tiết cho hỗ trợ": mã lỗi gốc đã lọc + mã theo dõi; KHÔNG mã quyền, KHÔNG nội dung bài. */
  async supportDetails(attemptId: string): Promise<SupportAttemptDetails> {
    const row = await tenantTx(async (db) => {
      const rows = await db
        .select()
        .from(publishAttempts)
        .where(eq(publishAttempts.id, attemptId))
        .limit(1);
      return rows[0] ?? null;
    });
    if (row === null) throw attemptNotFound();
    return {
      attemptId: row.id,
      channelType: row.channel_type,
      rawCode: row.last_raw_code,
      errorCategoryLabel:
        row.last_error_category === null ? null : (CATEGORY_LABEL[row.last_error_category] ?? null),
      traceId: row.trace_id,
      runNo: row.run_no,
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
