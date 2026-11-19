import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  getExecutionContext,
  requireStaff,
  StaffAccess,
  ValidParam,
  ValidQuery,
} from '../../../../core';
import { auditLog } from '../../../../core/db/audit-log.log-table';
import { supportViewAccount } from '../../../../core/db/support';

// Nhân viên hỗ trợ xem kênh của MỘT khách hàng (FR-030, nguyên tắc I/VII): chỉ qua khung nhìn
// `platform_gateway.support_channel_view` (KHÔNG có cột `*_ciphertext`, `granted_scopes`). Mã tài khoản lấy từ
// đường dẫn là ngoại lệ có chủ đích của hỗ trợ; bắt buộc kèm lý do. Mỗi lần xem ghi `support.view_account`
// (qua supportViewAccount) và `support.view_channel` – cùng giao dịch với việc đọc.

const accountParam = z.strictObject({ accountId: z.uuid() });
const reasonQuery = z.strictObject({ reason: z.string().min(5).max(500) });

export interface StaffChannelItem {
  connectionId: string;
  channelType: string;
  displayName: string;
  state: string;
  tokenExpiresAt: string | null;
  expiryKind: string | null;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  connectedAt: string;
}

const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : typeof v === 'string' ? new Date(v).toISOString() : null;

@Controller('staff/accounts/:accountId/channels')
export class StaffChannelsController {
  @Get()
  @StaffAccess('support.lookup')
  async list(
    @ValidParam(accountParam) params: z.infer<typeof accountParam>,
    @ValidQuery(reasonQuery) query: z.infer<typeof reasonQuery>,
  ): Promise<{ channels: StaffChannelItem[] }> {
    const staff = requireStaff();
    const rows = await supportViewAccount(
      { staffId: staff.staffId },
      params.accountId,
      query.reason,
      async (db) => {
        await db.insert(auditLog).values({
          account_id: params.accountId,
          actor_type: 'support',
          actor_id: staff.staffId,
          action: 'support.view_channel',
          trace_id: getExecutionContext()?.traceId ?? null,
        });
        return (
          await db.execute(
            sql`SELECT id, channel_type, display_name, state, token_expires_at, expiry_kind,
                       last_checked_at, last_error_code, connected_at
                  FROM platform_gateway.support_channel_view
                 ORDER BY connected_at`,
          )
        ).rows;
      },
    );
    return {
      channels: rows.map((r) => ({
        connectionId: String(r.id),
        channelType: String(r.channel_type),
        displayName: String(r.display_name),
        state: String(r.state),
        tokenExpiresAt: iso(r.token_expires_at),
        expiryKind: typeof r.expiry_kind === 'string' ? r.expiry_kind : null,
        lastCheckedAt: iso(r.last_checked_at),
        lastErrorCode: typeof r.last_error_code === 'string' ? r.last_error_code : null,
        connectedAt: iso(r.connected_at) ?? '',
      })),
    };
  }
}
