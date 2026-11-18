import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, notInArray, sql } from 'drizzle-orm';
import { OAUTH_CONFIG, uuidV7, type OAuthConfig } from '../../../../../core';
import { authTx } from '../../../../../core/db/auth-tx';
import { oauthFlows, type OAuthFlowStage, type OAuthPurpose } from '../../db/schema';
import { hashToken, newToken } from '../tokens';
import { generateOAuthSecrets } from './arctic.providers';
import type { ProviderName } from './identity-provider';

// Máy trạng thái của lượt đăng nhập qua nhà cung cấp (009, data-model mục 3, research R5). Bảng dùng
// chung `account.oauth_flows` – lượt xảy ra TRƯỚC khi biết tenant nên chỉ truy cập qua `authTx`.
// CSDL chỉ giữ SHA-256 của mã cookie, `state` và mã trong thư. Mọi chuyển giai đoạn là cập nhật có
// điều kiện `WHERE id AND stage = <mong đợi> AND expires_at > now()` → hai yêu cầu cùng chuyển thì
// đúng một thành công; 0 dòng = thất bại có chủ đích.

export type FlowRow = typeof oauthFlows.$inferSelect;

export const TERMINAL_STAGES: readonly OAuthFlowStage[] = ['signed_in', 'completed', 'failed'];

/**
 * Sơ đồ chuyển giai đoạn (data-model mục 3). Bổ sung duy nhất so với hình vẽ: `→ failed` từ mọi giai
 * đoạn chưa kết thúc (lượt hỏng, đường quay về lặp lại, tranh chấp khi tạo tài khoản).
 */
const TRANSITIONS: Record<OAuthFlowStage, readonly OAuthFlowStage[]> = {
  started: [
    'signed_in',
    'needs_signup',
    'needs_email',
    'needs_link_confirm',
    'completed',
    'failed',
  ],
  needs_signup: ['completed', 'failed'],
  needs_email: ['awaiting_email', 'failed'],
  needs_link_confirm: ['completed', 'awaiting_email', 'failed'],
  awaiting_email: ['completed', 'failed'],
  signed_in: [],
  completed: [],
  failed: [],
};

/** Cạnh `from → to` có trong sơ đồ không. Hàm thuần. */
export function canTransition(from: OAuthFlowStage, to: OAuthFlowStage): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Giai đoạn kế tiếp hợp lệ (cho kiểm thử và tài liệu). Hàm thuần. */
export function nextStages(from: OAuthFlowStage): readonly OAuthFlowStage[] {
  return TRANSITIONS[from];
}

const MINUTE_MS = 60_000;
/** Thư "hoàn tất đăng ký" tới email MỚI sống 24 giờ (research R5). */
export const SIGNUP_MAIL_TTL_MS = 24 * 60 * MINUTE_MS;

/**
 * Hạn của một giai đoạn (research R5): `started` 10 phút; `needs_*` 30 phút; `awaiting_email` 24 giờ
 * nếu email mới, 30 phút nếu trùng người dùng đã có. Giai đoạn kết thúc không đổi hạn (null).
 */
export function stageTtlMs(
  stage: OAuthFlowStage,
  config: Pick<OAuthConfig, 'flowTtlMinutes' | 'linkConfirmTtlMinutes'>,
  opts: { emailIsNew?: boolean } = {},
): number | null {
  switch (stage) {
    case 'started':
      return config.flowTtlMinutes * MINUTE_MS;
    case 'needs_signup':
    case 'needs_email':
    case 'needs_link_confirm':
      return config.linkConfirmTtlMinutes * MINUTE_MS;
    case 'awaiting_email':
      return opts.emailIsNew === true
        ? SIGNUP_MAIL_TTL_MS
        : config.linkConfirmTtlMinutes * MINUTE_MS;
    default:
      return null;
  }
}

