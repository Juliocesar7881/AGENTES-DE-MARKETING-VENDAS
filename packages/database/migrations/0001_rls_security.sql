-- RevenueOS — Row Level Security & least-privilege role.
--
-- Model: the web app runs user-scoped queries inside a transaction that does
--   SELECT set_config('app.user_id', <uuid>, true); SET LOCAL ROLE revenueos_app;
-- revenueos_app has NO BYPASSRLS and is not a table owner, so every row it can
-- see or write is filtered by the policies below. Trusted server code (workers,
-- webhooks, cron) runs as the owner role and is authorized explicitly in code.
-- Works on plain PostgreSQL 15+ and on Supabase.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'revenueos_app') THEN
    CREATE ROLE revenueos_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('GRANT revenueos_app TO %I', current_user);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not grant revenueos_app to %: %', current_user, SQLERRM;
END
$$;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.member_workspace_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT coalesce(array_agg(m.workspace_id), '{}'::uuid[])
  FROM public.workspace_members m
  WHERE m.user_id = app.current_user_id()
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.is_member(ws uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT ws IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = ws AND m.user_id = app.current_user_id()
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.is_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT coalesce((SELECT p.is_admin FROM public.profiles p WHERE p.id = app.current_user_id()), false) $$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA app FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO revenueos_app;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO revenueos_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO revenueos_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO revenueos_app;
--> statement-breakpoint
-- Enable RLS on EVERY table (default deny for any role without a policy, including
-- Supabase's anon/authenticated roles that PostgREST exposes).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '\_\_%' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END
$$;
--> statement-breakpoint
-- Supabase: never expose these tables through the auto-generated REST API.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
  END IF;
END
$$;
--> statement-breakpoint
-- Tenant tables: full CRUD for members of the row's workspace.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'business_profiles','brand_kits','brand_assets','products','agents','agent_memories',
    'campaigns','campaign_experiments','creative_insights','content_plans','contents',
    'content_variations','video_specs','video_renders','posting_slots','social_accounts',
    'social_posts','social_metrics','tracked_links','custom_compositions','leads','lead_tags',
    'lead_tag_relations','lead_scores','conversations','messages','conversation_summaries',
    'opportunities','checkouts','customers','payments','attribution_events','activities',
    'approval_requests','daily_analytics'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO revenueos_app', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO revenueos_app
         USING (workspace_id = ANY ((SELECT app.member_workspace_ids())::uuid[]))
         WITH CHECK (workspace_id = ANY ((SELECT app.member_workspace_ids())::uuid[]))',
      t || '_tenant_isolation', t);
  END LOOP;
END
$$;
--> statement-breakpoint
-- Read-only tenant tables (writes happen through authorized server code only).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['jobs','events','audit_logs','ai_usage','agent_runs','integration_credentials_metadata'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO revenueos_app', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO revenueos_app
         USING (workspace_id = ANY ((SELECT app.member_workspace_ids())::uuid[]) OR (workspace_id IS NULL AND (SELECT app.is_admin())))',
      t || '_tenant_read', t);
  END LOOP;
END
$$;
--> statement-breakpoint
GRANT SELECT ON public.integrations, public.agent_configs TO revenueos_app;
--> statement-breakpoint
CREATE POLICY integrations_read ON public.integrations FOR SELECT TO revenueos_app
  USING (workspace_id = ANY ((SELECT app.member_workspace_ids())::uuid[]) OR workspace_id IS NULL);
--> statement-breakpoint
CREATE POLICY agent_configs_read ON public.agent_configs FOR SELECT TO revenueos_app
  USING (workspace_id = ANY ((SELECT app.member_workspace_ids())::uuid[]) OR workspace_id IS NULL);
--> statement-breakpoint
-- Notifications: workspace members, or the addressed user.
GRANT SELECT, UPDATE ON public.notifications TO revenueos_app;
--> statement-breakpoint
CREATE POLICY notifications_access ON public.notifications FOR ALL TO revenueos_app
  USING (
    (workspace_id IS NOT NULL AND workspace_id = ANY ((SELECT app.member_workspace_ids())::uuid[]))
    OR user_id = (SELECT app.current_user_id())
    OR (workspace_id IS NULL AND user_id IS NULL AND (SELECT app.is_admin()))
  )
  WITH CHECK (
    (workspace_id IS NOT NULL AND workspace_id = ANY ((SELECT app.member_workspace_ids())::uuid[]))
    OR user_id = (SELECT app.current_user_id())
    OR (workspace_id IS NULL AND user_id IS NULL AND (SELECT app.is_admin()))
  );
--> statement-breakpoint
-- Workspaces: members can read and update; creation/deletion goes through authorized server code.
GRANT SELECT, UPDATE ON public.workspaces TO revenueos_app;
--> statement-breakpoint
CREATE POLICY workspaces_member_select ON public.workspaces FOR SELECT TO revenueos_app
  USING (id = ANY ((SELECT app.member_workspace_ids())::uuid[]));
--> statement-breakpoint
CREATE POLICY workspaces_member_update ON public.workspaces FOR UPDATE TO revenueos_app
  USING (id = ANY ((SELECT app.member_workspace_ids())::uuid[]))
  WITH CHECK (id = ANY ((SELECT app.member_workspace_ids())::uuid[]));
--> statement-breakpoint
GRANT SELECT ON public.workspace_members TO revenueos_app;
--> statement-breakpoint
CREATE POLICY workspace_members_select ON public.workspace_members FOR SELECT TO revenueos_app
  USING (workspace_id = ANY ((SELECT app.member_workspace_ids())::uuid[]));
--> statement-breakpoint
-- Profiles: never expose password hashes (column-level grants), see self and co-members.
GRANT SELECT (id, email, name, avatar_url, is_admin, is_demo, locale, last_login_at, created_at, updated_at) ON public.profiles TO revenueos_app;
--> statement-breakpoint
GRANT UPDATE (name, avatar_url, locale) ON public.profiles TO revenueos_app;
--> statement-breakpoint
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO revenueos_app
  USING (
    id = (SELECT app.current_user_id())
    OR EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.user_id = profiles.id AND m.workspace_id = ANY ((SELECT app.member_workspace_ids())::uuid[])
    )
  );
--> statement-breakpoint
CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE TO revenueos_app
  USING (id = (SELECT app.current_user_id()))
  WITH CHECK (id = (SELECT app.current_user_id()));
--> statement-breakpoint
-- Global, non-sensitive state readable by any signed-in user.
GRANT SELECT ON public.worker_instances, public.system_settings TO revenueos_app;
--> statement-breakpoint
CREATE POLICY worker_instances_read ON public.worker_instances FOR SELECT TO revenueos_app
  USING ((SELECT app.current_user_id()) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY system_settings_read ON public.system_settings FOR SELECT TO revenueos_app
  USING ((SELECT app.current_user_id()) IS NOT NULL);
--> statement-breakpoint
GRANT SELECT ON public.webhook_events TO revenueos_app;
--> statement-breakpoint
CREATE POLICY webhook_events_admin_read ON public.webhook_events FOR SELECT TO revenueos_app
  USING ((SELECT app.is_admin()));
--> statement-breakpoint
-- secrets, auth_sessions, rate_limits and oauth_states: no grants, no policies.
-- They are only reachable by trusted server code. Enforce that explicitly:
REVOKE ALL ON public.secrets, public.auth_sessions, public.rate_limits, public.oauth_states FROM revenueos_app;
