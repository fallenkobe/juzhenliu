export const publishingSchema = `
CREATE TABLE IF NOT EXISTS publishing_accounts (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, label TEXT NOT NULL, expected_handle TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'disconnected', credential_ciphertext TEXT, epoch INTEGER NOT NULL DEFAULT 0,
 identity_confirmed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(owner_id,id), UNIQUE(owner_id,label)
);
CREATE TABLE IF NOT EXISTS publishing_assets (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL,
 bytes INTEGER NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(owner_id,id)
);
CREATE TABLE IF NOT EXISTS publishing_batches (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
 created_at TEXT NOT NULL, UNIQUE(owner_id,request_key), UNIQUE(owner_id,id)
);
CREATE TABLE IF NOT EXISTS publishing_operations (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, account_id TEXT NOT NULL, batch_id TEXT,
 kind TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, credential_epoch INTEGER NOT NULL,
 submission_authorized INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until TEXT, control_ciphertext TEXT, image_data TEXT, pending_credential TEXT,
 detail TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(owner_id,account_id) REFERENCES publishing_accounts(owner_id,id),
 FOREIGN KEY(owner_id,batch_id) REFERENCES publishing_batches(owner_id,id), UNIQUE(owner_id,id)
);
CREATE INDEX IF NOT EXISTS publishing_queue_idx ON publishing_operations(state,created_at);
CREATE TABLE IF NOT EXISTS publishing_worker (
 owner_id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, lease_until TEXT NOT NULL, updated_at TEXT NOT NULL
);
`;
