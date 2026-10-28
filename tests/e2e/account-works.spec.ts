import {test,expect} from '@playwright/test';
const origin=process.env.E2E_PRODUCTION==='1'?'https://video-e2e.example':'http://127.0.0.1:3100';
const uid='7000000000000000001',vid='7000000000000000001',photoId='7000000000000000002';
const account={uid,secUid:'MS4wLjABAAAAworks_fixture_00000001',douyinId:'12345678901',nickname:'合成作品账号',avatarUrl:null,signature:'',followers:'68',following:'49',posts:'3',likes:'7668',favorites:null,fetchedAt:'2026-10-27T08:00:00Z',addedAt:'2026-10-27T08:00:00Z'};
const work=(id=vid,kind='video')=>({id,kind,title:id===vid?'合成视频A':kind==='image'?'合成图文B':'合成视频C',url:'https://www.douyin.com/'+(kind==='image'?'note':'video')+'/'+id,coverUrl:null,publishedAt:'2026-07-18T00:00:00Z'});
const report={videoId:vid,fetchedAt:'2026-10-27T08:00:00Z',totals:{data:{title:'合成视频A',publishedAt:null,durationSeconds:12,plays:'100',likes:'12',comments:'1',shares:'2',collects:'0'},error:null},history:{data:{start:'2026-07-18',end:'2026-07-18',continuous:true,plays:'100',rows:[{date:'2026-07-18',plays:'100',validPlays:null,likes:'12',comments:'1',shares:'2',collects:'0'}]},error:null}};

const photoReport={...report,videoId:photoId,kind:'image',source:'douyin-app-v3',imageCount:5,historySupported:false,totals:{data:{...report.totals.data,title:'合成图文B',durationSeconds:null,plays:null},error:null},history:{data:null,error:null}};

