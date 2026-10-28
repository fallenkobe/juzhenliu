import type { Page, Locator } from "playwright-core";
import type { IdentityChallenge } from "./types";

const visible = (l: Locator) => l.filter({ visible: true });
async function exposed(target: Locator) {
  return target.evaluate(el => {
    const r = el.getBoundingClientRect();
    const x = Math.max(0, r.left), y = Math.max(0, r.top);
    const right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
    if (right <= x || bottom <= y) return false;
    const top = document.elementFromPoint((x + right) / 2, (y + bottom) / 2);
    return !!top && (el.contains(top) || top.contains(el));
  }).catch(() => false);
}
async function exposedItems(items: Locator): Promise<Locator[]> {
  const result: Locator[] = [];
  for (let i = 0; i < Math.min(await items.count(), 24); i++) {
    const item = items.nth(i);
    if (await exposed(item)) result.push(item);
  }
  return result;
}
// Restrict controls to the official challenge panel, never the background login form.
async function panel(page: Page): Promise<Locator | null> {
  let fallback: Locator | null = null;
  for (const frame of page.frames()) {
    try {
      const url = new URL(frame.url());
      if (url.protocol !== "https:" || !/(^|\.)douyin\.com$/.test(url.hostname)) continue;
    } catch { continue; }
    if (frame.parentFrame()) {
      const element = await frame.frameElement().catch(() => null);
      if (!element) continue;
      const onTop = await element.evaluate(el => {
        if (!(el instanceof Element)) return false;
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!top && (el.contains(top) || top.contains(el));
      }).catch(() => false);
      await element.dispose();
      if (!onTop) continue;
    }
    const titles = await exposedItems(visible(frame.getByText(/^(身份验证|安全验证|手机号验证|短信验证|接收短信验证码|手机刷脸验证)$/)));
    for (const title of titles.reverse()) {
      // Use the nearest panel, not the first old dialog still mounted behind it.
      const container = title.locator('xpath=ancestor::*[self::div or self::section or self::form][.//input or .//*[normalize-space(text())="接收短信验证码"] or .//*[normalize-space(text())="发送短信验证"] or .//canvas or .//img][1]');
      if (!(await container.count())) continue;
      if ((await exposedItems(visible(container.getByText(/短信已发送至|验证码已发送/)))).length) return container;
      fallback ??= container;
    }
  }
  return fallback;
}
async function codeFields(scope: Locator) {
  const explicit = visible(scope.locator('input[placeholder*="验证码"],input[autocomplete="one-time-code"],input[inputmode="numeric"][maxlength="1"],input[type="tel"][maxlength="1"]'));
  const fields = await exposedItems(explicit);
  if (fields.length) return fields;
  // This fallback is restricted to a recognised SMS-receipt panel, never a generic login form.
  const smsReceipt = await visible(scope.getByText(/短信已发送至|验证码已发送/)).count() > 0;
  if (smsReceipt) return exposedItems(visible(scope.locator('input:not([type="hidden"]):not([type="password"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([disabled]):not([readonly])')));
  return fields;
}
const sendButton = (scope: Locator) => visible(scope.getByText(/^(获取验证码|发送验证码|重新获取|重新发送|重新获取验证码|重新发送验证码)$/));
const submitButton = (scope: Locator) => visible(scope.getByText(/^(验证|确认|提交|下一步|确定)$/));
export async function detectIdentityChallenge(page: Page): Promise<IdentityChallenge | null> {
  const scope = await panel(page);
  if (!scope) return null;
  const count = (await codeFields(scope)).length;
  const submitCode = count === 1 || count === 6;
  const smsReceipt = await visible(scope.getByText(/短信已发送至|验证码已发送/)).count() > 0;
  // "接收短信验证码" becomes a heading after selection, not another send action.
  const receiveSms = !submitCode && !smsReceipt && await visible(scope.getByText("接收短信验证码", { exact: true })).count() > 0;
  return {
    stage: submitCode || smsReceipt ? "sms" : receiveSms ? "choose" : "manual",
    receiveSms, submitCode,
    requestSms: await sendButton(scope).count() === 1,
    face: await visible(scope.getByText("手机刷脸验证", { exact: true })).count() > 0,
    sendSms: await visible(scope.getByText("发送短信验证", { exact: true })).count() > 0,
  };
}
export async function applyIdentityControl(page: Page, command: { action: string; code?: string; expiresAt?: number }) {
  if (command.expiresAt && command.expiresAt <= Date.now()) throw new Error("Expired identity command");
  const scope = await panel(page);
  if (!scope) throw new Error("Identity panel no longer available");
  const choices: Record<string, string> = { identity_receive_sms: "接收短信验证码", identity_face: "手机刷脸验证", identity_send_sms: "发送短信验证" };
  if (choices[command.action]) {
    if (command.action === "identity_receive_sms" && !(await detectIdentityChallenge(page))?.receiveSms)
      throw new Error("SMS method already selected");
    const target = visible(scope.getByText(choices[command.action], { exact: true }));
    if (await target.count() !== 1) throw new Error("Ambiguous identity method");
    await target.click({ timeout: 5000 }); return;
  }
  if (command.action === "identity_request_sms") {
    const target = sendButton(scope);
    if (await target.count() !== 1) throw new Error("SMS control unavailable");
    await target.click({ timeout: 5000 }); return;
  }
  if (command.action !== "identity_code" || !/^\d{4,8}$/.test(command.code || "")) throw new Error("Invalid identity code");
  const fields = await codeFields(scope), count = fields.length;
  if (count === 1) await fields[0].fill(command.code!);
  else if (count === 6 && command.code!.length === 6) {
    for (let i = 0; i < 6; i++) await fields[i].fill(command.code![i]);
  } else throw new Error("Unrecognized code controls");
  // Some platform panels auto-submit after the final digit. Never click outside this panel.
  if (!(await scope.isVisible())) return;
  const submit = submitButton(scope);
  if (await submit.count() === 1) await submit.click({ timeout: 5000 });
}
