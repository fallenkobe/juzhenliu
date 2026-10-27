export const videoSchema = `
CREATE TABLE IF NOT EXISTS video_reports (
 video_id TEXT PRIMARY KEY, report_json TEXT NOT NULL, fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS video_query_leases (
 video_id TEXT PRIMARY KEY, lease_token TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS video_daily_usage (
 day TEXT PRIMARY KEY, queries INTEGER NOT NULL
);
`;
