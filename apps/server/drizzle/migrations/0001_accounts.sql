CREATE TABLE "account"."accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "accounts_status_check" CHECK (status IN ('active', 'suspended', 'expired', 'deleting'))
);
--> statement-breakpoint
ALTER TABLE "account"."accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "account"."accounts" AS PERMISSIVE FOR ALL TO "app", "system" USING (id = account.current_account_id()) WITH CHECK (id = account.current_account_id());