/** Các cột được phép đổi khi chuyển giai đoạn. */
export type FlowPatch = Partial<
  Pick<
    FlowRow,
    | 'provider_subject'
    | 'provider_email'
    | 'provider_email_verified'
    | 'provider_display_name'
    | 'claimed_email'
    | 'claimed_email_normalized'
    | 'display_name'
    | 'target_user_id'
    | 'target_tenant_id'
    | 'password_allowed'
    | 'terms_version'
    | 'terms_accepted_at'
    | 'result_code'
  >
>;

export interface StartedFlow {
  id: string;
  /** Mã cookie `__Host-oauth` (gốc) – chỉ trả về trình duyệt, không lưu. */
  flowToken: string;
  state: string;
  codeVerifier: string | null;
}

@Injectable()
export class OAuthFlowService {
  constructor(@Inject(OAUTH_CONFIG) private readonly config: OAuthConfig) {}

  /** Mở lượt mới ở giai đoạn `started` (hạn 10 phút). */
  async start(input: {
    provider: ProviderName;
    purpose: OAuthPurpose;
    usesPkce: boolean;
    actorUserId?: string | undefined;
    actorTenantId?: string | undefined;
    invitationId?: string | undefined;
    termsVersion?: string | undefined;
  }): Promise<StartedFlow> {
    const secrets = await generateOAuthSecrets();
    const flowToken = newToken();
    const id = uuidV7();
    const codeVerifier = input.usesPkce ? secrets.codeVerifier : null;
    const ttl = this.config.flowTtlMinutes * MINUTE_MS;
    await authTx(async (db) => {
      await db.insert(oauthFlows).values({
        id,
        flow_token_hash: hashToken(flowToken),
        state_hash: hashToken(secrets.state),
        code_verifier: codeVerifier,
        provider: input.provider,
        purpose: input.purpose,
        stage: 'started',
        actor_user_id: input.actorUserId ?? null,
        // `link`/`reauth`: người đang đăng nhập cũng là người dùng đích của lượt.
        target_user_id: input.actorUserId ?? null,
        target_tenant_id: input.actorTenantId ?? null,
        invitation_id: input.invitationId ?? null,
        terms_version: input.termsVersion ?? null,
        terms_accepted_at: input.termsVersion === undefined ? null : new Date(),
        expires_at: new Date(Date.now() + ttl),
      });
    });
    return { id, flowToken, state: secrets.state, codeVerifier };
  }

  /**
   * Đường quay về: khớp cookie + `state`, lượt còn `started` và chưa quá hạn. Thành công thì `state`
   * và `code_verifier` bị tiêu thụ ngay trong cùng câu lệnh (đường quay về lặp lại không khớp nữa).
   * Trả lượt kèm `code_verifier` cũ; null khi không khớp.
   */
  async consumeCallback(
    flowToken: string,
    state: string,
  ): Promise<{ flow: FlowRow; codeVerifier: string | null } | null> {
    return authTx(async (db) => {
      const found = await db
        .select()
        .from(oauthFlows)
        .where(
          and(
            eq(oauthFlows.flow_token_hash, hashToken(flowToken)),
            eq(oauthFlows.state_hash, hashToken(state)),
            eq(oauthFlows.stage, 'started'),
            gt(oauthFlows.expires_at, sql`now()`),
          ),
        )
        .for('update')
        .limit(1);
      const row = found[0];
      if (row === undefined) return null;
      // Băm rỗng không bao giờ bằng SHA-256 của một `state` nào → `state` dùng đúng một lần.
      await db
        .update(oauthFlows)
        .set({ code_verifier: null, state_hash: Buffer.alloc(0) })
        .where(eq(oauthFlows.id, row.id));
      return {
        flow: { ...row, code_verifier: null, state_hash: Buffer.alloc(0) },
        codeVerifier: row.code_verifier,
      };
    });
  }

