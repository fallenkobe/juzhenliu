import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
const headers={'X-Matrix-Request':'douyin-0.11','Origin':'http://127.0.0.1:3100'};
test('0.11 real login entry, configuration checks and owner isolation',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/douyin');
  await expect(page.getByRole('heading',{name:'真实账号登录',exact:true})).toBeVisible();
  await expect(page.getByText('等待接入配置',{exact:true})).toBeVisible();
  await page.getByLabel('工作空间管理密码').fill('wrong-password');await page.getByRole('button',{name:'进入真实账号工作空间'}).click();await expect(page.locator('.dy-notice[role="alert"]')).toHaveText('管理密码不正确');
  await page.getByLabel('工作空间管理密码').fill('browser-test-password-only-32-characters');await page.getByRole('button',{name:'进入真实账号工作空间'}).click();
  await expect(page.getByRole('heading',{name:'还没有绑定真实账号'})).toBeVisible();await expect(page.getByRole('button',{name:'前往抖音扫码授权'})).toBeDisabled();
  const cookie=(await page.context().cookies()).find(c=>c.name==='matrix_douyin_owner');expect(cookie?.httpOnly).toBe(true);expect(cookie?.sameSite).toBe('Lax');
  await page.reload();await expect(page.getByRole('heading',{name:'还没有绑定真实账号'})).toBeVisible();
  mkdirSync('.data/previews',{recursive:true});await page.screenshot({path:'.data/previews/0.11-douyin-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'退出',exact:true}).click();await expect(page.getByLabel('工作空间管理密码')).toBeVisible();
  expect((await page.request.post('/api/douyin/authorize',{headers})).status()).toBe(401);
  expect(errors).toEqual([]);
});
test('demo session cannot grant real-account access; foreign origins and forged callbacks are rejected',async({request})=>{
  await request.post('/api/session',{headers:{'X-Matrix-Request':'alpha-0.01'}});
  const status=await(await request.get('/api/douyin/status')).json();expect(status.signedIn).toBe(false);expect(status.accounts).toEqual([]);
  const forbidden=await request.post('/api/douyin/owner',{headers:{...headers,Origin:'https://foreign.example'},data:{password:'browser-test-password-only-32-characters'}});expect(forbidden.status()).toBe(403);
  const callback=await request.get('/api/douyin/callback?state=forged&code=do-not-log',{maxRedirects:0});expect(callback.status()).toBe(303);expect(callback.headers().location).toContain('OWNER_REQUIRED');expect(callback.headers()['referrer-policy']).toBe('no-referrer');
  expect(callback.headers().location).not.toContain('do-not-log');
});
test('mobile configuration page stays usable without horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/douyin');await expect(page.getByRole('heading',{name:'真实账号登录',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'接入检查',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'.data/previews/0.11-douyin-mobile.png',fullPage:true});
});
