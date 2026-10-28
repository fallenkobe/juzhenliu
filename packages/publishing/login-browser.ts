import { chromium, type Browser, type BrowserContext, type Page, type Locator } from "playwright-core";
import { applyIdentityControl, detectIdentityChallenge } from "./identity-browser";
import { LoginBrowserError, loginStageLabels, type LoginStage } from "./login-errors";

// Fixed official surface; no caller-controlled URLs, selectors, or scripts.
const CREATOR = "https://creator.douyin.com/";
export type LoginControl = { action: string; method?: string; phone?: string; password?: string; code?: string; expiresAt?: number };
export type LoginResult = { state: string; detail: string; credential?: unknown; image?: string; checkStatus?: "expired" | "verification_required" | "check_failed" };
type Emit = (value: Record<string, unknown>) => Promise<void> | void;
type NextControl = () => Promise<LoginControl | undefined>;
const visible = (locator: Locator) => locator.filter({ visible: true }).last();
const field = (page: Page, name: string) => visible(page.getByPlaceholder(name, { exact: true }));
async function clickText(page: Page, text: string) {
  const target = visible(page.getByText(text, { exact: true }));
  if (!(await target.isVisible())) throw new Error("Unavailable login control");
  await target.click({ timeout: 5000 });
}
export async function loginPicture(page: Page) {
  // Never return phone/password/OTP input values to the UI via screenshots.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return "data:image/png;base64," + (await page.screenshot({
        type: "png", fullPage: false, timeout: 8000,
        mask: page.frames().filter(frame => !frame.isDetached()).map(frame => frame.locator('input:not([name="web-login-area-code-input"])')),
      })).toString("base64");
    } catch (error) {
      if (page.isClosed() || attempt === 1) throw new LoginBrowserError("screenshot", error);
      // Re-resolve masks after a frame reload; never fall back to an unmasked image.
      await page.waitForTimeout(250);
    }
  }
  throw new LoginBrowserError("screenshot");
}
async function savedState(context: BrowserContext) {
  const state = await context.storageState({ indexedDB: true });
  return {
    cookies: state.cookies.filter(c => /(^|\.)douyin\.com$/.test(c.domain)),
    origins: state.origins.filter(o => { const u = new URL(o.origin); return u.protocol === "https:" && /(^|\.)douyin\.com$/.test(u.hostname); }),
  };
}
export async function hasLiveSession(page: Page, context: BrowserContext) {
  if (await detectIdentityChallenge(page)) return false;
  return hasSessionEvidence(page, context);
}
async function hasSessionEvidence(page: Page, context: BrowserContext) {
  const u = new URL(page.url());
  if (u.origin !== "https://creator.douyin.com" || !u.pathname.startsWith("/creator-micro/")) return false;
  const cookies = await context.cookies(CREATOR);
  if (!cookies.some(c => ["sessionid", "sessionid_ss"].includes(c.name) && c.value && (c.expires === -1 || c.expires > Date.now()/1000))) return false;
  // Cookie presence alone is not authentication; require visible creator navigation too.
  return await page.getByText(/^(作品管理|发布视频|数据中心|首页)$/).filter({ visible: true }).count() > 0 &&
    !(await field(page, "请输入密码").isVisible()) && !(await field(page, "请输入验证码").isVisible());
}
export async function openLogin(page: Page, method = "qr", onStage?: (stage: LoginStage) => Promise<void>) {
  await onStage?.("page_open");
  try { await page.goto(CREATOR, { waitUntil: "domcontentloaded", timeout: 30000 }); }
  catch (error) { throw new LoginBrowserError("page_open", error); }
  await onStage?.("login_panel");
  const entry = page.getByRole("button", { name: "登录后使用丰富的作品体裁", exact: true });
  const passwordTab = visible(page.getByText("密码登录", { exact: true }));
  // Landing content hydrates asynchronously; an early click can precede its handler.
  const deadline = Date.now() + 35000;
  while (!(await passwordTab.isVisible()) && Date.now() < deadline) {
    if (await entry.isVisible()) await entry.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }
  if (!(await passwordTab.isVisible())) throw new LoginBrowserError("login_panel");
  if (method !== "qr") await clickText(page, method === "password" ? "密码登录" : "验证码登录");
}
async function selectMethod(page: Page, method: string) {
  if (method === "qr") { await openLogin(page, "qr"); return; }
  await clickText(page, method === "password" ? "密码登录" : "验证码登录");
}
export async function applyLoginControl(page: Page, command: LoginControl) {
  if (command.expiresAt && command.expiresAt <= Date.now()) throw new Error("Expired login command");
  if (command.action.startsWith("identity_")) { await applyIdentityControl(page, command); return; }
  if (await detectIdentityChallenge(page)) throw new Error("Complete the current identity verification first");
  if (command.action === "login_method") {
    if (!["qr", "sms", "password"].includes(command.method || "")) throw new Error("Invalid method");
    await selectMethod(page, command.method!); return;
  }
  if (command.action === "refresh_qr") { await openLogin(page, "qr"); return; }
  if (!["request_sms", "login_password", "login_sms", "sms_code"].includes(command.action)) throw new Error("Invalid login command");
  if (command.action !== "sms_code") {
    if (!/^1\d{10}$/.test(command.phone || "")) throw new Error("Invalid phone");
    await selectMethod(page, command.action === "login_password" ? "password" : "sms");
    const country = visible(page.getByRole("combobox", { name: "国家/地区" }));
    if (await country.isVisible() && (await country.inputValue()) !== "+86") throw new Error("Unsupported country code");
    await field(page, "请输入手机号").fill(command.phone!);
  }
  if (command.action === "request_sms") { await clickText(page, "获取验证码"); return; }
  if (command.action === "login_password") {
    if (!command.password || command.password.length > 128) throw new Error("Invalid password");
    await field(page, "请输入密码").fill(command.password);
  } else {
    if (!/^\d{4,8}$/.test(command.code || "")) throw new Error("Invalid code");
    await field(page, "请输入验证码").fill(command.code!);
  }
  // Creator login labels vary by platform rollout (SMS may also register a new account).
  const submit = visible(page.getByText(/^(登录|登录\/注册)$/));
  await submit.click({ timeout: 5000 }); // Only follows an explicit, terms-confirmed user command.
}
async function feedback(page: Page, fallback: string) {
  for (const hint of ["密码错误", "账号或密码错误", "验证码错误", "验证码已过期", "操作频繁", "请完成验证", "安全验证", "二维码已失效"])
    if (await page.getByText(hint, { exact: false }).filter({ visible: true }).count()) return hint + "，请在抖音页面确认后重试或更换登录方式";
  return fallback;
}
export async function runLoginBrowser(
  request: { kind: "login" | "check"; payload?: { method?: string }; credential?: any },
  nextControl: NextControl, emit: Emit,
): Promise<LoginResult> {
  let browser: Browser | undefined, stage: LoginStage = "browser_start";
  const progress = async (next: LoginStage) => { stage = next; await emit({ type: "progress", phase: next, detail: loginStageLabels[next] }); };
  try {
    await progress("browser_start");
    browser = await chromium.launch({ channel: process.env.MATRIX_LOGIN_BROWSER_CHANNEL || "msedge", headless: true });
    const context = await browser.newContext({ storageState: request.credential, viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    if (request.kind === "check") {
      try {
        await page.goto(CREATOR + "creator-micro/home", { waitUntil: "domcontentloaded", timeout: 45000 });
        for (let i = 0; i < 15; i++) {
          if (await hasLiveSession(page, context)) return { state: "submitted", detail: "平台登录状态检查通过，登录态已刷新保存", credential: await savedState(context) };
          if ((await nextControl())?.action === "cancel") return { state: "cancelled", detail: "已取消状态检查" };
          await page.waitForTimeout(1000);
        }
        const verification = await detectIdentityChallenge(page) || await page.getByText(/安全验证|请完成验证/).filter({ visible: true }).count();
        const loginForm = await field(page, "请输入手机号").isVisible() || await page.getByText("扫码登录", { exact: true }).filter({ visible: true }).count() > 0;
        const checkStatus = verification ? "verification_required" : loginForm ? "expired" : "check_failed";
        return { state: "failed", checkStatus, detail: verification ? "平台要求安全验证，请重新登录处理" : loginForm ? "平台要求重新登录；保存的登录态已失效" : "暂时无法确认登录状态；保留原登录态，可稍后检查" };
      } catch { return { state: "failed", checkStatus: "check_failed", detail: "网络或浏览器异常，无法确认登录状态；已保留原登录态" }; }
    }
    let method = request.payload?.method || "qr";
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await openLogin(page, method, progress); break; }
      catch (error) {
        if (attempt === 1 || !(error instanceof LoginBrowserError) || !["page_open", "login_panel"].includes(error.stage)) throw error;
        if ((await nextControl())?.action === "cancel") return { state: "cancelled", detail: "已取消登录" };
        await emit({ type: "progress", phase: "page_open", detail: "抖音页面加载未完成，正在重新连接一次" });
      }
    }
    await progress("session_read");
    let lastImage = 0, lastSms = 0, notice = "", identityInProgress = false, lastStatus = "";
    const end = Date.now() + 10 * 60 * 1000;
    while (Date.now() < end) {
      const command = await nextControl();
      if (command?.action === "cancel") return { state: "cancelled", detail: "已取消登录，未保存此次登录态" };
      if (command) {
        try {
          const sendsSms = ["request_sms", "identity_receive_sms", "identity_request_sms"].includes(command.action);
          if (sendsSms && Date.now() - lastSms < 60000) notice = "短信发送至少间隔60秒，请稍后再试";
          else {
            if (sendsSms) lastSms = Date.now();
            await applyLoginControl(page, command);
            if (command.action === "login_method") method = command.method!;
            if (command.action === "refresh_qr") method = "qr";
            notice = command.action === "request_sms" ? "已请求验证码，请查看手机；以平台提示为准" : "操作已交给抖音，请等待平台结果";
          }
        } catch { notice = "当前平台控件不可用或验证未完成，请检查截图、更换登录方式或重新登录"; }
        finally { delete command.password; delete command.code; delete command.phone; }
        lastImage = 0;
      }
      // Handle queued input before preview work; reuse this scan for session and UI state.
      const detected = await detectIdentityChallenge(page);
      if (!detected && await hasSessionEvidence(page, context)) return { state: "awaiting_identity", detail: "登录成功，请核对实际账号；确认后加密保存，重启可继续使用", credential: await savedState(context), image: await loginPicture(page) };
      if (detected) identityInProgress = true;
      const challenge = detected || (identityInProgress ? { stage: "manual", receiveSms: false, requestSms: false, submitCode: false, face: false, sendSms: false } : null);
      if (command || JSON.stringify(challenge) !== lastStatus || Date.now() - lastImage >= 1500) {
        const detail = await feedback(page, challenge ? "抖音要求追加身份验证，请在下方选择方式并由本人完成。" + notice : notice || (method === "qr" ? "请等待二维码显示后用目标抖音账号扫码；空白或失效时可刷新二维码" : "请在下方输入手机号及验证码或密码；仅用于当次抖音登录"));
        const status = { type: challenge || method !== "qr" ? "verification" : "qr", challenge, detail };
        // Capability changes reach the UI without waiting for screenshot rendering/encoding.
        await emit(status);
        lastStatus = JSON.stringify(challenge);
        await emit({ ...status, image: await loginPicture(page) });
        lastImage = Date.now();
      }
      await page.waitForTimeout(250);
    }
    return { state: "failed", detail: "登录超过10分钟，未保存此次登录态；请重新登录" };
  } catch (error) {
    throw error instanceof LoginBrowserError ? error : new LoginBrowserError(stage, error);
  } finally { await browser?.close().catch(() => {}); }
}