  /** Tra theo cookie (chỉ bằng băm). Trả cả lượt đã kết thúc/quá hạn – nơi gọi tự quyết. */
  async findByCookie(flowToken: string): Promise<FlowRow | undefined> {
    return authTx(async (db) => {
      const rows = await db
        .select()
        .from(oauthFlows)
        .where(eq(oauthFlows.flow_token_hash, hashToken(flowToken)))
        .limit(1);
      return rows[0];
    });
  }

  /** Tra theo mã trong thư (chỉ bằng băm): chỉ lượt đang `awaiting_email` và chưa quá hạn. */
  async findByMailToken(mailToken: string): Promise<FlowRow | undefined> {
    return authTx(async (db) => {
      const rows = await db
        .select()
        .from(oauthFlows)
        .where(
          and(
            eq(oauthFlows.mail_token_hash, hashToken(mailToken)),
            eq(oauthFlows.stage, 'awaiting_email'),
            gt(oauthFlows.expires_at, sql`now()`),
          ),
        )
        .limit(1);
      return rows[0];
    });
  }

  /**
   * Chuyển giai đoạn bằng cập nhật có điều kiện. Cạnh không có trong sơ đồ → lỗi lập trình (ném).
   * Trả `false` khi lượt không còn ở `from` hoặc đã quá hạn. `ttlMs` đặt hạn mới cho giai đoạn `to`.
   */
  async transition(
    id: string,
    from: OAuthFlowStage,
    to: OAuthFlowStage,
    patch: FlowPatch = {},
    ttlMs?: number,
  ): Promise<boolean> {
    if (!canTransition(from, to)) {
      throw new Error(`Chuyển giai đoạn không có trong sơ đồ: ${from} → ${to}`);
    }
    const terminal = TERMINAL_STAGES.includes(to);
    return authTx(async (db) => {
      const rows = await db
        .update(oauthFlows)
        .set({
          ...patch,
          stage: to,
          ...(ttlMs !== undefined ? { expires_at: new Date(Date.now() + ttlMs) } : {}),
          // Lượt kết thúc: bỏ mọi thứ còn dùng để tiếp tục được.
          ...(terminal
            ? { closed_at: sql`now()`, mail_token_hash: null, code_verifier: null }
            : {}),
        })
        .where(
          and(
            eq(oauthFlows.id, id),
            eq(oauthFlows.stage, from),
            gt(oauthFlows.expires_at, sql`now()`),
          ),
        )
        .returning({ id: oauthFlows.id });
      return rows.length === 1;
    });
  }

  /**
   * Phát mã mới cho liên kết trong thư (lượt đang `awaiting_email`); mã cũ hết tra được. Trả mã gốc,
   * hoặc null khi lượt không còn chờ thư.
   */
  async issueMailToken(id: string, ttlMs: number): Promise<string | null> {
    const token = newToken();
    const updated = await authTx(async (db) => {
      const rows = await db
        .update(oauthFlows)
        .set({ mail_token_hash: hashToken(token), expires_at: new Date(Date.now() + ttlMs) })
        .where(
          and(
            eq(oauthFlows.id, id),
            eq(oauthFlows.stage, 'awaiting_email'),
            gt(oauthFlows.expires_at, sql`now()`),
          ),
        )
        .returning({ id: oauthFlows.id });
      return rows.length === 1;
    });
    return updated ? token : null;
  }

  /** Đóng lượt với mã kết quả cho web. Lượt đã kết thúc thì không đổi gì (trả false). */
  async fail(id: string, resultCode: string): Promise<boolean> {
    return authTx(async (db) => {
      const rows = await db
        .update(oauthFlows)
        .set({
          stage: 'failed',
          result_code: resultCode,
          closed_at: sql`now()`,
          mail_token_hash: null,
          code_verifier: null,
        })
        .where(and(eq(oauthFlows.id, id), notInArray(oauthFlows.stage, [...TERMINAL_STAGES])))
        .returning({ id: oauthFlows.id });
      return rows.length === 1;
    });
  }
}
