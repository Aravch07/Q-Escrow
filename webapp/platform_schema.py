"""Additive migration for private file storage and its spending cutoffs."""

SCHEMA = """
ALTER TABLE pqe_files ALTER COLUMN data DROP NOT NULL;
ALTER TABLE pqe_files ADD COLUMN IF NOT EXISTS object_key TEXT;
ALTER TABLE pqe_chunks ALTER COLUMN data DROP NOT NULL;
ALTER TABLE pqe_chunks ADD COLUMN IF NOT EXISTS object_key TEXT;
ALTER TABLE pqe_chunks ADD COLUMN IF NOT EXISTS digest TEXT;
CREATE TABLE IF NOT EXISTS pqe_file_previews(
 digest TEXT NOT NULL REFERENCES pqe_files(digest), viewer TEXT NOT NULL, body JSONB,
 created_at BIGINT NOT NULL, object_key TEXT, PRIMARY KEY(digest,viewer));
ALTER TABLE pqe_file_previews ALTER COLUMN body DROP NOT NULL;
ALTER TABLE pqe_file_previews ADD COLUMN IF NOT EXISTS object_key TEXT;
CREATE TABLE IF NOT EXISTS pqe_storage_budget(
 name TEXT PRIMARY KEY, used BIGINT NOT NULL DEFAULT 0);
"""
