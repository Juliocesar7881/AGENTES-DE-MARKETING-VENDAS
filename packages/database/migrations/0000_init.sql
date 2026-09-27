CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "integration_credentials_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"integration_id" uuid,
	"social_account_id" uuid,
	"credential_type" text NOT NULL,
	"secret_id" uuid NOT NULL,
	"last4" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"key" text NOT NULL,
	"status" text DEFAULT 'NOT_CONFIGURED' NOT NULL,
	"mode" text DEFAULT 'LIVE' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_tested_at" timestamp with time zone,
	"test_result" jsonb,
	"action_required" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_ws_key_uq" UNIQUE NULLS NOT DISTINCT("workspace_id","key")
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_hash" text NOT NULL,
	"workspace_id" uuid,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"sealed" jsonb,
	"redirect_to" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_states_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"avatar_url" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"locale" text DEFAULT 'pt-BR' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"tag" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"machine" text DEFAULT '' NOT NULL,
	"platform" text DEFAULT '' NOT NULL,
	"version" text DEFAULT '0.0.0' NOT NULL,
	"status" text DEFAULT 'ONLINE' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"health" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_jobs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"local_ui_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'OWNER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"industry" text DEFAULT '' NOT NULL,
	"website" text,
	"description" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '#2EE6A6' NOT NULL,
	"environment" text DEFAULT 'LIVE' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"operating_mode" text DEFAULT 'ASSISTED' NOT NULL,
	"autopilot_enabled" boolean DEFAULT false NOT NULL,
	"autopilot_permissions" jsonb NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"posts_per_day" integer DEFAULT 2 NOT NULL,
	"posting_schedule" jsonb DEFAULT '["09:00","18:00"]'::jsonb NOT NULL,
	"target_ready_buffer" integer DEFAULT 4 NOT NULL,
	"max_content_generated_per_day" integer DEFAULT 4 NOT NULL,
	"max_content_published_per_day" integer DEFAULT 2 NOT NULL,
	"target_platforms" jsonb DEFAULT '["INSTAGRAM","TIKTOK","YOUTUBE"]'::jsonb NOT NULL,
	"daily_ai_budget_usd" numeric(12, 4),
	"monthly_ai_budget_usd" numeric(12, 4),
	"sales_settings" jsonb NOT NULL,
	"retention" jsonb NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"locale" text DEFAULT 'pt-BR' NOT NULL,
	"whatsapp_number" text,
	"last_performance_review_at" timestamp with time zone,
	"last_weekly_strategy_at" timestamp with time zone,
	"weekly_strategy" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "agent_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"slot" text NOT NULL,
	"model" text NOT NULL,
	"effort" text DEFAULT 'default' NOT NULL,
	"max_tokens" integer DEFAULT 8000 NOT NULL,
	"prompt_version" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_configs_ws_slot_uq" UNIQUE NULLS NOT DISTINCT("workspace_id","slot")
);
--> statement-breakpoint
CREATE TABLE "agent_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"category" text NOT NULL,
	"content" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'AGENT' NOT NULL,
	"importance" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"agent_role" text NOT NULL,
	"task" text NOT NULL,
	"job_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_summary" text DEFAULT '' NOT NULL,
	"output" jsonb,
	"status" text NOT NULL,
	"error" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'IDLE' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"current_job_id" uuid,
	"current_task" text,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"thumbnail_key" text,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"sha256" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'READY' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_kits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"business_name" text NOT NULL,
	"logo_asset_id" uuid,
	"icon_asset_id" uuid,
	"primary_color" text DEFAULT '#2EE6A6' NOT NULL,
	"secondary_color" text DEFAULT '#7C6CFF' NOT NULL,
	"accent_color" text DEFAULT '#FFB547' NOT NULL,
	"background_color" text DEFAULT '#0B0F14' NOT NULL,
	"text_color" text DEFAULT '#F5F7FA' NOT NULL,
	"font_heading" text DEFAULT 'Inter' NOT NULL,
	"font_body" text DEFAULT 'Inter' NOT NULL,
	"tone" text DEFAULT 'confiante, claro e próximo' NOT NULL,
	"style" text DEFAULT 'moderno' NOT NULL,
	"voice" text DEFAULT '' NOT NULL,
	"website" text,
	"handle" text,
	"description" text DEFAULT '' NOT NULL,
	"target_audience" text DEFAULT '' NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"forbidden_words" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cta_preferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_kits_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "business_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"target_audience" text DEFAULT '' NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"value_proposition" text DEFAULT '' NOT NULL,
	"differentiators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"competitors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"website_analysis" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_profiles_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid,
	"variable" text NOT NULL,
	"hypothesis" text NOT NULL,
	"variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"winner" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"objective" text DEFAULT 'LEADS' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"product_id" uuid,
	"angle" text DEFAULT '' NOT NULL,
	"offer" text DEFAULT '' NOT NULL,
	"cta" text DEFAULT '' NOT NULL,
	"strategy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_by" text DEFAULT 'HUMAN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creative_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"key" text NOT NULL,
	"metric" text NOT NULL,
	"value" numeric(18, 6),
	"baseline" numeric(18, 6),
	"lift" numeric(12, 6),
	"sample_size" integer NOT NULL,
	"exposures" integer DEFAULT 0 NOT NULL,
	"events" integer DEFAULT 0 NOT NULL,
	"z_score" numeric(10, 4),
	"confidence" text NOT NULL,
	"rule" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"is_latest" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" text DEFAULT 'DIGITAL' NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"benefits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"faq" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"limitations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"offer" text DEFAULT '' NOT NULL,
	"checkout_url" text,
	"support" text DEFAULT '' NOT NULL,
	"terms" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid,
	"agent_run_id" uuid,
	"summary" text NOT NULL,
	"briefs" jsonb NOT NULL,
	"data_caveats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requested_count" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_variations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_content_id" uuid NOT NULL,
	"variation_content_id" uuid NOT NULL,
	"label" text NOT NULL,
	"preserved" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"changed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "contents_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid,
	"content_plan_id" uuid,
	"product_id" uuid,
	"experiment_id" uuid,
	"parent_content_id" uuid,
	"variant_label" text,
	"title" text NOT NULL,
	"status" text DEFAULT 'IDEA' NOT NULL,
	"brief" jsonb,
	"template_id" text,
	"format" text DEFAULT '9:16' NOT NULL,
	"hook" text,
	"hook_type" text,
	"angle" text,
	"cta" text,
	"cta_type" text,
	"objective" text DEFAULT 'LEADS' NOT NULL,
	"script" text,
	"copy" jsonb,
	"target_platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_spec_id" uuid,
	"slot_id" uuid,
	"scheduled_for" timestamp with time zone,
	"duration_sec" real,
	"similarity_score" real,
	"similar_to_content_id" uuid,
	"qa_status" text DEFAULT 'PENDING' NOT NULL,
	"qa_report" jsonb,
	"failure_reason" text,
	"failure_details" jsonb,
	"approval_status" text DEFAULT 'NOT_REQUIRED' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_by" text DEFAULT 'AGENT' NOT NULL,
	"regeneration_count" integer DEFAULT 0 NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_compositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'PROPOSED' NOT NULL,
	"validation_report" jsonb,
	"agent_run_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posting_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"local_date" text NOT NULL,
	"local_time" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"content_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_account_id" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"status" text DEFAULT 'CONNECTED' NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_expires_at" timestamp with time zone,
	"refresh_expires_at" timestamp with time zone,
	"last_validated_at" timestamp with time zone,
	"last_error" text,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action_required" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"social_post_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"views" integer,
	"reach" integer,
	"impressions" integer,
	"likes" integer,
	"comments" integer,
	"shares" integer,
	"saves" integer,
	"clicks" integer,
	"watch_time_ms" bigint,
	"avg_watch_ms" integer,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_simulated" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"social_account_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"caption" text DEFAULT '' NOT NULL,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title" text,
	"privacy" text,
	"publish_mode" text DEFAULT 'DIRECT' NOT NULL,
	"ai_label" boolean DEFAULT true NOT NULL,
	"idempotency_key" text NOT NULL,
	"publish_lock" text,
	"locked_at" timestamp with time zone,
	"provider_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"platform_post_id" text,
	"permalink" text,
	"published_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"error_details" jsonb,
	"published_by" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"tracked_link_code" text,
	"next_metrics_sync_at" timestamp with time zone,
	"last_metrics_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_posts_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "tracked_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" text NOT NULL,
	"social_post_id" uuid,
	"content_id" uuid,
	"campaign_id" uuid,
	"product_id" uuid,
	"destination_type" text NOT NULL,
	"destination_url" text,
	"clicks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracked_links_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "video_renders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"video_spec_id" uuid,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"worker_id" text,
	"local_path" text,
	"file_size" bigint,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"fps" real,
	"video_codec" text,
	"audio_codec" text,
	"has_audio" boolean,
	"thumbnail_key" text,
	"preview_key" text,
	"frame_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation" jsonb,
	"delivery_key" text,
	"delivery_expires_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"delivery_deleted_at" timestamp with time zone,
	"local_deleted_at" timestamp with time zone,
	"render_ms" integer,
	"error" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_specs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"schema_version" text NOT NULL,
	"spec" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"agent_run_id" uuid,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"model" text DEFAULT 'NONE' NOT NULL,
	"lead_id" uuid,
	"payment_id" uuid,
	"checkout_id" uuid,
	"opportunity_id" uuid,
	"content_id" uuid,
	"social_post_id" uuid,
	"campaign_id" uuid,
	"product_id" uuid,
	"tracked_link_id" uuid,
	"amount_cents" integer,
	"currency" text,
	"visitor_hash" text,
	"path" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"lead_id" uuid,
	"product_id" uuid,
	"opportunity_id" uuid,
	"campaign_id" uuid,
	"content_id" uuid,
	"social_post_id" uuid,
	"conversation_id" uuid,
	"provider" text NOT NULL,
	"provider_checkout_id" text,
	"url" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'CREATED' NOT NULL,
	"external_reference" text NOT NULL,
	"expires_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_by" text DEFAULT 'AI' NOT NULL,
	"approval_request_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkouts_external_reference_unique" UNIQUE("external_reference")
);
--> statement-breakpoint
CREATE TABLE "conversation_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"needs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"objections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"budget" text,
	"intent" text,
	"last_state" text,
	"messages_covered" integer DEFAULT 0 NOT NULL,
	"last_message_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_summaries_conversation_id_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"external_thread_id" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"ai_mode" text DEFAULT 'AI' NOT NULL,
	"assigned_user_id" uuid,
	"last_message_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"email" text,
	"phone" text,
	"first_purchase_at" timestamp with time zone,
	"total_revenue_cents" bigint DEFAULT 0 NOT NULL,
	"onboarding_status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE "lead_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"previous_score" integer,
	"breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_tag_relations" (
	"workspace_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_tag_relations_lead_id_tag_id_pk" PRIMARY KEY("lead_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "lead_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#7C6CFF' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"username" text,
	"phone" text,
	"email" text,
	"company" text,
	"contact_key" text,
	"channel" text,
	"source_platform" text,
	"source_social_post_id" uuid,
	"source_content_id" uuid,
	"campaign_id" uuid,
	"product_id" uuid,
	"attribution_model" text DEFAULT 'NONE' NOT NULL,
	"ref_code" text,
	"stage" text DEFAULT 'NEW' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"qualified_at" timestamp with time zone,
	"won_at" timestamp with time zone,
	"lost_at" timestamp with time zone,
	"lost_reason" text,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"dnc_at" timestamp with time zone,
	"dnc_reason" text,
	"ai_paused" boolean DEFAULT false NOT NULL,
	"last_contact_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"next_action" text,
	"next_action_at" timestamp with time zone,
	"followup_count" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"sender_type" text NOT NULL,
	"sender_user_id" uuid,
	"body" text NOT NULL,
	"content_type" text DEFAULT 'text' NOT NULL,
	"external_message_id" text,
	"delivery_status" text DEFAULT 'PENDING' NOT NULL,
	"error" text,
	"agent_run_id" uuid,
	"job_id" uuid,
	"idempotency_key" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"product_id" uuid,
	"content_id" uuid,
	"social_post_id" uuid,
	"campaign_id" uuid,
	"stage" text DEFAULT 'OPEN' NOT NULL,
	"value_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"won_at" timestamp with time zone,
	"lost_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"checkout_id" uuid,
	"lead_id" uuid,
	"opportunity_id" uuid,
	"customer_id" uuid,
	"product_id" uuid,
	"content_id" uuid,
	"social_post_id" uuid,
	"campaign_id" uuid,
	"provider" text NOT NULL,
	"provider_payment_id" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"source" text DEFAULT 'PROVIDER' NOT NULL,
	"approved_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recorded_by" uuid,
	"note" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"lead_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"agent_role" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"job_id" uuid,
	"agent_run_id" uuid,
	"agent_role" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"requested_by" text DEFAULT 'SYSTEM' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_analytics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"date" date NOT NULL,
	"posts_published" integer DEFAULT 0 NOT NULL,
	"contents_generated" integer DEFAULT 0 NOT NULL,
	"views" bigint DEFAULT 0 NOT NULL,
	"reach" bigint DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"qualified_leads" integer DEFAULT 0 NOT NULL,
	"checkouts" integer DEFAULT 0 NOT NULL,
	"sales" integer DEFAULT 0 NOT NULL,
	"revenue_cents" bigint DEFAULT 0 NOT NULL,
	"ai_cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"source" text DEFAULT 'system' NOT NULL,
	"dispatched_jobs" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"type" text NOT NULL,
	"runner" text DEFAULT 'ANY' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"error_details" jsonb,
	"result" jsonb,
	"idempotency_key" text,
	"event_id" uuid,
	"parent_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"user_id" uuid,
	"type" text NOT NULL,
	"severity" text DEFAULT 'INFO' NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text DEFAULT '' NOT NULL,
	"workspace_id" uuid,
	"signature_valid" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credentials_metadata" ADD CONSTRAINT "integration_credentials_metadata_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credentials_metadata" ADD CONSTRAINT "integration_credentials_metadata_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credentials_metadata" ADD CONSTRAINT "integration_credentials_metadata_secret_id_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_experiments" ADD CONSTRAINT "campaign_experiments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_experiments" ADD CONSTRAINT "campaign_experiments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_insights" ADD CONSTRAINT "creative_insights_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_variations" ADD CONSTRAINT "content_variations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_variations" ADD CONSTRAINT "content_variations_source_content_id_contents_id_fk" FOREIGN KEY ("source_content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_variations" ADD CONSTRAINT "content_variations_variation_content_id_contents_id_fk" FOREIGN KEY ("variation_content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_content_plan_id_content_plans_id_fk" FOREIGN KEY ("content_plan_id") REFERENCES "public"."content_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_experiment_id_campaign_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."campaign_experiments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_approved_by_profiles_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_compositions" ADD CONSTRAINT "custom_compositions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_compositions" ADD CONSTRAINT "custom_compositions_approved_by_profiles_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_slots" ADD CONSTRAINT "posting_slots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_slots" ADD CONSTRAINT "posting_slots_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_connected_by_profiles_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_metrics" ADD CONSTRAINT "social_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_metrics" ADD CONSTRAINT "social_metrics_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_links" ADD CONSTRAINT "tracked_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_links" ADD CONSTRAINT "tracked_links_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_links" ADD CONSTRAINT "tracked_links_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_links" ADD CONSTRAINT "tracked_links_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_links" ADD CONSTRAINT "tracked_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_renders" ADD CONSTRAINT "video_renders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_renders" ADD CONSTRAINT "video_renders_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_renders" ADD CONSTRAINT "video_renders_video_spec_id_video_specs_id_fk" FOREIGN KEY ("video_spec_id") REFERENCES "public"."video_specs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_specs" ADD CONSTRAINT "video_specs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_specs" ADD CONSTRAINT "video_specs_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_checkout_id_checkouts_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "public"."checkouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_profiles_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scores" ADD CONSTRAINT "lead_scores_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scores" ADD CONSTRAINT "lead_scores_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tag_relations" ADD CONSTRAINT "lead_tag_relations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tag_relations" ADD CONSTRAINT "lead_tag_relations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tag_relations" ADD CONSTRAINT "lead_tag_relations_tag_id_lead_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."lead_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_social_post_id_social_posts_id_fk" FOREIGN KEY ("source_social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_content_id_contents_id_fk" FOREIGN KEY ("source_content_id") REFERENCES "public"."contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_profiles_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_checkout_id_checkouts_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "public"."checkouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_profiles_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_profiles_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_analytics" ADD CONSTRAINT "daily_analytics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "icm_integration_type_uq" ON "integration_credentials_metadata" USING btree ("integration_id","credential_type") WHERE integration_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "icm_social_type_uq" ON "integration_credentials_metadata" USING btree ("social_account_id","credential_type") WHERE social_account_id is not null;--> statement-breakpoint
CREATE INDEX "icm_ws_idx" ON "integration_credentials_metadata" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "oauth_states_expires_idx" ON "oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_ws_user_uq" ON "workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspaces_status_idx" ON "workspaces" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_memories_ws_cat_idx" ON "agent_memories" USING btree ("workspace_id","category");--> statement-breakpoint
CREATE INDEX "agent_runs_ws_created_idx" ON "agent_runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_ws_role_uq" ON "agents" USING btree ("workspace_id","role");--> statement-breakpoint
CREATE INDEX "brand_assets_ws_idx" ON "brand_assets" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_assets_ws_sha_uq" ON "brand_assets" USING btree ("workspace_id","sha256");--> statement-breakpoint
CREATE INDEX "campaign_experiments_ws_idx" ON "campaign_experiments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "campaigns_ws_idx" ON "campaigns" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "creative_insights_ws_latest_idx" ON "creative_insights" USING btree ("workspace_id","is_latest");--> statement-breakpoint
CREATE UNIQUE INDEX "products_ws_slug_uq" ON "products" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "products_ws_idx" ON "products" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "content_plans_ws_idx" ON "content_plans" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_variations_pair_uq" ON "content_variations" USING btree ("source_content_id","variation_content_id");--> statement-breakpoint
CREATE INDEX "contents_ws_status_idx" ON "contents" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "contents_ws_scheduled_idx" ON "contents" USING btree ("workspace_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "contents_ws_created_idx" ON "contents" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "custom_compositions_ws_idx" ON "custom_compositions" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "posting_slots_ws_time_uq" ON "posting_slots" USING btree ("workspace_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "posting_slots_status_idx" ON "posting_slots" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_ws_platform_ext_uq" ON "social_accounts" USING btree ("workspace_id","platform","external_account_id");--> statement-breakpoint
CREATE INDEX "social_accounts_ws_idx" ON "social_accounts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "social_metrics_post_idx" ON "social_metrics" USING btree ("social_post_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_content_account_uq" ON "social_posts" USING btree ("content_id","social_account_id");--> statement-breakpoint
CREATE INDEX "social_posts_ws_status_idx" ON "social_posts" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "social_posts_due_idx" ON "social_posts" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "social_posts_metrics_idx" ON "social_posts" USING btree ("next_metrics_sync_at") WHERE status = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "tracked_links_content_idx" ON "tracked_links" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "video_renders_content_idx" ON "video_renders" USING btree ("content_id","created_at");--> statement-breakpoint
CREATE INDEX "video_renders_ws_idx" ON "video_renders" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "video_specs_content_version_uq" ON "video_specs" USING btree ("content_id","version");--> statement-breakpoint
CREATE INDEX "attribution_ws_type_idx" ON "attribution_events" USING btree ("workspace_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "attribution_content_idx" ON "attribution_events" USING btree ("content_id","event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_payment_type_uq" ON "attribution_events" USING btree ("payment_id","event_type") WHERE payment_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_lead_type_uq" ON "attribution_events" USING btree ("lead_id","event_type") WHERE event_type in ('LEAD','QUALIFIED');--> statement-breakpoint
CREATE INDEX "checkouts_ws_idx" ON "checkouts" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "checkouts_lead_idx" ON "checkouts" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_ws_lead_channel_uq" ON "conversations" USING btree ("workspace_id","lead_id","channel");--> statement-breakpoint
CREATE INDEX "conversations_ws_last_idx" ON "conversations" USING btree ("workspace_id","last_message_at");--> statement-breakpoint
CREATE INDEX "customers_ws_idx" ON "customers" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "lead_scores_lead_idx" ON "lead_scores" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_tags_ws_name_uq" ON "lead_tags" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_ws_contact_uq" ON "leads" USING btree ("workspace_id","contact_key") WHERE contact_key is not null;--> statement-breakpoint
CREATE INDEX "leads_ws_stage_idx" ON "leads" USING btree ("workspace_id","stage");--> statement-breakpoint
CREATE INDEX "leads_ws_content_idx" ON "leads" USING btree ("workspace_id","source_content_id");--> statement-breakpoint
CREATE INDEX "leads_next_action_idx" ON "leads" USING btree ("next_action_at");--> statement-breakpoint
CREATE INDEX "leads_ws_created_idx" ON "leads" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_ws_external_uq" ON "messages" USING btree ("workspace_id","external_message_id") WHERE external_message_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_idempotency_uq" ON "messages" USING btree ("idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "opportunities_ws_idx" ON "opportunities" USING btree ("workspace_id","stage");--> statement-breakpoint
CREATE INDEX "opportunities_lead_idx" ON "opportunities" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_id_uq" ON "payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "payments_ws_status_idx" ON "payments" USING btree ("workspace_id","status","approved_at");--> statement-breakpoint
CREATE INDEX "payments_content_idx" ON "payments" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "activities_ws_created_idx" ON "activities" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "activities_lead_idx" ON "activities" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_ws_created_idx" ON "ai_usage" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "approval_requests_ws_status_idx" ON "approval_requests" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_pending_entity_uq" ON "approval_requests" USING btree ("type","entity_id") WHERE status = 'PENDING' and entity_id is not null;--> statement-breakpoint
CREATE INDEX "audit_logs_ws_created_idx" ON "audit_logs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_analytics_ws_date_uq" ON "daily_analytics" USING btree ("workspace_id","date");--> statement-breakpoint
CREATE INDEX "events_ws_created_idx" ON "events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","runner","priority","scheduled_at") WHERE status in ('QUEUED','RETRYING');--> statement-breakpoint
CREATE INDEX "jobs_ws_created_idx" ON "jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_type_status_idx" ON "jobs" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "jobs_lease_idx" ON "jobs" USING btree ("lease_expires_at") WHERE status = 'RUNNING';--> statement-breakpoint
CREATE INDEX "notifications_ws_created_idx" ON "notifications" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_uq" ON "webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_received_idx" ON "webhook_events" USING btree ("received_at");