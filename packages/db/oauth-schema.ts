// Kept separate from the Alpha 0.01 migration so existing databases upgrade.
export const oauthSchema = `
CREATE TABLE IF NOT EXISTS douyin_owner_sessions (
 token_hash TEXT PRIMARY KEY, owner_epoch TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS douyin_login_limits (
 bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS douyin_oauth_attempts (
 state_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL REFERENCES douyin_owner_sessions(token_hash) ON DELETE CASCADE,
 client_key TEXT NOT NULL, redirect_uri TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS douyin_connections (
 id TEXT PRIMARY KEY, client_key TEXT NOT NULL, open_id TEXT NOT NULL, nickname TEXT NOT NULL,
 avatar TEXT NOT NULL, scope TEXT NOT NULL, token_ciphertext TEXT NOT NULL,
 expires_at TEXT NOT NULL, refresh_expires_at TEXT NOT NULL, connected_at TEXT NOT NULL,
 UNIQUE(client_key,open_id)
);
`;
