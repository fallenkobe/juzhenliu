"""Controlled adapter to a separately installed, pinned social-auto-upload checkout.
No auto-install, no auto-login on publish, no repeated submit clicks. JSON-lines
protocol over private stdio. Credentials never appear in command arguments/logs.
"""
import asyncio
import base64
import contextlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

PIN = '3847fff01f5434a8a32829833163cd6723cabc59'
OUTPUT = sys.stdout

def emit(value):
    OUTPUT.write(json.dumps(value, ensure_ascii=False) + '\n')
    OUTPUT.flush()

class Cancelled(Exception):
    pass

async def next_control(seconds=1):
    try:
        return await asyncio.wait_for(CONTROLS.get(), seconds)
    except asyncio.TimeoutError:
        return None

async def read_controls():
    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            await CONTROLS.put({'action': 'cancel'})
            return
        try:
            value = json.loads(line)
            if isinstance(value, dict):
                await CONTROLS.put(value)
        except ValueError:
            pass

async def picture(page):
    return 'data:image/png;base64,' + base64.b64encode(await page.screenshot(full_page=False)).decode()

async def verification(page, control):
    if control and control.get('action') == 'cancel':
        raise Cancelled()
    sms = page.locator('input[placeholder*="验证码"]').first
    if await sms.count() and await sms.is_visible():
        if control and control.get('action') == 'request_sms':
            button = page.get_by_text('获取验证码', exact=True).first
            if await button.count() and await button.is_visible():
                await button.click()
        elif control and control.get('action') == 'sms_code':
            await sms.fill(control['code'])
            # A code is used only in this running Douyin task, never copied to a file.
            submit = page.get_by_role('button', name='确认', exact=True).first
            if await submit.count() and await submit.is_visible():
                await submit.click()
        return True
    return False

async def login(page, context, module):
    await page.goto('https://creator.douyin.com/', wait_until='domcontentloaded', timeout=60000)
    for i in range(150):
        command = await next_control(2)
        if command and command.get('action') == 'cancel':
            raise Cancelled()
        if await module._is_douyin_login_completed(page):
            state = await context.storage_state()
            if not any(c.get('name') == 'sessionid' and c.get('value') for c in state.get('cookies', [])):
                return {'state': 'failed', 'detail': '登录未取得有效会话，请重试'}
            return {'state': 'awaiting_identity', 'detail': '请核对截图中的登录账号；确认后才保存登录态', 'credential': state, 'image': await picture(page)}
        has_sms = await verification(page, command)
        if i % 5 == 0:
            emit({'type': 'verification' if has_sms else 'qr', 'image': await picture(page)})
    return {'state': 'failed', 'detail': '扫码或验证超时，未保存此次登录态'}

async def publish(page, module, account_file, payload):
    global SUBMITTED
    await page.goto('https://creator.douyin.com/creator-micro/content/upload', wait_until='domcontentloaded', timeout=60000)
    await page.wait_for_timeout(2000)
    for _ in range(120):
        command = await next_control(.2)
        if command and command.get('action') == 'cancel':
            raise Cancelled()
        if await verification(page, command):
            emit({'type':'verification','image':await picture(page)})
            await asyncio.sleep(2)
            continue
        if 'creator-micro' not in page.url or await page.get_by_text('扫码登录', exact=True).count():
            return {'state':'failed','detail':'登录已失效，请重新扫码'}
        break
    upload = page.locator('input[type="file"][accept*="video"], input.upload-btn-input').first
    await upload.set_input_files(payload['file'], timeout=60000)
    await page.wait_for_url('**/creator-micro/content/**', timeout=60000)
    # Enter the editor, never treat successful set_input_files as upload completion.
    await page.wait_for_function("() => /content\\/(publish|post\\/video)/.test(location.pathname)", timeout=180000)
    app = module.DouYinVideo(payload['title'], payload['file'], payload['tags'], 0,
                            str(account_file), desc=payload['description'],
                            publish_strategy='immediate', debug=False, headless=True,
                            declaration=payload.get('declaration'))
    await app.fill_title_and_description(page, payload['title'], payload['description'], payload['tags'])
    if payload.get('declaration'):
        applied = await app.set_self_declaration(page, payload['declaration'])
        if not applied:
            return {'state':'failed','detail':'未能设置指定内容声明，已停止且未点击发布'}
    button = page.get_by_role('button', name='发布', exact=True)
    await button.wait_for(state='visible', timeout=180000)
    emit({'type':'preview','image':await picture(page)})
    # An explicit final-page confirmation is required in this first adapter version.
    had_verification = False
    for _ in range(300):
        command = await next_control(1)
        if command and command.get('action') == 'cancel':
            raise Cancelled()
        if await verification(page, command):
            had_verification = True
            emit({'type':'verification','image':await picture(page)})
            continue
        if had_verification:
            emit({'type':'preview','image':await picture(page)})
            had_verification = False
        if command and command.get('action') == 'confirm_publish':
            SUBMITTED = True  # Any interruption from this point is conservatively unknown.
            emit({'type':'submitting'})
            acknowledgement = await next_control(10)
            if not acknowledgement or acknowledgement.get('action') != 'submit_ack':
                return {'state':'unknown','detail':'提交确认中断，未自动重试，请核实'}
            await button.click(timeout=15000)  # Exactly one click, no force, no loop retry.
            try:
                await page.wait_for_url('**/creator-micro/content/manage**', timeout=45000)
                return {'state':'submitted','detail':'已进入作品管理页；请在抖音确认作品及审核结果'}
            except Exception:
                return {'state':'unknown','detail':'已点击发布但未确认结果，请到抖音核实；禁止自动重发'}
    return {'state':'failed','detail':'发布页面确认超时，未点击发布'}

