import {test,expect} from '@playwright/test';

test('one Matrix login covers accounts and videos; logout revokes access and external returns are rejected',async({page})=>{
  let loginCalls=0;
  await page.route('**/api/videos/session',async route=>{
    if(route.request().method()==='POST')loginCalls++;
    const headers={...route.request().headers(),...(process.env.E2E_PRODUCTION==='1'?{origin:'https://video-e2e.example'}:{})};
    const response=await route.fetch({headers});await route.fulfill({response});
  });
  await page.goto('/login?next=https%3A%2F%2Fevil.example');
  await expect(page.getByRole('heading',{name:'登录矩阵流',exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/workspace-login-web.png',fullPage:true});
  await page.getByLabel('矩阵流登录密码',{exact:true}).fill('wrong-password');await page.getByRole('button',{name:'登录矩阵流',exact:true}).click();
  await expect(page.locator('.va-message[role="alert"]')).toHaveText('管理密码不正确');
  await page.getByLabel('矩阵流登录密码',{exact:true}).fill('browser-test-password-only-32-characters');await page.getByRole('button',{name:'登录矩阵流',exact:true}).click();
  await expect(page).toHaveURL('/accounts');await expect(page.getByRole('heading',{name:'账号管理',exact:true})).toBeVisible();await expect(page.locator('input[type=password]')).toHaveCount(0);
  await page.getByRole('link',{name:'视频分析',exact:true}).first().click();await expect(page).toHaveURL('/videos');await expect(page.getByRole('heading',{name:'查询作品',exact:true})).toBeVisible();await expect(page.locator('input[type=password]')).toHaveCount(0);
  await page.reload();await expect(page.getByRole('heading',{name:'查询作品',exact:true})).toBeVisible();expect(loginCalls).toBe(2);
  await page.getByRole('button',{name:'退出',exact:true}).click();await expect(page).toHaveURL('/login');await expect(page.getByRole('heading',{name:'登录矩阵流',exact:true})).toBeVisible();
  expect((await page.request.get('/api/videos/accounts')).status()).toBe(401);expect((await page.request.get('/api/videos/recent')).status()).toBe(401);
  await page.goto('/videos?videoId=7000000000000000001');await expect(page).toHaveURL('/login?next=%2Fvideos%3FvideoId%3D7000000000000000001');
});
