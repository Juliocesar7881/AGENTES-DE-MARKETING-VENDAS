ALTER TABLE "workspaces" ADD COLUMN "posting_mode" text DEFAULT 'smart' NOT NULL;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "publish_asap" boolean DEFAULT false NOT NULL;