async def run(request):
    upstream = Path(os.environ['MATRIX_SAU_ROOT']).resolve()
    revision = subprocess.run(['git','-C',str(upstream),'rev-parse','HEAD'],capture_output=True,text=True,check=True).stdout.strip()
    dirty = subprocess.run(['git','-C',str(upstream),'diff','--quiet','HEAD','--'],capture_output=True).returncode
    if revision != PIN or dirty:
        raise RuntimeError('Pinned adapter mismatch')
    sys.path.insert(0,str(upstream))
    # Import only after revision validation. Installation is a separate administrator action.
    import uploader.douyin_uploader.main as module
    from patchright.async_api import async_playwright
    with tempfile.TemporaryDirectory(prefix='matrix-publish-') as temp:
        os.chmod(temp,0o700)
        account_file=Path(temp)/'account.json'
        # No credential file: the browser receives the in-memory storage_state dict.
        async with async_playwright() as p:
            browser=await p.chromium.launch(headless=True)  # No geo permissions or anti-detection overrides.
            context=await browser.new_context(storage_state=request.get('credential'), viewport={'width':1200,'height':900})
            try:
                page=await context.new_page()
                if request['kind']=='login':
                    return await login(page,context,module)
                if request['kind']=='check':
                    await page.goto('https://creator.douyin.com/creator-micro/content/upload',wait_until='domcontentloaded',timeout=60000)
                    await page.wait_for_timeout(2000)
                    valid=await module._is_douyin_login_completed(page)
                    return {'state':'submitted' if valid else 'failed','detail':'登录检查通过（不代表发布成功）' if valid else '登录失效或需要验证'}
                return await publish(page,module,account_file,request['payload'])
            finally:
                await context.close()
                await browser.close()

async def main():
    global CONTROLS, SUBMITTED
    SUBMITTED=False
    CONTROLS=asyncio.Queue()
    request=json.loads(sys.stdin.readline())
    reader=asyncio.create_task(read_controls())
    try:
        # Suppress third-party stdout/stderr; never stream cookies or raw errors into logs/UI.
        with open(os.devnull,'w') as sink,contextlib.redirect_stdout(sink),contextlib.redirect_stderr(sink):
            result=await asyncio.wait_for(run(request),900)
    except Cancelled:
        result={'state':'unknown' if SUBMITTED else 'cancelled','detail':'任务已停止；如已开始提交请到抖音核实'}
    except Exception:
        result={'state':'unknown' if SUBMITTED else 'failed','detail':'执行未完成：请检查固定版本、浏览器环境或平台页面；未自动重试'}
    finally:
        reader.cancel()
    emit({'type':'result',**result})
    # The stdin reader may block; Node closes the pipe after result to let executor exit.

if __name__=='__main__':
    asyncio.run(main())
