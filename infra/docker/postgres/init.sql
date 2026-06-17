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

-- ─── Demo "customer" database ─────────────────────────────────────────────────
-- Stands in for a customer's own Postgres instance — in production this would
-- be a completely separate server with credentials supplied via
-- databaseConnection.create. Same container here purely for local-dev
-- convenience; the TRE's connection model is identical either way (separate
-- credentials, separate database, never the safequery control-plane DB).
CREATE DATABASE customer_demo;
CREATE USER demo_analyst WITH PASSWORD 'demo_analyst_dev';

\c customer_demo;

GRANT CONNECT ON DATABASE customer_demo TO demo_analyst;
GRANT USAGE ON SCHEMA public TO demo_analyst;

CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  total NUMERIC(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO customers (name, email, status) VALUES
  ('Alice Johnson', 'alice@example.com', 'active'),
  ('Bob Smith', 'bob@example.com', 'active'),
  ('Carol Davis', 'carol@example.com', 'inactive'),
  ('Dave Wilson', 'dave@example.com', 'active'),
  ('Eve Martinez', 'eve@example.com', 'active');

INSERT INTO orders (customer_id, total, status) VALUES
  (1, 99.99, 'completed'),
  (1, 49.50, 'completed'),
  (2, 150.00, 'pending'),
  (3, 25.00, 'completed'),
  (4, 300.00, 'completed'),
  (5, 75.25, 'pending');

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO demo_analyst;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO demo_analyst;
