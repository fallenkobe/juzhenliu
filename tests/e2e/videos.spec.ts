import { test, expect } from '@playwright/test';

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
  await expect(page.getByRole('heading',{name:'查询视频',exact:true})).toBeVisible();
  await page.getByLabel('抖音视频链接或 ID').fill('https://www.douyin.com/video/'+id);
  await page.getByRole('button',{name:'查询视频',exact:true}).click();
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
