-- Migration dev 0000 (FR-017, data-model mục 8) – CHỈ áp khi APP_ENV ∈ {development, test}.
-- Phần sinh bởi drizzle-kit (bảng + RLS) nằm giữa hai phần viết tay (schema, quyền).
CREATE SCHEMA IF NOT EXISTS sandbox AUTHORIZATION "owner";
--> statement-breakpoint
CREATE TABLE "sandbox"."tenant_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"secret_note" text,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "tenant_notes_cost_micro_usd_non_negative" CHECK ("cost_micro_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sandbox"."tenant_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sandbox"."tenant_notes" ADD CONSTRAINT "tenant_notes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_notes_account_id_idx" ON "sandbox"."tenant_notes" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "tenant_notes_account_id_status_idx" ON "sandbox"."tenant_notes" USING btree ("account_id","status");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sandbox"."tenant_notes" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());
--> statement-breakpoint
GRANT USAGE ON SCHEMA sandbox TO "app", "system", "support";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON sandbox.tenant_notes TO "app", "system";