test('Web account works: explicit paging, type separation, analysis navigation and reload without new query',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let workCalls=0,queryCalls=0;const savedPages:unknown[]=[];
  if(process.env.E2E_PRODUCTION==='1')await page.route('**/api/videos/session',async route=>{const response=await route.fetch({headers:{...route.request().headers(),origin}});await route.fulfill({response});});
  await page.route('**/api/videos/status',async route=>{const response=await route.fetch();await route.fulfill({json:{...await response.json(),providerConfigured:true}});});
  await page.route('**/api/videos/accounts',route=>route.fulfill({json:{accounts:[account]}}));
  await page.route('**/api/videos/accounts/'+uid+'/works',route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{pages:savedPages}});
    workCalls++;const body=route.request().postDataJSON();const cursor=body.cursor||'0';
    const value={accountUid:uid,cursor,fetchedAt:account.fetchedAt,hasMore:cursor==='0',nextCursor:cursor==='0'?'100':null,items:cursor==='0'?[work(),work(photoId,'image')]:[work(),work('7000000000000000003')]};savedPages.push(value);
    return route.fulfill({json:{cached:false,page:value}});
  });
  await page.route('**/api/videos/query',route=>{queryCalls++;const input=route.request().postDataJSON().input;expect([vid,'https://www.douyin.com/note/'+photoId]).toContain(input);return route.fulfill({json:{cached:false,report:input===vid?report:photoReport}});});
  await page.route('**/api/videos/reports/*',route=>route.fulfill({json:{report:route.request().url().endsWith(photoId)?photoReport:report}}));
  await page.route('**/api/videos/recent',route=>route.fulfill({json:{videos:[]}}));
  await page.goto('/accounts');await page.getByLabel('矩阵流登录密码',{exact:true}).fill('browser-test-password-only-32-characters');await page.getByRole('button',{name:'登录矩阵流',exact:true}).click();
  await page.getByRole('button',{name:'查看作品',exact:true}).click();await expect(page.getByRole('heading',{name:'合成作品账号的作品'})).toBeVisible();
  await expect(page.locator('.am-work')).toHaveCount(2);expect(workCalls).toBe(1);expect(queryCalls).toBe(0);
  const imageRow=page.locator('.am-work').filter({hasText:'合成图文B'});await expect(imageRow.getByText('图文',{exact:true})).toBeVisible();await expect(imageRow.getByRole('button',{name:'查看分析'})).toHaveCount(1);await expect(imageRow.getByRole('link',{name:'打开作品'})).toHaveAttribute('href','https://www.douyin.com/note/'+photoId);
  await page.getByRole('button',{name:'加载更多',exact:true}).click();await expect(page.locator('.am-work')).toHaveCount(3);expect(workCalls).toBe(2);expect(queryCalls).toBe(0);await expect(page.getByText('本次返回完毕',{exact:true})).toBeVisible();
  await page.getByLabel('作品类型',{exact:true}).selectOption('image');await expect(page.locator('.am-work')).toHaveCount(1);
  await page.getByLabel('查找已加载作品').fill('找不到');await expect(page.getByText('已加载作品中没有匹配结果。')).toBeVisible();
  await page.getByRole('button',{name:'清空作品筛选'}).click();await page.getByLabel('作品排序').selectOption('oldest');await expect(page.locator('.am-work')).toHaveCount(3);expect(workCalls).toBe(2);expect(queryCalls).toBe(0);
  await page.screenshot({path:'test-results/account-works-web.png',fullPage:true});
  await page.locator('.am-work').filter({hasText:'合成视频A'}).getByRole('button',{name:'查看分析',exact:true}).click();await expect(page).toHaveURL('/videos?videoId='+vid+'&accountUid='+uid);await expect(page.getByRole('heading',{name:'合成视频A',exact:true})).toBeVisible();expect(queryCalls).toBe(1);
  await page.reload();await expect(page.getByRole('heading',{name:'合成视频A',exact:true})).toBeVisible();expect(queryCalls).toBe(1);
  await page.getByRole('link',{name:'返回账号作品'}).click();await expect(page).toHaveURL('/accounts?accountUid='+uid);await expect(page.locator('.am-work')).toHaveCount(3);
  await expect(page.getByText('已恢复保存的作品列表',{exact:false})).toBeVisible();expect(workCalls).toBe(2);expect(queryCalls).toBe(1);
  await page.reload();await expect(page.locator('.am-work')).toHaveCount(3);expect(workCalls).toBe(2);
  await page.locator('.am-work').filter({hasText:'合成图文B'}).getByRole('button',{name:'查看分析',exact:true}).click();
  await expect(page).toHaveURL('/videos?videoId='+photoId+'&accountUid='+uid);await expect(page.getByText('图文累计表现',{exact:true})).toBeVisible();
  await expect(page.getByText('图文 · 5 张图片',{exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'在抖音打开'})).toHaveAttribute('href','https://www.douyin.com/note/'+photoId);
  await expect(page.getByText('图文历史趋势暂未接入',{exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'导出 CSV'})).toHaveCount(0);
  await expect(page.locator('.va-metrics>div').filter({hasText:'累计播放'}).locator('strong')).toHaveText('暂无数据');expect(queryCalls).toBe(2);
  await page.reload();await expect(page.getByText('图文累计表现',{exact:true})).toBeVisible();expect(queryCalls).toBe(2);
  await page.getByRole('link',{name:'返回账号作品'}).click();await expect(page.locator('.am-work')).toHaveCount(3);expect(workCalls).toBe(2);
  expect(errors).toEqual([]);
});
test('work list API requires owner access and valid origin',async({request})=>{
  expect((await request.get('/api/videos/accounts/'+uid+'/works')).status()).toBe(401);
  const res=await request.post('/api/videos/accounts/'+uid+'/works',{headers:{Origin:origin,'X-Matrix-Request':'video-analytics-v1'},data:{cursor:'0'}});expect(res.status()).toBe(401);
  const denied=await request.post('/api/videos/accounts/'+uid+'/works',{headers:{Origin:'https://evil.example','X-Matrix-Request':'video-analytics-v1'},data:{cursor:'0'}});expect(denied.status()).toBe(403);
});
