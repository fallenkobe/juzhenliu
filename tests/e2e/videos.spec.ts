import { test, expect } from '@playwright/test';
import type { VideoSnapshot } from '../../packages/video/types';

const id = '7000000000000000001';
const origin = process.env.E2E_PRODUCTION==='1'?'https://video-e2e.example':'http://127.0.0.1:3100';
const report = {
  videoId:id,fetchedAt:'2026-10-27T05:00:00Z',
  totals:{data:{title:'合成视频 · 网页流程测试',publishedAt:'2026-01-01T00:00:00Z',durationSeconds:12,plays:'447009',likes:'7644',comments:null,shares:'11927',collects:'404'},error:null},
  history:{data:{start:'2026-01-01',end:'2026-01-03',continuous:true,plays:'160',rows:[
    {date:'2026-01-01',plays:'100',validPlays:'90',likes:'12',comments:'4',shares:'8',collects:'2'},
    {date:'2026-01-02',plays:'60',validPlays:null,likes:'-2',comments:null,shares:'0',collects:'0'},
    {date:'2026-01-03',plays:'0',validPlays:'0',likes:'0',comments:'0',shares:'0',collects:'0'}
  ]},error:null}
};

test('video API requires real owner auth and rejects cross-site paid queries',async({request})=>{
  const unauthorized = await request.post('/api/videos/query',{headers:{Origin:origin,'X-Matrix-Request':'video-analytics-v1'},data:{input:id}});
  expect(unauthorized.status()).toBe(401);
  expect((await request.get('/api/videos/export/'+id)).status()).toBe(401);
  const crossSite=await request.post('/api/videos/session',{headers:{Origin:'https://evil.example','X-Matrix-Request':'video-analytics-v1'},data:{password:'wrong'}});
  expect(crossSite.status()).toBe(403);
});

