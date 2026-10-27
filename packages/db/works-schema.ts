export const worksSchema = `
CREATE TABLE IF NOT EXISTS account_work_pages (
 uid TEXT NOT NULL REFERENCES managed_douyin_accounts(uid) ON DELETE CASCADE,
 cursor TEXT NOT NULL, page_json TEXT NOT NULL, fetched_at TEXT NOT NULL,
 PRIMARY KEY(uid,cursor)
);
CREATE TABLE IF NOT EXISTS account_work_leases (
 uid TEXT NOT NULL REFERENCES managed_douyin_accounts(uid) ON DELETE CASCADE,
 cursor TEXT NOT NULL, lease_token TEXT NOT NULL, expires_at TEXT NOT NULL,
 PRIMARY KEY(uid,cursor)
);
`;
