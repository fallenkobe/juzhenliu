import { createHash } from 'node:crypto';
import { db, onceReady } from './index';

export const DEMO_WORKSPACE = 'workspace-alpha';
export const now = () => new Date().toISOString();
export function dayInZone(date = new Date(), zone = 'Asia/Hong_Kong') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (type: string) => parts.find(p => p.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function ensureReady() {
  return onceReady(async () => {
    if ((process.env.ALPHA_MODE || 'demo') !== 'demo') throw new Error('Alpha 0.01 only supports ALPHA_MODE=demo. Real provider calls are not implemented.');
    await db.migrate();
    await db.transaction(null, async tx => {
      // The insert is also the seed lock in PostgreSQL (unique conflict waits).
      const created = await tx.query("INSERT INTO workspaces VALUES($1,$2,10,100000,200000,50000,100000,1,'Asia/Hong_Kong') ON CONFLICT DO NOTHING RETURNING id", [DEMO_WORKSPACE, '我的内容工作室']);
      if (!created.length) return;
      const accounts = [
        ['account-1', '生活不设限', 'life_unlimited', '生活方式', 'rose', 'active', 32860, 186400, 48],
        ['account-2', '一平方灵感', 'one_square', '品牌推广', 'violet', 'active', 18620, 92000, 32],
        ['account-3', '城市漫游指南', 'city_roaming', '生活方式', 'teal', 'active', 24510, 123800, 56],
        ['account-4', '好物研究所', 'goodthings_lab', '品牌推广', 'amber', 'expired', 12780, 68500, 27]
      ];
      for (const [id, nickname, handle, group, color, status, followers, likes, posts] of accounts) {
        await tx.query('INSERT INTO accounts VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11,$12)', [String(id), DEMO_WORKSPACE, String(nickname), String(handle), String(group), String(color), String(status), Number(followers), Number(likes), Number(posts), now(), 'demo']);
      }
      const assets = [['asset-1','把日子过成喜欢的样子','olive'], ['asset-2','好设计，藏在生活的细节里','rose'], ['asset-3','在城市的转角，发现另一种可能','blue'], ['asset-4','一杯咖啡的时间，重新出发','sand']];
      for (const [id, title, theme] of assets) {
        await tx.query('INSERT INTO assets VALUES($1,$2,$3,$4,NULL,NULL,0,NULL,$5,$6)', [id, DEMO_WORKSPACE, title, theme, createHash('sha256').update(id).digest('hex'), now()]);
      }
      for (let i = 0; i < 3; i++) {
        await tx.query('INSERT INTO works VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [`work-${i+1}`, DEMO_WORKSPACE, `account-${i+1}`, `asset-${i+1}`, assets[i][1], 'public', `demo_work_${i+1}`, [82400, 36700, 18600][i], [4860, 2100, 980][i], [268, 132, 74][i], new Date(Date.now() - i * 86400000 - 3600000).toISOString()]);
      }
      const waves = [31,40,34,52,46,61,56,73,62,81,70,92,82,108];
      for (let d = 0; d < 14; d++) for (let a = 1; a <= 4; a++) {
        await tx.query('INSERT INTO metric_points VALUES($1,$2,$3,$4,$5,$6)', [DEMO_WORKSPACE, `account-${a}`, dayInZone(new Date(Date.now() - (13-d)*86400000)), waves[d]*137 + a*327, waves[d]*2 + a*8, waves[d]*11 + a*21]);
      }
      await tx.query('INSERT INTO audit_events VALUES($1,$2,$3,$4,$5)', ['audit-seed', DEMO_WORKSPACE, '工作空间已就绪', '已载入 4 个演示账号和 4 份演示素材，所有数据均为模拟。', now()]);
    });
  });
}
