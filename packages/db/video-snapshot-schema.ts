export const videoSnapshotSchema = `
CREATE TABLE IF NOT EXISTS video_query_snapshots (
 video_id TEXT NOT NULL REFERENCES video_reports(video_id) ON DELETE CASCADE,
 fetched_at TEXT NOT NULL, snapshot_json TEXT NOT NULL,
 PRIMARY KEY(video_id, fetched_at)
);
`;
