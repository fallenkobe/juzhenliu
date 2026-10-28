import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { applyLoginControl, hasLiveSession, loginPicture, openLogin } from "../packages/publishing/login-browser";

// Local HTML fixtures, never send a real SMS/password or authenticate a real account.
const fixture = `<!doctype html><button id="entry">登录后使用丰富的作品体裁</button>
<section id="panel" hidden><img alt="二维码" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=">
<button id="sms">验证码登录</button><button id="pass">密码登录</button>
<input name="web-login-area-code-input" role="combobox" aria-label="国家/地区" value="+86">
<input placeholder="请输入手机号"><input id="code" placeholder="请输入验证码"><input hidden id="password" type="password" placeholder="请输入密码">
<button id="send">获取验证码</button><button id="login">登录</button></section>
<script>
entry.onclick=()=>panel.hidden=false;
sms.onclick=()=>{code.hidden=false;password.hidden=true};
pass.onclick=()=>{code.hidden=true;password.hidden=false};
send.onclick=()=>{document.body.dataset.sent='yes'};
login.onclick=()=>{document.body.dataset.login='yes'};
</script>`;

test("browser login controls, masking and session restoration on isolated fixtures", { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: process.env.MATRIX_LOGIN_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const context = await browser.newContext();
    await context.route("**/*", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: route.request().url().includes("creator-micro") ? "<nav>作品管理</nav>" : fixture }));
    const page = await context.newPage();
    await openLogin(page, "qr");
    assert.equal(await page.getByAltText("二维码").isVisible(), true);
    await applyLoginControl(page, { action: "login_method", method: "password" });
    await applyLoginControl(page, { action: "login_password", phone: "13800000000", password: "fixture-only" });
    assert.equal(await page.locator("body").getAttribute("data-login"), "yes");
    assert.equal(await page.getByPlaceholder("请输入密码").inputValue(), "fixture-only");
    assert.ok((await loginPicture(page)).startsWith("data:image/png;base64,"));
    await applyLoginControl(page, { action: "request_sms", phone: "13800000000" });
    assert.equal(await page.locator("body").getAttribute("data-sent"), "yes");
    await applyLoginControl(page, { action: "login_sms", phone: "13800000000", code: "123456" });
    assert.equal(await page.getByPlaceholder("请输入验证码").inputValue(), "123456");
    await assert.rejects(() => applyLoginControl(page, { action: "login_password", expiresAt: Date.now()-1 }));
    await applyLoginControl(page, { action: "refresh_qr" });
    assert.equal(await hasLiveSession(page, context), false);
    await context.addCookies([{ name: "sessionid", value: "fixture-only", domain: ".douyin.com", path: "/", secure: true, httpOnly: true }]);
    assert.equal(await hasLiveSession(page, context), false, "cookie alone is insufficient");
    await page.goto("https://creator.douyin.com/creator-micro/home");
    assert.equal(await hasLiveSession(page, context), true);
    const state = await context.storageState({ indexedDB: true });
    await context.close();
    const restored = await browser.newContext({ storageState: state });
    await restored.route("**/*", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: "<nav>作品管理</nav>" }));
    const next = await restored.newPage();
    await next.goto("https://creator.douyin.com/creator-micro/home");
    assert.equal(await hasLiveSession(next, restored), true);
    await restored.close();
  } finally { await browser.close(); }
});

test("identity challenge controls stay inside the challenge and never auto-send", { timeout: 60000 }, async () => {
  const { detectIdentityChallenge } = await import("../packages/publishing/identity-browser");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const context = await browser.newContext();
    const html = `<meta charset="utf-8"><div id="challenge"><h2 id="challengeTitle">身份验证</h2>
      <section id="choose"><button id="receive">接收短信验证码</button><button>手机刷脸验证</button><button>发送短信验证</button></section>
      <section id="otp" hidden><input placeholder="请输入验证码"><button id="send">获取验证码</button><button id="verify">确认</button></section></div>
      <script>receive.onclick=()=>{choose.hidden=true;otp.hidden=false;challengeTitle.textContent='接收短信验证码'};send.onclick=()=>document.body.dataset.sent='yes';verify.onclick=()=>challenge.remove();</script>`;
    await context.route("**/*", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: route.request().url().includes("sso.douyin.com") ? html : '<nav>作品管理</nav><input placeholder="普通登录验证码" id="background"><iframe style="width:600px;height:500px" src="https://sso.douyin.com/fixture"></iframe>' }));
    const page = await context.newPage();
    await page.goto("https://creator.douyin.com/creator-micro/home");
    await page.frameLocator("iframe").getByText("身份验证", { exact: true }).waitFor();
    await context.addCookies([{ name: "sessionid", value: "fixture-only", domain: ".douyin.com", path: "/", secure: true, httpOnly: true }]);
    assert.equal(await hasLiveSession(page, context), false);
    assert.equal((await detectIdentityChallenge(page))?.stage, "choose");
    assert.equal(await page.frameLocator("iframe").locator("body").getAttribute("data-sent"), null);
    await assert.rejects(() => applyLoginControl(page, { action: "refresh_qr" }), /identity verification/);
    await applyLoginControl(page, { action: "identity_receive_sms" });
    assert.equal((await detectIdentityChallenge(page))?.stage, "sms");
    await applyLoginControl(page, { action: "identity_request_sms" });
    assert.equal(await page.frameLocator("iframe").locator("body").getAttribute("data-sent"), "yes");
    await applyLoginControl(page, { action: "identity_code", code: "123456" });
    assert.equal(await detectIdentityChallenge(page), null);
    assert.equal(await hasLiveSession(page, context), true);
    assert.equal(await page.locator("#background").inputValue(), "");
    await assert.rejects(() => applyLoginControl(page, { action: "identity_request_sms" }), /no longer available/);
  } finally { await browser.close(); }
});

