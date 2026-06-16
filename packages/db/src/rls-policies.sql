-- RLS POLICIES
-- Run this file after drizzle-kit migrate to create all row-level security policies.
-- The app sets `SET LOCAL app.current_org_id = '<uuid>'` at the start of every
-- request before executing any query against these tables.
--
-- safequery_reader  = warm read pool (SELECT only)
-- safequery_writer  = ephemeral write executor (DML, post-approval)
-- safequery (superuser) = API server / migrations (bypasses RLS)
--
-- Grants are also in this file — run after tables exist.

-- ── organizations ─────────────────────────────────────────────────────────────
CREATE POLICY organizations_isolation ON organizations
  FOR ALL
  TO safequery_reader, safequery_writer
  USING (id = current_setting('app.current_org_id', true)::uuid);

-- ── organization_members ──────────────────────────────────────────────────────
CREATE POLICY organization_members_isolation ON organization_members
  FOR ALL
  TO safequery_reader, safequery_writer
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- ── invitations ───────────────────────────────────────────────────────────────
CREATE POLICY invitations_isolation ON invitations
  FOR ALL
  TO safequery_reader, safequery_writer
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- ── environments ──────────────────────────────────────────────────────────────
CREATE POLICY environments_isolation ON environments
  FOR ALL
  TO safequery_reader, safequery_writer
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- ── database_connections ──────────────────────────────────────────────────────
CREATE POLICY database_connections_isolation ON database_connections
  FOR ALL
  TO safequery_reader, safequery_writer
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- ── schema_snapshots ──────────────────────────────────────────────────────────
CREATE POLICY schema_snapshots_isolation ON schema_snapshots
  FOR ALL
  TO safequery_reader, safequery_writer
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- ── custom_roles ──────────────────────────────────────────────────────────────
CREATE POLICY custom_roles_isolation ON custom_roles
  FOR ALL
  TO safequery_reader, safequery_writer
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- ── policies ──────────────────────────────────────────────────────────────────
CREATE POLICY policies_isolation ON policies
  FOR ALL
  TO safequery_reader, safequery_writer
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- ── query_logs ────────────────────────────────────────────────────────────────
CREATE POLICY query_logs_isolation ON query_logs
  FOR ALL
  TO safequery_reader, safequery_writer
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- ── approval_requests ─────────────────────────────────────────────────────────
CREATE POLICY approval_requests_isolation ON approval_requests
  FOR ALL
  TO safequery_reader, safequery_writer
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- ── audit_logs ────────────────────────────────────────────────────────────────
-- Append-only: safequery_reader can SELECT; safequery_writer can INSERT only, never UPDATE/DELETE.
CREATE POLICY audit_logs_read_isolation ON audit_logs
  FOR SELECT
  TO safequery_reader, safequery_writer
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT
  TO safequery_writer
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

-- ── Table grants ──────────────────────────────────────────────────────────────
-- The safequery superuser (used by the API server and drizzle-kit) bypasses RLS.
-- These grants give the TRE roles the minimum permissions they need.

GRANT SELECT ON ALL TABLES IN SCHEMA public TO safequery_reader;
GRANT SELECT, INSERT, UPDATE ON query_logs TO safequery_writer;
GRANT SELECT, INSERT, UPDATE ON approval_requests TO safequery_writer;
GRANT SELECT, INSERT ON audit_logs TO safequery_writer;
