import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const headers={'X-Matrix-Request':'alpha-0.01'};
async function enter(page:Page){await page.goto('/');await page.getByRole('button',{name:'进入 Alpha 演示'}).click();await expect(page.getByRole('heading',{name:'数据总览',exact:true})).toBeVisible();}
test('desktop overview, real backend data, CSV export and search',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page);
  await expect(page.getByText('Alpha 0.01',{exact:true}).first()).toBeVisible();
  const exported=await page.request.get('/api/analytics/export');expect(exported.status()).toBe(200);expect(await exported.text()).toContain('演示数据');
  await page.getByRole('button',{name:'账号管理',exact:true}).click();await page.getByRole('textbox',{name:'搜索当前页面'}).fill('城市漫游');await expect(page.getByRole('heading',{name:'城市漫游指南',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'好物研究所',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'数据总览',exact:true}).click();mkdirSync('.data/previews',{recursive:true});await page.screenshot({path:'.data/previews/alpha-0.01-desktop.png',fullPage:true});expect(errors).toEqual([]);
});
test('add a demo account and restore expired demo authorization',async({page})=>{
  await enter(page);await page.getByRole('button',{name:'账号管理',exact:true}).click();await page.getByRole('button',{name:'添加演示账号',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('账号昵称').fill('Alpha 新创作');await dialog.getByLabel('账号标识').fill('alpha_browser_test');await dialog.getByRole('button',{name:'添加演示账号',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.getByRole('heading',{name:'Alpha 新创作',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'重新授权（演示）'}).click();await expect(page.getByText('演示授权已更新',{exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:'Alpha 新创作',exact:true})).toBeVisible();await page.getByRole('button',{name:'数据分析',exact:true}).click();await page.getByLabel('分析账号').selectOption({label:'Alpha 新创作'});await expect(page.locator('.trend-panel').getByText('暂无数据',{exact:true})).toBeVisible();
});
test('publish preview and confirmation run through the independent worker',async({page})=>{
  await enter(page);await page.getByRole('button',{name:'一键发布',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('选择发布素材').selectOption('asset-4');await dialog.getByLabel('发布文案').fill('浏览器验证：原创咖啡日记');await dialog.locator('label').filter({hasText:'生活不设限'}).getByRole('checkbox').check();await dialog.getByRole('button',{name:'预检发布'}).click();await expect(dialog.getByRole('heading',{name:'发布参数预检通过'})).toBeVisible();await dialog.getByRole('button',{name:'确认演示发布',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.getByText('演示发布成功',{exact:true}).first()).toBeVisible();
  const data=await(await page.request.get('/api/bootstrap')).json();const batch=data.batches.find((b:any)=>b.title==='浏览器验证：原创咖啡日记');expect(batch.jobs).toHaveLength(1);expect(batch.jobs[0].attempts).toBe(1);
});
test('promotion budget confirmation, order stages and stopping retain real ledger semantics',async({page})=>{
  await enter(page);await page.getByRole('button',{name:'DOU+ 投流',exact:true}).click();await page.getByRole('button',{name:'新建演示投流',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.locator('label').filter({hasText:'把日子过成喜欢的样子'}).getByRole('checkbox').check();await dialog.getByRole('button',{name:'检查预算与资格'}).click();await expect(dialog.getByText('本次演示预算 ¥100.00',{exact:true})).toBeVisible();await dialog.getByRole('button',{name:'确认演示投流 · 不会扣费'}).click();await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button',{name:'停止演示投流',exact:true}).first()).toBeVisible();await page.getByRole('button',{name:'停止演示投流',exact:true}).first().click();await expect(page.getByText('已停止',{exact:true}).first()).toBeVisible();
  const data=await(await page.request.get('/api/bootstrap')).json();expect(data.orders[0].actual_cents).not.toBeNull();expect(data.orders[0].delivery_state).toBe('STOPPED');
});
test('unknown publication can be reconciled without duplicate submission',async({page})=>{
  await enter(page);await page.getByRole('button',{name:'一键发布',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('选择发布素材').selectOption('asset-2');await dialog.getByLabel('发布文案').fill('浏览器验证：未知结果核验');await dialog.locator('label').filter({hasText:'城市漫游指南'}).getByRole('checkbox').check();await dialog.getByLabel('演示结果').selectOption('unknown');await dialog.getByRole('button',{name:'预检发布'}).click();await dialog.getByRole('button',{name:'确认演示发布',exact:true}).click();await expect(page.getByText('结果待核验',{exact:true}).first()).toBeVisible();
  await page.getByRole('row').filter({hasText:'浏览器验证：未知结果核验'}).getByRole('button',{name:'查看详情'}).click();await page.getByRole('button',{name:'核验演示结果',exact:true}).click();await expect(page.getByRole('dialog').getByText('演示发布成功',{exact:true})).toBeVisible();const data=await(await page.request.get('/api/bootstrap')).json();expect(data.batches.find((b:any)=>b.title==='浏览器验证：未知结果核验').jobs[0].attempts).toBe(1);
});
test('upload checks file content and stores a browser-recorded original video',async({page})=>{
  await enter(page);await page.getByRole('button',{name:'素材库',exact:true}).click();const input=page.locator('input[type=file]');await input.setInputFiles({name:'fake.mp4',mimeType:'video/mp4',buffer:Buffer.from('not-a-real-video-content')});await expect(page.getByRole('alert').filter({hasText:'文件头不符合'})).toContainText('文件头不符合');
  const bytes=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const context=canvas.getContext('2d')!;context.fillStyle='#fe2c55';context.fillRect(0,0,160,90);const stream=canvas.captureStream(5);const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});const chunks:Blob[]=[];
    return new Promise<number[]>(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())));};recorder.start();setTimeout(()=>{context.fillStyle='#25f4ee';context.fillRect(40,20,80,50);},100);setTimeout(()=>recorder.stop(),500);});
  });
  await input.setInputFiles({name:'alpha-original.webm',mimeType:'video/webm',buffer:Buffer.from(bytes)});await expect(page.getByRole('heading',{name:'alpha-original',exact:true})).toBeVisible();await page.getByRole('button',{name:'预览 alpha-original',exact:true}).click();await expect(page.getByRole('dialog').locator('video')).toBeVisible();
});
test('API requires session and rejects cross-origin mutations',async({request})=>{
  const denied=await request.get('/api/bootstrap');expect(denied.status()).toBe(401);const rejected=await request.post('/api/session',{headers:{...headers,Origin:'https://untrusted.example'}});expect(rejected.status()).toBe(403);
});
test('mobile navigation and overview fit a narrow viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});await enter(page);await expect(page.getByRole('heading',{name:'数据总览',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button',{name:'打开导航'}).click();await page.getByRole('button',{name:'账号管理',exact:true}).click();await expect(page.getByRole('heading',{name:'账号管理',exact:true})).toBeVisible();await page.getByRole('button',{name:'打开导航'}).click();await page.getByRole('button',{name:'数据总览',exact:true}).click();await expect(page.locator('.sidebar')).not.toBeVisible();mkdirSync(path.resolve('.data/previews'),{recursive:true});await page.screenshot({path:'.data/previews/alpha-0.01-mobile.png',fullPage:true});
});
