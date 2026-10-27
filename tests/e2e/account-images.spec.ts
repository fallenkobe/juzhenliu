import {test,expect} from '@playwright/test';

test('avatars and covers display, recover from failure, and refresh without hidden paid queries',async({page})=>{
  const png=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=240;canvas.height=320;
    const c=canvas.getContext('2d')!,gradient=c.createLinearGradient(0,0,240,320);gradient.addColorStop(0,'#24dbce');gradient.addColorStop(1,'#ed3464');c.fillStyle=gradient;c.fillRect(0,0,240,320);
    c.fillStyle='white';c.font='bold 30px sans-serif';c.fillText('图片测试',55,165);return canvas.toDataURL('image/png').split(',')[1];
  });
  const uid='7000000000000000001',id='7000000000000000002';
  let account={uid,secUid:'MS4wLjABAAAAimage_fixture_00000001',douyinId:'fixture_image',nickname:'图片测试账号',avatarUrl:'https://p3.douyinpic.com/avatar.png',signature:'合成资料',followers:'68',following:'49',posts:'2',likes:'100',favorites:null,fetchedAt:'2026-10-27T08:00:00Z',addedAt:'2026-10-27T08:00:00Z'};
  let avatarCalls=0,coverCalls=0,refreshCalls=0,queryCalls=0,workQueries=0,previewCalls=0;
  const outside:string[]=[];page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:3100'))outside.push(r.url());});
  await page.route('**/api/videos/status',route=>route.fulfill({json:{signedIn:true,ownerConfigured:true,providerConfigured:true,originConfigured:true,dailyUsed:0,dailyLimit:100,cacheMinutes:30}}));
  await page.route('**/api/videos/accounts',route=>route.fulfill({json:{accounts:[account]}}));
  await page.route('**/api/videos/accounts/'+uid+'/works',route=>{if(route.request().method()==='POST')workQueries++;return route.fulfill({json:{pages:[{accountUid:uid,cursor:'0',nextCursor:null,hasMore:false,fetchedAt:account.fetchedAt,items:[{id,title:'有封面的作品',kind:'video',url:'https://www.douyin.com/video/'+id,coverUrl:'https://p3.douyinpic.com/cover.png',publishedAt:null},{id:'7000000000000000003',title:'无封面的作品',kind:'image',url:'https://www.douyin.com/note/7000000000000000003',coverUrl:null,publishedAt:null}]}]}});});
  await page.route('**/api/videos/images/avatar/**',route=>{avatarCalls++;return avatarCalls===1?route.fulfill({status:502,json:{error:'合成图片失败'}}):route.fulfill({contentType:'image/png',body:Buffer.from(png,'base64')});});
  await page.route('**/api/videos/images/cover/**',route=>{coverCalls++;return coverCalls===1?route.fulfill({status:502,json:{error:'合成图片失败'}}):route.fulfill({contentType:'image/png',body:Buffer.from(png,'base64')});});
  await page.route('**/api/videos/accounts/'+uid+'/refresh',route=>{refreshCalls++;account={...account,avatarUrl:'https://p3.douyinpic.com/new-avatar.png',fetchedAt:'2026-10-27T09:00:00Z'};return route.fulfill({json:{account,cached:false}});});
  await page.route('**/api/videos/query',route=>{queryCalls++;return route.abort();});
  await page.goto('/accounts?accountUid='+uid);
  await page.getByRole('button',{name:'重试图片测试账号的头像',exact:true}).click();
  const avatar=page.getByRole('img',{name:'图片测试账号的头像',exact:true});await expect(avatar).toBeVisible();await expect(avatar).toHaveJSProperty('naturalWidth',240);
  await page.getByRole('button',{name:'重试有封面的作品的封面',exact:true}).click();
  const cover=page.getByRole('img',{name:'有封面的作品的封面',exact:true});await expect(cover).toBeVisible();await expect(cover).toHaveJSProperty('naturalHeight',320);
  await expect(page.getByText('暂未获取封面',{exact:true})).toBeVisible();expect(avatarCalls).toBe(2);expect(coverCalls).toBe(2);expect(refreshCalls).toBe(0);expect(queryCalls).toBe(0);expect(workQueries).toBe(0);
  await page.getByRole('button',{name:'更新资料',exact:true}).click();await expect(page.getByText('账号资料与头像地址已更新。')).toBeVisible();await expect(avatar).toHaveAttribute('src',/09%3A00%3A00/);await expect(avatar).toHaveJSProperty('naturalWidth',240);expect(refreshCalls).toBe(1);
  await page.route('**/api/videos/accounts/lookup',route=>route.fulfill({json:{lookupId:'00000000-0000-4000-8000-000000000001',profile:{...account,uid:'7000000000000000009',nickname:'预览账号'},expiresAt:'2099-01-01T00:00:00Z',cached:false}}));
  await page.route('**/api/videos/images/preview/**',route=>{previewCalls++;return route.fulfill({contentType:'image/png',body:Buffer.from(png,'base64')});});
  await page.getByRole('button',{name:'添加账号',exact:true}).click();await page.getByLabel('抖音号',{exact:true}).fill('another_account');await page.getByRole('button',{name:'获取账号信息',exact:true}).click();
  await expect(page.getByRole('img',{name:'预览账号的头像',exact:true})).toHaveJSProperty('naturalWidth',240);expect(previewCalls).toBe(1);expect(outside).toEqual([]);
  await page.getByRole('button',{name:'关闭添加账号'}).click();
  await page.screenshot({path:'test-results/account-images-web.png',fullPage:true});
});