test("foreground SMS panel wins over a still-visible identity chooser", { timeout: 60000 }, async () => {
  const { detectIdentityChallenge, applyIdentityControl } = await import("../packages/publishing/identity-browser");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const context = await browser.newContext();
    await context.route("**/*", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `
      <style>.modal{position:fixed;inset:20px;background:white;padding:20px}.front{z-index:2}</style>
      <input id="background" placeholder="普通登录验证码">
      <div role="dialog" class="modal" id="old"><h2>身份验证</h2><button id="receive">接收短信验证码</button><button>手机刷脸验证</button><input placeholder="旧验证码"></div>
      <div role="dialog" class="modal front" id="front"><h2>接收短信验证码</h2><p>短信已发送至 138******00</p><input id="otp"><button id="verify">验证</button></div>
      <script>receive.onclick=()=>document.body.dataset.sent='yes';verify.onclick=()=>document.body.dataset.verified=otp.value;</script>
    ` }));
    const page = await context.newPage();
    await page.goto("https://creator.douyin.com/");
    assert.equal(await page.locator("#old h2").isVisible(), true, "ordinary visibility includes the covered old dialog");
    const challenge = await detectIdentityChallenge(page);
    assert.equal(challenge?.stage, "sms");
    assert.equal(challenge?.submitCode, true);
    assert.equal(challenge?.receiveSms, false);
    assert.equal(challenge?.face, false);
    await applyIdentityControl(page, { action: "identity_code", code: "123456" });
    assert.equal(await page.locator("body").getAttribute("data-verified"), "123456");
    assert.equal(await page.locator("body").getAttribute("data-sent"), null);
    assert.equal(await page.locator("#background").inputValue(), "");
    assert.equal(await page.locator("#old input").inputValue(), "");
  } finally { await browser.close(); }
});

test("SMS receipt heading exposes code entry and verify without treating heading as send button", { timeout: 60000 }, async () => {
  const { detectIdentityChallenge } = await import("../packages/publishing/identity-browser");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const input of ['<input placeholder="请输入短信验证码">', '<input type="text">', '<input type="text"><input type="text">']) {
      const context = await browser.newContext();
      const html = `<meta charset="utf-8"><input id="background" placeholder="普通登录验证码"><div id="challenge"><header><b>接收短信验证码</b></header><p>短信已发送至 138******00</p>${input}<button id="resend">重新发送</button><button>取消</button><button id="verify">验证</button><p>无法验证通过？选择其他验证方式</p></div><script>resend.onclick=()=>document.body.dataset.sent='yes';verify.onclick=()=>{document.body.dataset.verified=document.querySelector('#challenge input').value;challenge.remove()};</script>`;
      await context.route("**/*", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
      const page = await context.newPage();
      await page.goto("https://creator.douyin.com/");
      const capabilities = await detectIdentityChallenge(page);
      assert.equal(capabilities?.stage, "sms");
      assert.equal(capabilities?.receiveSms, false, "heading is not a clickable method choice");
      await assert.rejects(() => applyLoginControl(page, { action: "identity_receive_sms" }), /already selected/);
      if (input.split('<input').length === 3) {
        assert.equal(capabilities?.submitCode, false);
        await assert.rejects(() => applyLoginControl(page, { action: "identity_code", code: "123456" }), /Unrecognized/);
      } else {
        assert.equal(capabilities?.submitCode, true);
        await applyLoginControl(page, { action: "identity_code", code: "123456" });
        assert.equal(await page.locator("body").getAttribute("data-verified"), "123456");
        assert.equal(await page.locator("#background").inputValue(), "");
      }
      assert.equal(await page.locator("body").getAttribute("data-sent"), null);
      await context.close();
    }
  } finally { await browser.close(); }
});
