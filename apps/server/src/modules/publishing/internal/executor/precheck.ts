// Bước 1 – Kiểm tra trước (FR-013, FR-009). Không đạt → lỗi đã phân loại, KHÔNG gọi bước gửi.
// Kiểm: tài khoản không bị xóa và gói còn hiệu lực; lượt không quá giờ hẹn (chỉ khi bắt đầu từ `scheduled`);
// bài còn `approved` đúng phiên bản đã duyệt; kênh còn kết nối và quyền còn hạn; `checkAccount` (vd Instagram
// chuyên nghiệp); kênh bắt buộc media thì bài phải có media.
import { tenantTx } from '../../../../core';
import type { ChannelType } from '../../../platform_gateway';
import type { PostRecord, VariantRecord } from '../../../content';
import { finishStep, skipRemaining, startStep } from '../step-log';
import { isTooLate } from '../retry-policy';
import { sql } from 'drizzle-orm';
import { applyFailure, toCancelled, toFailure, userFailure, type StepFailure } from './outcomes';
import { cont, stop, type ExecutorDeps, type Flow, type RunContext } from './types';

export interface PrecheckValue {
  post: PostRecord;
  variant: VariantRecord;
  text: string;
  channelType: ChannelType;
}

const RECONNECT = { action: 'reconnect', labelVi: 'Kết nối lại kênh' };
const CHANGE_TIME = { action: 'retry_later', labelVi: 'Chọn giờ đăng khác' };

/** Văn bản đăng của kênh: nội dung riêng nếu đã tùy chỉnh, không thì nội dung chung. */
export function publishText(post: PostRecord, variant: VariantRecord): string {
  return variant.customized ? variant.text : post.sharedText;
}

async function dbNow(): Promise<Date> {
  const rows = await tenantTx((db) => db.execute<{ now: Date }>(sql`SELECT now() AS now`));
  const first = rows.rows[0];
  return first === undefined ? new Date() : new Date(first.now);
}

export async function precheck(deps: ExecutorDeps, run: RunContext): Promise<Flow<PrecheckValue>> {
  const { attempt } = run;
  await startStep(run.step, 'precheck');

  const fail = async (failure: StepFailure) =>
    stop(await applyFailure(deps, run, 'precheck', failure, false));

  // 1. Tài khoản / gói.
  const eligibility = await deps.account.getPublishingEligibility();
  if (eligibility.deletionRequested) {
    await finishStep(run.step, 'precheck', 'skipped', {
      note: 'Tài khoản đang được xóa nên không đăng nữa',
    });
    await skipRemaining(run.step, 'precheck');
    return stop(await toCancelled(run));
  }
  if (!eligibility.planActive) {
    return fail(
      userFailure(
        'plan_expired',
        'Gói dịch vụ đã hết hạn nên chưa đăng được bài. Hãy gia hạn gói rồi bấm "Đăng lại".',
        [{ action: 'contact_support', labelVi: 'Gia hạn gói dịch vụ' }],
        'PLAN_EXPIRED',
      ),
    );
  }

  // 2. Quá giờ hẹn (chỉ lần bắt đầu đầu tiên từ `scheduled`; thử lại/đối soát không qua đây).
  if (run.startedFromScheduled && isTooLate(attempt.scheduled_at, await dbNow(), deps.settings)) {
    return fail(
      userFailure(
        'overdue',
        'Bài đã quá giờ hẹn nên chưa được đăng. Hãy bấm "Đăng lại" nếu vẫn muốn đăng, hoặc chọn giờ khác.',
        [
          { action: 'retry_later', labelVi: 'Đăng lại' },
          { action: 'retry_later', labelVi: 'Chọn giờ đăng khác' },
        ],
        'OVERDUE',
      ),
    );
  }

  // 3. Nội dung đã duyệt còn đúng phiên bản (US1-6): bài bị hủy/sửa sau khi lên lịch → không đăng nội dung cũ.
  const post = await deps.content.getPost(attempt.post_id);
  const variant = post?.variants.find((v) => v.connectionId === attempt.channel_connection_id);
  if (
    post === null ||
    variant === undefined ||
    post.status !== 'approved' ||
    post.version !== attempt.content_version
  ) {
    await finishStep(run.step, 'precheck', 'skipped', {
      note: 'Bài đã bị hủy hoặc sửa sau khi lên lịch nên không đăng nữa',
    });
    await skipRemaining(run.step, 'precheck');
    return stop(await toCancelled(run));
  }

  // 4. Kênh còn kết nối, quyền còn hạn.
  const connection = await deps.gateway.getConnection(attempt.channel_connection_id);
  if (connection === null || connection.status === 'disconnected') {
    return fail(
      userFailure(
        'token_expired',
        'Kênh này đã bị ngắt kết nối nên chưa đăng được. Hãy kết nối lại kênh.',
        [RECONNECT],
        'CHANNEL_DISCONNECTED',
      ),
    );
  }
  if (connection.status === 'expired') {
    return fail(
      userFailure(
        'token_expired',
        'Quyền đăng bài của kênh đã hết hạn. Hãy kết nối lại kênh để tiếp tục đăng.',
        [RECONNECT],
        'TOKEN_EXPIRED',
      ),
    );
  }

  // 5. Tài khoản kênh đủ điều kiện (vd Instagram chuyên nghiệp) + hạn mức nền tảng báo.
  let check;
  try {
    check = await deps.gateway.checkAccount(attempt.channel_connection_id);
  } catch {
    // Chưa gửi gì lên nền tảng nên thử lại là an toàn.
    return fail({
      category: 'transient',
      rawCode: 'CHECK_ACCOUNT_UNAVAILABLE',
      messageVi: 'Chưa kiểm tra được kênh vì nền tảng chưa phản hồi. Hệ thống sẽ tự thử lại.',
      remedies: [{ action: 'retry_later', labelVi: 'Chờ hệ thống tự thử lại' }],
      needsReason: null,
    });
  }
  if (check.kind === 'ineligible') return fail(toFailure(await deps.errorMapping.map(check.error)));
  if (check.quotaRemaining !== null && check.quotaRemaining <= 0) {
    return fail(
      userFailure(
        'rate_limited_daily',
        'Kênh đã hết lượt đăng hôm nay. Hãy chọn giờ đăng khác.',
        [CHANGE_TIME],
        'QUOTA_EXHAUSTED',
      ),
    );
  }

  // 6. Quy tắc kênh: bắt buộc có media (Instagram).
  const channelType = attempt.channel_type as ChannelType;
  const rules = (await deps.content.channelRules()).find((r) => r.channelType === channelType);
  if (rules?.mediaRequired === true && variant.media.length === 0) {
    return fail(
      userFailure(
        'media_invalid',
        'Kênh này cần ít nhất một ảnh hoặc video. Hãy thêm ảnh/video vào bài rồi đăng lại.',
        [{ action: 'edit_media', labelVi: 'Thêm ảnh hoặc video' }],
        'MEDIA_REQUIRED',
      ),
    );
  }

  await finishStep(run.step, 'precheck', 'succeeded');
  return cont({ post, variant, text: publishText(post, variant), channelType });
}
