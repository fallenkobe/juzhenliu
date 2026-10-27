export const accountSchema = `
CREATE TABLE IF NOT EXISTS managed_douyin_accounts (
 uid TEXT PRIMARY KEY, douyin_id TEXT NOT NULL, profile_json TEXT NOT NULL, added_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_lookups (
 lookup_id TEXT PRIMARY KEY, session_hash TEXT NOT NULL REFERENCES douyin_owner_sessions(token_hash) ON DELETE CASCADE,
 douyin_id TEXT NOT NULL, profile_json TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_lookup_session_idx ON account_lookups(session_hash,douyin_id);
CREATE TABLE IF NOT EXISTS account_lookup_leases (
 douyin_id TEXT PRIMARY KEY, lease_token TEXT NOT NULL, expires_at TEXT NOT NULL
);
`;
