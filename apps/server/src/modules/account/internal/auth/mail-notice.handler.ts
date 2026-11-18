import { eq, inArray } from 'drizzle-orm';
import { tenantTx, type Mailer } from '../../../../core';
import {
  retryAfter,
  PermanentJobError,
  type JobContext,
  type JobHandlerResult,
} from '../../../queue';
import { accounts } from '../../../../core/db/tenant-root';
import type { MailNoticeTemplate } from '../../jobs';
import { users } from '../db/schema';
import { renderTemplate, type NoticeTemplateName, type TemplateVars } from './mail/templates';

// Bộ xử lý việc `account.mail_notice` (009, contracts/module-api.md mục 4) – chạy ở Worker, trong ngữ
// cảnh tài khoản của việc. Dữ liệu việc chỉ có mã tham chiếu: người nhận được tra TRONG tenant (RLS) –
// không thấy hoặc bị khóa → bỏ qua (thành công). Chạy lại an toàn: việc được tạo với khóa chống trùng
// nên mỗi sự kiện có đúng một việc; lỗi tạm thời của bộ gửi thư → thử lại theo hàng chờ.

const TEMPLATE_NAMES: Record<MailNoticeTemplate, NoticeTemplateName> = {
  identity_added: 'identityAdded',
  identity_removed: 'identityRemoved',
  identity_removed_by_provider: 'identityRemovedByProvider',
  identity_link_blocked: 'identityLinkBlocked',
  invite_accepted: 'inviteAccepted',
  detached_deletion_notice: 'detachedDeletionNotice',
};

export interface MailNoticePayload {
  template: MailNoticeTemplate;
  userId: string;
  subjectUserId?: string | undefined;
  provider?: 'password' | 'google' | 'facebook' | undefined;
}

export interface MailNoticeLog {
  info(entry: Record<string, unknown> & { msg: string; event: string }): void;
}

const DAY_MS = 86_400_000;

export function createMailNoticeHandler(deps: {
  mailer: Pick<Mailer, 'deliver'>;
  /** Địa chỉ web (không có `/` cuối); thiếu → việc hỏng vĩnh viễn (lỗi cấu hình). */
  webBaseUrl: string | undefined;
  detachedRetentionDays: number;
  log: MailNoticeLog;
}): (payload: MailNoticePayload, ctx: JobContext) => Promise<JobHandlerResult> {
  return async (payload, ctx) => {
    const base = deps.webBaseUrl;
    if (base === undefined) throw new PermanentJobError('WEB_BASE_URL_MISSING');
    const skip = (reason: string): undefined => {
      // Chỉ mã tham chiếu – không email, không tên (FR-030).
      deps.log.info({
        msg: 'account.mail_notice.skipped',
        event: 'account.mail_notice.skipped',
        job_id: ctx.jobId,
        template: payload.template,
        reason,
        trace_id: ctx.traceId,
      });
      return undefined;
    };

    const loaded = await tenantTx(async (db) => {
      const ids = [payload.userId, ...(payload.subjectUserId ? [payload.subjectUserId] : [])];
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.display_name,
          status: users.status,
          detachedAt: users.detached_at,
        })
        .from(users)
        .where(inArray(users.id, ids));
      const account = await db
        .select({ status: accounts.status })
        .from(accounts)
        .where(eq(accounts.id, ctx.accountId ?? ''))
        .limit(1);
      return { rows, accountStatus: account[0]?.status };
    });
    const recipient = loaded.rows.find((r) => r.id === payload.userId);
    if (recipient === undefined) {
      skip('recipient_missing');
      return;
    }
    if (recipient.status !== 'active') {
      skip('recipient_disabled');
      return;
    }

    const vars: TemplateVars = {
      webBaseUrl: base,
      displayName: recipient.displayName,
      method: payload.provider,
    };
    if (payload.template === 'invite_accepted') {
      vars.subjectName = loaded.rows.find((r) => r.id === payload.subjectUserId)?.displayName;
    }
    if (payload.template === 'detached_deletion_notice') {
      // Người đã nhận tài khoản / tham gia lại trước khi việc chạy → không còn gì để báo.
      if (recipient.detachedAt === null || loaded.accountStatus !== 'unclaimed') {
        skip('no_longer_detached');
        return;
      }
      vars.date = new Date(recipient.detachedAt.getTime() + deps.detachedRetentionDays * DAY_MS);
    }

    const content = renderTemplate(TEMPLATE_NAMES[payload.template], vars);
    const result = await deps.mailer.deliver({ to: recipient.email, ...content });
    if (result.kind === 'transient') return retryAfter(60);
    if (result.kind === 'permanent') throw new PermanentJobError(`MAIL_${result.code}`);
    deps.log.info({
      msg: 'account.mail_notice.sent',
      event: 'account.mail_notice.sent',
      job_id: ctx.jobId,
      template: payload.template,
      user_id: recipient.id,
      trace_id: ctx.traceId,
    });
    return undefined;
  };
}
