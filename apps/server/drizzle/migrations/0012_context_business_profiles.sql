CREATE TABLE "context"."business_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "context"."business_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "context"."profile_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"profile_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"industry_code" text NOT NULL,
	"industry_other" text,
	"introduction" text NOT NULL,
	"products" text,
	"policies" text,
	"tone" text,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"saved_by_user_id" uuid NOT NULL,
	CONSTRAINT "profile_versions_version_number_check" CHECK ("context"."profile_versions"."version_number" >= 1),
	CONSTRAINT "profile_versions_industry_code_length" CHECK (char_length("context"."profile_versions"."industry_code") BETWEEN 1 AND 50),
	CONSTRAINT "profile_versions_industry_other_length" CHECK ("context"."profile_versions"."industry_other" IS NULL OR char_length("context"."profile_versions"."industry_other") <= 100),
	CONSTRAINT "profile_versions_industry_other_when_other" CHECK (("context"."profile_versions"."industry_code" = 'other') = ("context"."profile_versions"."industry_other" IS NOT NULL)),
	CONSTRAINT "profile_versions_introduction_length" CHECK (char_length("context"."profile_versions"."introduction") BETWEEN 1 AND 2000),
	CONSTRAINT "profile_versions_products_length" CHECK ("context"."profile_versions"."products" IS NULL OR char_length("context"."profile_versions"."products") <= 5000),
	CONSTRAINT "profile_versions_policies_length" CHECK ("context"."profile_versions"."policies" IS NULL OR char_length("context"."profile_versions"."policies") <= 5000),
	CONSTRAINT "profile_versions_tone_length" CHECK ("context"."profile_versions"."tone" IS NULL OR char_length("context"."profile_versions"."tone") <= 500),
	CONSTRAINT "profile_versions_keywords_count" CHECK (cardinality("context"."profile_versions"."keywords") <= 20)
);
--> statement-breakpoint
ALTER TABLE "context"."profile_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "context"."business_profiles" ADD CONSTRAINT "business_profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context"."profile_versions" ADD CONSTRAINT "profile_versions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context"."profile_versions" ADD CONSTRAINT "profile_versions_profile_id_business_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "context"."business_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_profiles_account_id_idx" ON "context"."business_profiles" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_profiles_account_id_key" ON "context"."business_profiles" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "profile_versions_account_id_idx" ON "context"."profile_versions" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_versions_account_profile_version_key" ON "context"."profile_versions" USING btree ("account_id","profile_id","version_number");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "context"."business_profiles" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "context"."profile_versions" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());