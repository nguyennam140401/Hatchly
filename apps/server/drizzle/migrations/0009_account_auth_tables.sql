CREATE TABLE "account"."auth_throttle" (
	"kind" text NOT NULL,
	"key_hash" "bytea" NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	"blocked_until" timestamp with time zone,
	CONSTRAINT "auth_throttle_pkey" PRIMARY KEY("kind","key_hash"),
	CONSTRAINT "auth_throttle_kind_check" CHECK (kind IN ('login_email', 'login_ip', 'mail_reset', 'mail_verify', 'register_ip'))
);
--> statement-breakpoint
CREATE TABLE "account"."auth_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"email_normalized" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "auth_tokens_purpose_check" CHECK ("account"."auth_tokens"."purpose" IN ('verify_email', 'reset_password'))
);
--> statement-breakpoint
ALTER TABLE "account"."auth_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "account"."login_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"password_hash" text,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "login_identities_account_user_provider_key" UNIQUE("account_id","user_id","provider"),
	CONSTRAINT "login_identities_provider_check" CHECK ("account"."login_identities"."provider" IN ('password', 'google', 'facebook')),
	CONSTRAINT "login_identities_password_hash_check" CHECK (("account"."login_identities"."provider" = 'password') = ("account"."login_identities"."password_hash" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "account"."login_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "account"."memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"seat" smallint NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"added_by_user_id" uuid,
	CONSTRAINT "memberships_account_user_key" UNIQUE("account_id","user_id"),
	CONSTRAINT "memberships_role_check" CHECK ("account"."memberships"."role" IN ('owner', 'collaborator')),
	CONSTRAINT "memberships_status_check" CHECK ("account"."memberships"."status" IN ('active', 'removed', 'disabled')),
	CONSTRAINT "memberships_seat_range" CHECK ("account"."memberships"."seat" BETWEEN 0 AND 2),
	CONSTRAINT "memberships_owner_seat" CHECK (("account"."memberships"."role" = 'owner') = ("account"."memberships"."seat" = 0)),
	CONSTRAINT "memberships_owner_active" CHECK ("account"."memberships"."role" <> 'owner' OR "account"."memberships"."status" = 'active')
);
--> statement-breakpoint
ALTER TABLE "account"."memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "account"."sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"user_agent_summary" text,
	CONSTRAINT "sessions_revoke_reason_check" CHECK (revoke_reason IS NULL OR revoke_reason IN ('logout', 'logout_all', 'password_changed', 'password_reset', 'email_verified', 'member_removed', 'user_disabled')),
	CONSTRAINT "sessions_user_agent_summary_length" CHECK ("account"."sessions"."user_agent_summary" IS NULL OR char_length("account"."sessions"."user_agent_summary") <= 60)
);
--> statement-breakpoint
ALTER TABLE "account"."sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "account"."staff_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"user_agent_summary" text,
	"assurance" text DEFAULT 'password' NOT NULL,
	"ip" "inet",
	CONSTRAINT "staff_sessions_revoke_reason_check" CHECK ("account"."staff_sessions"."revoke_reason" IS NULL OR "account"."staff_sessions"."revoke_reason" IN ('logout', 'staff_disabled', 'password_reset')),
	CONSTRAINT "staff_sessions_user_agent_summary_length" CHECK ("account"."staff_sessions"."user_agent_summary" IS NULL OR char_length("account"."staff_sessions"."user_agent_summary") <= 60)
);
--> statement-breakpoint
CREATE TABLE "account"."staff_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email_normalized" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"password_changed_at" timestamp with time zone,
	CONSTRAINT "staff_users_role_check" CHECK ("account"."staff_users"."role" IN ('support', 'admin')),
	CONSTRAINT "staff_users_status_check" CHECK ("account"."staff_users"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "account"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"terms_version" text NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"password_changed_at" timestamp with time zone,
	CONSTRAINT "users_account_id_id_key" UNIQUE("account_id","id"),
	CONSTRAINT "users_status_check" CHECK ("account"."users"."status" IN ('active', 'disabled')),
	CONSTRAINT "users_display_name_length" CHECK (char_length("account"."users"."display_name") BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE "account"."users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account"."auth_tokens" ADD CONSTRAINT "auth_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."login_identities" ADD CONSTRAINT "login_identities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."login_identities" ADD CONSTRAINT "login_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."memberships" ADD CONSTRAINT "memberships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."staff_sessions" ADD CONSTRAINT "staff_sessions_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "account"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."users" ADD CONSTRAINT "users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_tokens_account_id_idx" ON "account"."auth_tokens" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "account"."auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_account_user_purpose_idx" ON "account"."auth_tokens" USING btree ("account_id","user_id","purpose") WHERE used_at IS NULL;--> statement-breakpoint
CREATE INDEX "login_identities_account_id_idx" ON "account"."login_identities" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "login_identities_provider_subject_key" ON "account"."login_identities" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE INDEX "memberships_account_id_idx" ON "account"."memberships" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_account_seat_active_key" ON "account"."memberships" USING btree ("account_id","seat") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "sessions_account_id_idx" ON "account"."sessions" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "account"."sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_account_user_active_idx" ON "account"."sessions" USING btree ("account_id","user_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_sessions_token_hash_key" ON "account"."staff_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "staff_sessions_staff_user_active_idx" ON "account"."staff_sessions" USING btree ("staff_user_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_users_email_normalized_key" ON "account"."staff_users" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "users_account_id_idx" ON "account"."users" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_key" ON "account"."users" USING btree ("email_normalized");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "account"."auth_tokens" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "account"."login_identities" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "account"."memberships" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "account"."sessions" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "account"."users" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());