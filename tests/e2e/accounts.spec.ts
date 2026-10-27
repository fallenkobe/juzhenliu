import {test,expect} from '@playwright/test';
const origin=process.env.E2E_PRODUCTION==='1'?'https://video-e2e.example':'http://127.0.0.1:3100';
const profile={uid:'7000000000000000001',secUid:'MS4wLjABAAAAaccounts_fixture_00000001',douyinId:'12345678901',nickname:'合成账号测试',avatarUrl:null,signature:'用于网页验收的合成资料',followers:'68',following:'49',posts:'4',likes:'7668',favorites:null,fetchedAt:'2026-10-27T08:00:00Z'};
test('Web account flow: add, enter Douyin ID, fetch, confirm, restore and remove',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let accounts:unknown[]=[];let lookupCalls=0,saveCalls=0;
  if(process.env.E2E_PRODUCTION==='1')await page.route('**/api/videos/session',async route=>{const res=await route.fetch({headers:{...route.request().headers(),origin}});await route.fulfill({response:res});});
  await page.route('**/api/videos/status',async route=>{const res=await route.fetch();await route.fulfill({json:{...await res.json(),providerConfigured:true}});});
  await page.route('**/api/videos/accounts',async route=>{if(route.request().method()==='GET')return route.fulfill({json:{accounts}});saveCalls++;accounts=[{...profile,addedAt:profile.fetchedAt}];return route.fulfill({json:{account:accounts[0]}});});
  await page.route('**/api/videos/accounts/lookup',route=>{lookupCalls++;expect(route.request().postDataJSON().douyinId).toBe(profile.douyinId);return route.fulfill({json:{lookupId:'00000000-0000-4000-8000-000000000001',profile,expiresAt:'2099-01-01T00:00:00Z',cached:false}});});
  await page.route('**/api/videos/accounts/'+profile.uid,route=>{accounts=[];return route.fulfill({json:{ok:true}});});
  await page.goto('/');await page.getByLabel('矩阵流登录密码',{exact:true}).fill('browser-test-password-only-32-characters');await page.getByRole('button',{name:'登录矩阵流',exact:true}).click();await page.getByRole('button',{name:'账号管理',exact:true}).click();await expect(page).toHaveURL('/accounts');await expect(page.locator('.sidebar .nav-item.active')).toHaveText('账号管理');await expect(page.locator('input[type=password]')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'还没有添加账号'})).toBeVisible();await page.getByRole('button',{name:'添加账号',exact:true}).click();
  await page.getByLabel('抖音号',{exact:true}).fill(profile.douyinId);await page.getByRole('button',{name:'获取账号信息',exact:true}).click();
  await expect(page.locator('.am-preview').getByRole('heading',{name:profile.nickname})).toBeVisible();expect(saveCalls).toBe(0);
  await page.getByRole('button',{name:'确认添加',exact:true}).click();await expect(page.locator('.am-card').getByRole('heading',{name:profile.nickname})).toBeVisible();expect(lookupCalls).toBe(1);expect(saveCalls).toBe(1);
  await page.reload();await expect(page.locator('.am-card').getByRole('heading',{name:profile.nickname})).toBeVisible();
  await expect(page.getByText('添加记录不代表抖音授权',{exact:false})).toBeVisible();
  await page.screenshot({path:'test-results/accounts-web.png',fullPage:true});
  await page.getByRole('button',{name:'移除记录',exact:true}).click();await page.getByRole('button',{name:'确认移除',exact:true}).click();await expect(page.getByRole('heading',{name:'还没有添加账号'})).toBeVisible();
  await page.getByRole('button',{name:'退出',exact:true}).click();await expect(page.getByRole('heading',{name:'登录矩阵流',exact:true})).toBeVisible();expect(errors).toEqual([]);
});
test('account API does not expose saved records without owner login',async({request})=>{
  expect((await request.get('/api/videos/accounts')).status()).toBe(401);
  expect((await request.post('/api/videos/accounts/lookup',{headers:{Origin:origin,'X-Matrix-Request':'video-analytics-v1'},data:{douyinId:profile.douyinId}})).status()).toBe(401);
});


test('saved accounts search and exact large follower sorting stay local',async({page})=>{
  let providerCalls=0;
  const accounts=[
    {...profile,uid:'7000000000000000011',douyinId:'alpha',nickname:'甲账号',followers:'9007199254740992'},
    {...profile,uid:'7000000000000000012',douyinId:'beta',nickname:'乙账号',followers:'9007199254740993'},
    {...profile,uid:'7000000000000000013',douyinId:'zero',nickname:'零粉丝账号',followers:'0'},
    {...profile,uid:'7000000000000000014',douyinId:'missing',nickname:'缺失指标账号',followers:null}
  ].map(a=>({...a,addedAt:profile.fetchedAt}));
  await page.route('**/api/videos/status',route=>route.fulfill({json:{signedIn:true,ownerConfigured:true,providerConfigured:false,originConfigured:true,dailyUsed:0,dailyLimit:100,cacheMinutes:30}}));
  await page.route('**/api/videos/accounts',route=>route.fulfill({json:{accounts}}));
  await page.route('**/api/videos/accounts/lookup',route=>{providerCalls++;return route.abort();});
  await page.route('**/api/videos/accounts/*/works',route=>{expect(route.request().method()).toBe('GET');return route.fulfill({json:{pages:[]}});});
  await page.goto('/accounts');await expect(page.locator('.am-card')).toHaveCount(4);
  await page.getByLabel('账号排序',{exact:true}).selectOption('followers');
  await expect(page.locator('.am-card h3')).toHaveText(['乙账号','甲账号','零粉丝账号','缺失指标账号']);
  await expect(page.locator('.am-card').first()).toContainText('9,007,199,254,740,993');
  await page.getByLabel('查找已添加账号').fill(' ALPHA ');await expect(page.locator('.am-card h3')).toHaveText(['甲账号']);
  await page.getByLabel('查找已添加账号').fill('7000000000000000014');await expect(page.locator('.am-card h3')).toHaveText(['缺失指标账号']);
  await page.getByLabel('查找已添加账号').fill('不存在');await expect(page.getByRole('heading',{name:'没有匹配的账号'})).toBeVisible();
  await page.getByRole('button',{name:'清空账号搜索'}).click();await expect(page.locator('.am-card')).toHaveCount(4);
  await page.getByRole('button',{name:'查看作品',exact:true}).first().click();await expect(page.getByText('尚无保存的作品列表',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'获取作品',exact:true})).toBeDisabled();expect(providerCalls).toBe(0);
});
