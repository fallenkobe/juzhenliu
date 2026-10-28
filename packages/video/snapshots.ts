import type { VideoReport, VideoSnapshot, VideoSnapshotChange } from './types';

export function compareSnapshots(current: VideoSnapshot, previous?: VideoSnapshot): VideoSnapshotChange {
  const values: VideoSnapshotChange['values'] = {plays:null,likes:null,comments:null,shares:null,collects:null};
  const elapsedMs = previous ? Date.parse(current.fetchedAt) - Date.parse(previous.fetchedAt) : null;
  const reason = !previous ? 'first' : !Number.isFinite(elapsedMs) || elapsedMs! <= 0 ? 'invalid-time' :
    current.source !== previous.source ? 'source-changed' : null;
  if (!reason && previous) {
    for (const key of Object.keys(values) as (keyof typeof values)[]) {
      const from = previous.totals[key], to = current.totals[key];
      // Missing observations are not skipped: every interval compares adjacent queries only.
      if (from !== null && to !== null) values[key] = (BigInt(to) - BigInt(from)).toString();
    }
  }
  return {previousAt:previous?.fetchedAt ?? null, elapsedMs:Number.isFinite(elapsedMs) && elapsedMs! > 0 ? elapsedMs : null, reason, values};
}

// Retain only normalized cumulative metrics, never upstream payloads or credentials.
export function snapshotFromReport(report: VideoReport, origin: VideoSnapshot['origin']): VideoSnapshot | null {
  const totals = report.totals.data;
  if (!totals) return null;
  const { plays, likes, comments, shares, collects } = totals;
  if ([plays, likes, comments, shares, collects].every(value => value === null)) return null;
  return { fetchedAt: report.fetchedAt, source: report.source ?? (report.kind === 'image' ? 'douyin-app-v3' : 'xingtu'), origin,
    totals: { plays, likes, comments, shares, collects } };
}
