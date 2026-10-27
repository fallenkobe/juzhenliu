import {test,expect} from '@playwright/test';
test('local assistant entry and offline state are usable without official OAuth credentials',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('link',{name:'真实抖音账号登录'}).click();
  await expect(page).toHaveURL(/\/assistant$/);await expect(page.getByRole('heading',{name:'01 · 连接本机浏览器',exact:true})).toBeVisible();
  await expect(page.getByText('等待助手',{exact:true})).toBeVisible();await expect(page.getByText('npm run assistant',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'自动导出并同步'})).toBeDisabled();
  await page.getByLabel('本次账号备注').fill('测试自有账号');await page.getByRole('checkbox').check();await expect(page.getByRole('button',{name:'读取当前页面'})).toBeDisabled();
  expect(errors).toEqual([]);
});
test('assistant bridge rejects foreign origins and remote hosts, and never exposes local pairing secrets',async({request})=>{
  const status=await request.get('/api/assistant/status');expect(status.status()).toBe(200);const data=await status.json();expect(data.online).toBe(false);expect(data.token).toBeUndefined();
  const foreign=await request.post('/api/assistant/open',{headers:{Origin:'https://foreign.example','X-Matrix-Request':'assistant-0.11'},data:{page:'home'}});expect(foreign.status()).toBe(403);
  const remote=await request.get('/api/assistant/status',{headers:{Host:'public.example'}});expect(remote.status()).toBe(403);
});
test('assistant mobile layout fits narrow screens',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/assistant');await expect(page.getByRole('heading',{name:'采集结果',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
