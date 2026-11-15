-- Migration 0015 (009, data-model.md mục 1–3, 8) – sinh bằng drizzle-kit, chỉnh tay hai điểm:
--   1. Ràng buộc CHECK trên bảng có sẵn thêm bằng NOT VALID rồi VALIDATE CONSTRAINT (không khóa bảng
--      lâu để quét – quy tắc add-constraint-validating của db:lint-migrations).
--   2. Chú thích cho DROP CONSTRAINT của khóa ngoại memberships.user_id → users.id.
-- Chỉ thêm (cột NULL, bảng, chỉ mục, mở rộng tập giá trị của CHECK), ngoại trừ MỘT khóa ngoại bị bỏ:
-- bản API/Worker cũ không dựa vào ràng buộc đó nên vẫn chạy song song được khi phát hành.
CREATE TABLE "account"."former_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_by_user_id" uuid NOT NULL,
	CONSTRAINT "former_members_account_user_key" UNIQUE("account_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "account"."former_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "account"."invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"role" text DEFAULT 'collaborator' NOT NULL,
	"seat" smallint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"account_label" text,
	"last_sent_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_user_id" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "invitations_role_check" CHECK ("account"."invitations"."role" = 'collaborator'),
	CONSTRAINT "invitations_seat_range" CHECK ("account"."invitations"."seat" BETWEEN 1 AND 2),
	CONSTRAINT "invitations_status_check" CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired')),
	CONSTRAINT "invitations_account_label_length" CHECK ("account"."invitations"."account_label" IS NULL OR char_length("account"."invitations"."account_label") <= 120)
);
--> statement-breakpoint
ALTER TABLE "account"."invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "account"."meta_deletion_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"confirmation_code" text NOT NULL,
	"kind" text NOT NULL,
	"subject_hmac" "bytea" NOT NULL,
	"status" text DEFAULT 'no_data' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_deletion_requests_kind_subject_key" UNIQUE("kind","subject_hmac"),
	CONSTRAINT "meta_deletion_requests_kind_check" CHECK ("account"."meta_deletion_requests"."kind" IN ('deauthorize', 'data_deletion')),
	CONSTRAINT "meta_deletion_requests_status_check" CHECK ("account"."meta_deletion_requests"."status" IN ('completed', 'no_data'))
);
--> statement-breakpoint
CREATE TABLE "account"."oauth_flows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"flow_token_hash" "bytea" NOT NULL,
	"state_hash" "bytea" NOT NULL,
	"code_verifier" text,
	"provider" text NOT NULL,
	"purpose" text NOT NULL,
	"stage" text DEFAULT 'started' NOT NULL,
	"actor_user_id" uuid,
	"invitation_id" uuid,
	"terms_version" text,
	"terms_accepted_at" timestamp with time zone,
	"provider_subject" text,
	"provider_email" text,
	"provider_email_verified" boolean DEFAULT false NOT NULL,
	"provider_display_name" text,
	"claimed_email" text,
	"claimed_email_normalized" text,
	"display_name" text,
	"target_user_id" uuid,
	"target_tenant_id" uuid,
	"password_allowed" boolean DEFAULT false NOT NULL,
	"mail_token_hash" "bytea",
	"result_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "oauth_flows_provider_check" CHECK (provider IN ('google', 'facebook')),
	CONSTRAINT "oauth_flows_purpose_check" CHECK (purpose IN ('login', 'link', 'reauth', 'invite')),
	CONSTRAINT "oauth_flows_stage_check" CHECK (stage IN ('started', 'signed_in', 'needs_signup', 'needs_email', 'needs_link_confirm', 'awaiting_email', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "account"."accounts" DROP CONSTRAINT "accounts_status_check";--> statement-breakpoint
ALTER TABLE "account"."auth_throttle" DROP CONSTRAINT "auth_throttle_kind_check";--> statement-breakpoint
ALTER TABLE "account"."sessions" DROP CONSTRAINT "sessions_revoke_reason_check";--> statement-breakpoint
-- Bỏ khóa ngoại memberships.user_id → users.id (ON DELETE CASCADE). Sau khi gỡ cộng tác viên, dòng users
-- chuyển sang tài khoản chờ còn dòng memberships 'removed' ở lại tài khoản cũ; giữ khóa ngoại thì việc
-- xóa người dùng sau 90 ngày sẽ xóa dây chuyền dòng này ở TENANT KHÁC, mất dấu truy vết. user_id vẫn
-- NOT NULL và thành mã tham chiếu; dòng của tài khoản vẫn bị xóa theo tài khoản (khóa ngoại account_id).
ALTER TABLE "account"."memberships" DROP CONSTRAINT "memberships_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "account"."login_identities" ADD COLUMN "provider_email" text;--> statement-breakpoint
ALTER TABLE "account"."login_identities" ADD COLUMN "provider_display_name" text;--> statement-breakpoint
ALTER TABLE "account"."sessions" ADD COLUMN "reauthenticated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account"."users" ADD COLUMN "detached_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account"."users" ADD COLUMN "deletion_notice_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account"."former_members" ADD CONSTRAINT "former_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."invitations" ADD CONSTRAINT "invitations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "former_members_account_id_idx" ON "account"."former_members" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "invitations_account_id_idx" ON "account"."invitations" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_account_seat_pending_key" ON "account"."invitations" USING btree ("account_id","seat") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_account_email_pending_key" ON "account"."invitations" USING btree ("account_id","email_normalized") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "account"."invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_email_pending_idx" ON "account"."invitations" USING btree ("email_normalized") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "meta_deletion_requests_confirmation_code_key" ON "account"."meta_deletion_requests" USING btree ("confirmation_code");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_flows_flow_token_hash_key" ON "account"."oauth_flows" USING btree ("flow_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_flows_mail_token_hash_key" ON "account"."oauth_flows" USING btree ("mail_token_hash");--> statement-breakpoint
CREATE INDEX "oauth_flows_expires_at_idx" ON "account"."oauth_flows" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "account"."accounts" ADD CONSTRAINT "accounts_status_check" CHECK (status IN ('active', 'suspended', 'expired', 'deleting', 'unclaimed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "account"."accounts" VALIDATE CONSTRAINT "accounts_status_check";--> statement-breakpoint
ALTER TABLE "account"."auth_throttle" ADD CONSTRAINT "auth_throttle_kind_check" CHECK (kind IN ('login_email', 'login_ip', 'mail_reset', 'mail_verify', 'register_ip', 'mail_invite', 'invite_account', 'mail_link_confirm', 'oauth_start_ip')) NOT VALID;--> statement-breakpoint
ALTER TABLE "account"."auth_throttle" VALIDATE CONSTRAINT "auth_throttle_kind_check";--> statement-breakpoint
ALTER TABLE "account"."login_identities" ADD CONSTRAINT "login_identities_provider_profile_check" CHECK ("account"."login_identities"."provider" <> 'password' OR ("account"."login_identities"."provider_email" IS NULL AND "account"."login_identities"."provider_display_name" IS NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "account"."login_identities" VALIDATE CONSTRAINT "login_identities_provider_profile_check";--> statement-breakpoint
ALTER TABLE "account"."sessions" ADD CONSTRAINT "sessions_revoke_reason_check" CHECK (revoke_reason IS NULL OR revoke_reason IN ('logout', 'logout_all', 'password_changed', 'password_reset', 'email_verified', 'member_removed', 'user_disabled', 'identity_link_reset', 'account_joined', 'account_claimed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "account"."sessions" VALIDATE CONSTRAINT "sessions_revoke_reason_check";--> statement-breakpoint
ALTER TABLE "account"."users" ADD CONSTRAINT "users_deletion_notice_check" CHECK ("account"."users"."deletion_notice_sent_at" IS NULL OR "account"."users"."detached_at" IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "account"."users" VALIDATE CONSTRAINT "users_deletion_notice_check";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "account"."former_members" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "account"."invitations" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());