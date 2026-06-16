-- Runs once on first container start (POSTGRES_DB=safequery already created by Docker).
-- This script creates the Keycloak sidecar database and sets up app-level roles
-- used by the TRE read pool and ephemeral write executor.

-- Keycloak needs its own database on the same Postgres instance.
CREATE DATABASE keycloak;

-- ─── SafeQuery app database setup ────────────────────────────────────────────
\c safequery;

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_bytes(), crypt()

-- ─── TRE database roles ───────────────────────────────────────────────────────
-- These roles are granted table-level permissions in Drizzle migration files
-- once the schema exists. Created here so migrations can GRANT to them.

-- Warm read pool: SELECT-only connections used for SAFE/WARNING queries.
CREATE ROLE safequery_reader NOLOGIN;

-- Ephemeral write executor: limited DML for CRITICAL write queries (post-approval).
CREATE ROLE safequery_writer NOLOGIN;

-- Login users that map to the roles above (used as connection credentials in TRE).
-- Passwords are overridden in .env and should never use these defaults in production.
CREATE USER tre_reader WITH PASSWORD 'tre_reader_dev' IN ROLE safequery_reader;
CREATE USER tre_writer WITH PASSWORD 'tre_writer_dev' IN ROLE safequery_writer;