test('video page login, query, real date range, negative/missing values, partial failure and mobile layout',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  let queried=false,partial=false;
  if(process.env.E2E_PRODUCTION==='1') await page.route('**/api/videos/session',async route=>{const response=await route.fetch({headers:{...route.request().headers(),origin}});await route.fulfill({response});});
  // UI-only fixtures: real owner login and status; no TikHub charges in automated tests.
  await page.route('**/api/videos/status',async route=>{const response=await route.fetch();const value=await response.json();await route.fulfill({json:{...value,providerConfigured:true}});});
  await page.route('**/api/videos/recent',route=>route.fulfill({json:{videos:queried?[{videoId:id,title:report.totals.data.title,fetchedAt:report.fetchedAt,partial:false}]:[]}}));
  await page.route('**/api/videos/query',route=>{queried=true;return route.fulfill({json:{report:partial?{...report,history:{data:null,error:'合成：历史数据暂不可用'}}:report,cached:false}});});
  await page.route('**/api/videos/reports/*',route=>route.fulfill({json:{report}}));
  await page.goto('/videos');
  await expect(page.getByRole('heading',{name:'登录矩阵流',exact:true})).toBeVisible();
  await page.getByLabel('矩阵流登录密码',{exact:true}).fill('browser-test-password-only-32-characters');
  await page.getByRole('button',{name:'登录矩阵流',exact:true}).click();
  await expect(page.getByRole('heading',{name:'查询作品',exact:true})).toBeVisible();
  await page.getByLabel('抖音作品链接或 ID').fill('https://www.douyin.com/video/'+id);
  await page.getByRole('button',{name:'查询作品',exact:true}).click();
  await expect(page.getByRole('heading',{name:report.totals.data.title})).toBeVisible();
  await expect(page.getByText('2026-01-01 至 2026-01-03 · 3 个记录日',{exact:true})).toBeVisible();
  await expect(page.getByText('不保证是最近 30 天',{exact:false})).toBeVisible();
  const row=page.getByRole('row').filter({hasText:'2026-01-02'});
  await expect(row.getByRole('cell',{name:'-2',exact:true})).toBeVisible();
  await expect(row.getByRole('cell',{name:'暂无数据',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'导出 CSV'})).toHaveAttribute('href','/api/videos/export/'+id);
  await page.getByRole('button',{name:new RegExp(report.totals.data.title)}).click();
  await expect(page.getByRole('heading',{name:report.totals.data.title})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('button',{name:'更新数据'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/videos-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'test-results/videos-desktop.png',fullPage:true});
  partial=true;await page.getByRole('button',{name:'更新数据'}).click();
  await expect(page.getByText('合成：历史数据暂不可用',{exact:false})).toBeVisible();
  await expect(page.getByRole('heading',{name:report.totals.data.title})).toBeVisible();
  await page.getByRole('button',{name:'退出',exact:true}).click();
  await expect(page.getByRole('heading',{name:'登录矩阵流',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});


test('saved reports, metric switching and reload do not make paid queries',async({page})=>{
  const secondId='7000000000000000002';let queryCalls=0;
  const other={...report,videoId:secondId,totals:{data:{...report.totals.data,title:'第二条合成视频'},error:null}};
  await page.route('**/api/videos/status',route=>route.fulfill({json:{signedIn:true,ownerConfigured:true,providerConfigured:false,originConfigured:true,dailyUsed:0,dailyLimit:100,cacheMinutes:30}}));
  await page.route('**/api/videos/recent',route=>route.fulfill({json:{videos:[{videoId:id,title:report.totals.data.title,fetchedAt:report.fetchedAt,partial:false},{videoId:secondId,title:other.totals.data.title,fetchedAt:report.fetchedAt,partial:true}]}}));
  await page.route('**/api/videos/reports/*',route=>route.fulfill({json:{report:route.request().url().endsWith(secondId)?other:report}}));
  await page.route('**/api/videos/query',route=>{queryCalls++;return route.abort();});
  await page.goto('/videos?videoId='+id);await expect(page.getByRole('heading',{name:report.totals.data.title})).toBeVisible();
  await page.getByLabel('趋势指标',{exact:true}).selectOption('likes');await expect(page.getByRole('img',{name:/逐日点赞趋势/})).toBeVisible();await expect(page.locator('.va-chart title')).toHaveText(['2026-01-01：12','2026-01-02：-2','2026-01-03：0']);
  await page.getByLabel('趋势指标',{exact:true}).selectOption('comments');await expect(page.locator('.va-chart circle')).toHaveCount(2);await expect(page.locator('.va-chart line[stroke="#24dbce"]')).toHaveCount(0);
  await page.getByLabel('查找已保存报告').fill(secondId);await expect(page.locator('.va-recent li')).toHaveCount(1);
  await page.getByLabel('仅部分数据',{exact:true}).check();await page.locator('.va-recent').getByRole('button',{name:/第二条合成视频/}).click();await expect(page).toHaveURL('/videos?videoId='+secondId);await expect(page.getByRole('heading',{name:other.totals.data.title})).toBeVisible();
  await page.getByLabel('查找已保存报告').fill('找不到');await expect(page.getByText('没有匹配的报告',{exact:false})).toBeVisible();await page.getByRole('button',{name:'清空报告筛选'}).click();await expect(page.locator('.va-recent li')).toHaveCount(2);
  await page.reload();await expect(page.getByRole('heading',{name:other.totals.data.title})).toBeVisible();expect(queryCalls).toBe(0);
  await page.screenshot({path:'test-results/videos-metrics-web.png',fullPage:true});
});

test('query snapshot bars retain observations, exact values and missing/negative metrics across reload',async({page})=>{
  const snapshots:VideoSnapshot[]=[
    {fetchedAt:'2026-10-27T01:00:00.000Z',source:'xingtu',origin:'saved-report',totals:{plays:'100000000000000001',likes:'-2',comments:null,shares:'3',collects:'0'}},
    {fetchedAt:'2026-10-27T02:30:00.000Z',source:'xingtu',origin:'query',totals:{plays:'100000000000000011',likes:null,comments:null,shares:'4',collects:'0'}},
    {fetchedAt:'2026-10-28T03:00:00.000Z',source:'xingtu',origin:'query',totals:{plays:'100000000000000021',likes:'0',comments:null,shares:'5',collects:'0'}}
  ];
  let queryCalls=0,visible=snapshots.slice(0,1);
  const value=()=>({...report,snapshots:visible,snapshotCount:visible.length,history:{data:null,error:'合成：历史数据暂不可用'}});
  await page.route('**/api/videos/status',route=>route.fulfill({json:{signedIn:true,ownerConfigured:true,providerConfigured:true,originConfigured:true,dailyUsed:0,dailyLimit:100,cacheMinutes:30}}));
  await page.route('**/api/videos/recent',route=>route.fulfill({json:{videos:[]}}));
  await page.route('**/api/videos/reports/*',route=>route.fulfill({json:{report:value()}}));
  await page.route('**/api/videos/query',route=>{queryCalls++;visible=snapshots;return route.fulfill({json:{report:value(),cached:false}});});
  await page.goto('/videos?videoId='+id);
  const panel=page.getByRole('region',{name:'查询记录分析'});
  await expect(panel.getByText('已有第一条记录，后续更新数据后可对比变化。')).toBeVisible();
  await panel.getByLabel('统计方式').selectOption('total');
  await expect(panel.locator('.vs-bar')).toHaveCount(1);
  await page.getByRole('button',{name:'更新数据'}).click();
  await expect(panel.getByText('已保存 3 次数据快照')).toBeVisible();
  await expect(panel.locator('.vs-bar')).toHaveCount(3);
  await panel.getByText('查看查询明细（3 条）').click();
  await expect(panel.getByText('100,000,000,000,000,001',{exact:true})).toBeVisible();
  await expect(panel.getByText('原已保存报告')).toBeVisible();
  await panel.getByLabel('快照指标').selectOption('likes');
  await expect(panel.locator('.vs-bar')).toHaveCount(2);
  await expect(panel.locator('.vs-bar[fill="#8c8c9b"]')).toHaveCount(2);
  await expect(panel.locator('.vs-chart text').filter({hasText:/^缺失/})).toBeVisible();
  await expect(panel.locator('.vs-bar title')).toHaveText([/累计点赞：-2/,/累计点赞：0/]);
  await panel.getByLabel('快照指标').selectOption('comments');
  await expect(panel.getByText('查询记录暂未提供评论数据，可切换其他指标。')).toBeVisible();
  await panel.getByLabel('快照指标').selectOption('shares');
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({path:'test-results/video-query-snapshots.png'});
  await page.reload();
  await expect(panel.locator('.vs-bar')).toHaveCount(2);expect(queryCalls).toBe(1);
});

test('snapshot increments use red up, green down, gray flat and exact query intervals',async({page})=>{
  const totals={plays:'100000000000000001',likes:'7',comments:null,shares:'2',collects:'0'};
  const snapshots:VideoSnapshot[]=[
    {fetchedAt:'2026-10-26T01:00:00.000Z',source:'xingtu',origin:'query',totals},
    {fetchedAt:'2026-10-26T02:30:00.000Z',source:'xingtu',origin:'query',totals:{...totals,plays:'100000000000000011',likes:null}},
    {fetchedAt:'2026-10-27T04:00:00.000Z',source:'xingtu',origin:'query',totals:{...totals,plays:'100000000000000008',likes:'10'}},
    {fetchedAt:'2026-10-28T04:00:00.000Z',source:'xingtu',origin:'query',totals:{...totals,plays:'100000000000000008',likes:'12'}}
  ];
  let queries=0;
  await page.route('**/api/videos/status',route=>route.fulfill({json:{signedIn:true,ownerConfigured:true,providerConfigured:true,originConfigured:true,dailyUsed:0,dailyLimit:100,cacheMinutes:30}}));
  await page.route('**/api/videos/recent',route=>route.fulfill({json:{videos:[]}}));
  await page.route('**/api/videos/reports/*',route=>route.fulfill({json:{report:{...report,snapshots,snapshotCount:4}}}));
  await page.route('**/api/videos/query',route=>{queries++;return route.abort();});
  await page.goto('/videos?videoId='+id);
  const panel=page.getByRole('region',{name:'查询记录分析'});
  await expect(panel.getByLabel('统计方式')).toHaveValue('change');
  await expect(panel.locator('.vs-bar')).toHaveCount(3);
  await expect(panel.locator('.vs-bar[fill="#f23868"] title')).toHaveText([/较上次增量播放：\+10/]);
  await expect(panel.locator('.vs-bar[fill="#22c55e"] title')).toHaveText([/间隔 1天1小时30分钟.*较上次增量播放：-3/]);
  await expect(panel.locator('.vs-bar[fill="#8c8c9b"] title')).toHaveText([/较上次增量播放：0/]);
  await expect(panel.locator('.vs-deltas>div').filter({hasText:'点赞增量'})).toContainText('+2');
  await panel.getByText('查看查询明细（4 条）').click();
  await expect(panel.locator('tbody tr').nth(1).locator('td').first()).toContainText('增量 +10');
  await expect(panel.locator('tbody tr').nth(2).locator('td').first()).toContainText('增量 -3');
  await expect(panel.locator('tbody tr').nth(2).locator('td').nth(1)).toContainText('增量 缺少数据');
  await panel.scrollIntoViewIfNeeded();await panel.screenshot({path:'test-results/video-snapshot-increments.png'});
  await panel.getByLabel('快照指标').selectOption('likes');
  await expect(panel.locator('.vs-bar')).toHaveCount(1);
  await expect(panel.locator('.vs-bar title')).toHaveText([/较上次增量点赞：\+2/]);
  await panel.getByLabel('统计方式').selectOption('total');
  await expect(panel.locator('.vs-bar')).toHaveCount(3);
  await expect(panel.locator('.vs-bar[fill="#f23868"]')).toHaveCount(1);
  await page.reload();await expect(panel.getByLabel('统计方式')).toHaveValue('change');
  await expect(panel.locator('.vs-bar')).toHaveCount(3);expect(queries).toBe(0);
});

 test('title flame displays calculated heat, explanations, reference and unavailable states without paid calls',async({page})=>{
  const {calculateHeat}=await import('../../packages/video/heat');
  const now=Date.now(),at=(hours:number)=>new Date(now-(3-hours)*3600000).toISOString();
  const point=(hours:number,plays:string,likes:string,comments:string,shares:string):VideoSnapshot=>({fetchedAt:at(hours),source:'xingtu',origin:'query',totals:{plays,likes,comments,shares,collects:'0'}});
  const snapshots=[point(1,'4000','240','40','32'),point(2,'6000','360','60','48'),point(3,'10000','600','100','80')];
  const current={...report,fetchedAt:at(3),totals:{data:{...report.totals.data,publishedAt:at(0)},error:null}};
  let heat=calculateHeat(current,snapshots),queryCalls=0;
  await page.route('**/api/videos/status',route=>route.fulfill({json:{signedIn:true,ownerConfigured:true,providerConfigured:true,originConfigured:true,dailyUsed:0,dailyLimit:100,cacheMinutes:30}}));
  await page.route('**/api/videos/recent',route=>route.fulfill({json:{videos:[]}}));
  await page.route('**/api/videos/reports/*',route=>route.fulfill({json:{report:{...current,heat}}}));
  await page.route('**/api/videos/query',route=>{queryCalls++;return route.abort();});
  await page.goto('/videos?videoId='+id);
  const badge=page.locator('.vh-badge');
  await expect(badge.locator('summary')).toContainText('热度 84.6');
  await expect(badge.locator('summary svg')).toBeVisible();
  await page.locator('.va-video').screenshot({path:'test-results/video-title-heat.png'});
  await badge.locator('summary').click();await expect(badge.getByText('矩阵流热度 · 试验版')).toBeVisible();
  await expect(badge.getByText('增长速度',{exact:true})).toBeVisible();
  await expect(badge.getByText(/非抖音官方分数/)).toBeVisible();
  await badge.locator('summary').click();
  heat={...heat,state:'reference',reason:'新增播放样本较少，仅供参考。'};
  await page.reload();await expect(badge.locator('summary')).toContainText('参考');
  heat={...heat,expiresAt:new Date(now-1000).toISOString()};
  await page.reload();await expect(badge.locator('summary')).toContainText('已过期');
  await expect(badge.locator('summary')).toContainText('84.6');
  heat=calculateHeat(current,snapshots.slice(-1));
  await page.reload();await expect(badge.locator('summary')).toContainText('热度待积累');
  heat=calculateHeat({...current,totals:{data:{...current.totals.data,publishedAt:null},error:null}},snapshots);
  await page.reload();await expect(badge.locator('summary')).toContainText('热度暂无数据');
  expect(queryCalls).toBe(0);
});
