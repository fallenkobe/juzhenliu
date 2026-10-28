import { test, expect } from "@playwright/test";
const origin = process.env.E2E_PRODUCTION === "1" ? "https://video-e2e.example" : "http://127.0.0.1:3100";
async function login(page: any) {
  if (process.env.E2E_PRODUCTION === "1") {
    for (const resource of ["**/api/videos/session", "**/api/publishing/accounts"]) {
      await page.route(resource, async (route: any) => {
        const response = await route.fetch({ headers: { ...route.request().headers(), origin } });
        await route.fulfill({ response });
      });
    }
  }
  await page.goto("/publishing");
  await page
    .getByLabel("矩阵流登录密码", { exact: true })
    .fill("browser-test-password-only-32-characters");
  await page.getByRole("button", { name: "登录矩阵流", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "多账号发布", exact: true }),
  ).toBeVisible();
}
test("real authenticated API: metadata persists, execution disabled, secrets never returned", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/publishing/overview")).status()).toBe(401);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page.getByLabel("账号备注", { exact: true }).fill("网页合成账号");
  await page
    .getByLabel("预期抖音号", { exact: true })
    .fill("synthetic_account");
  await page.getByRole("button", { name: "添加发布账号", exact: true }).click();
  await expect(
    page.locator(".pc-account").filter({ hasText: "网页合成账号" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "扫码登录", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(page.locator(".pc-account")).toContainText("synthetic_account");
  const response = await page.request.get("/api/publishing/overview");
  expect(response.status()).toBe(200);
  expect(await response.text()).not.toContain("credential_ciphertext");
  const data = await response.json();
  expect(
    (
      await page.request.post(
        "/api/publishing/accounts/" + data.accounts[0].id + "/login",
        {
          headers: { Origin: origin, "X-Matrix-Request": "video-analytics-v1" },
          data: { consent: true },
        },
      )
    ).status(),
  ).toBe(503);
  await page.screenshot({
    path: "test-results/publishing-personal.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("preview and unknown states require distinct explicit confirmation without auto publish", async ({
  page,
}) => {
  const id = "00000000-0000-4000-8000-000000000001";
  let state = "awaiting_publish";
  const actions: string[] = [];
  await page.route("**/api/publishing/overview", (route) =>
    route.fulfill({
      json: {
        status: {
          enabled: true,
          encryptionConfigured: true,
          workerOnline: true,
        },
        accounts: [
          {
            id,
            label: "合成账号",
            expected_handle: "synthetic",
            state: "ready",
          },
        ],
        assets: [],
        operations: [
          {
            id,
            account_id: id,
            label: "合成账号",
            kind: "publish",
            state,
            detail: "合成任务",
            created_at: new Date().toISOString(),
          },
        ],
      },
    }),
  );
  await page.route("**/api/publishing/operations/" + id, (route) => {
    if (route.request().method() === "POST") {
      actions.push(route.request().postDataJSON().action);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({
      json: {
        id,
        accountId: id,
        kind: "publish",
        state,
        detail: "合成页面，无真实抖音调用",
        image: null,
      },
    });
  });
  await login(page);
  await page.getByRole("button", { name: "查看 / 处理" }).click();
  const confirm = page.getByRole("button", { name: "确认实际页面，立即提交" });
  await expect(confirm).toBeDisabled();
  expect(actions).toEqual([]);
  await page
    .getByLabel("我已核对实际账号、视频、文案和声明，同意现在提交到抖音")
    .check();
  await confirm.click();
  expect(actions).toEqual(["confirm_publish"]);
  await page.getByRole("button", { name: "关闭任务详情" }).click();
  state = "unknown";
  await page.getByRole("button", { name: "查看 / 处理" }).click();
  const resolve = page.getByRole("button", {
    name: "确认未发布（不自动重试）",
  });
  await expect(resolve).toBeDisabled();
  await page.getByLabel("我已在抖音创作者中心人工核实该任务结果").check();
  await resolve.click();
  expect(actions).toEqual(["confirm_publish", "resolve_not_published"]);
});

test("login dialog supports method changes and clears submitted password", async ({ page }) => {
  const id = "00000000-0000-4000-8000-000000000002";
  let method = "password";
  const actions: Record<string, unknown>[] = [];
  await page.route("**/api/publishing/overview", route => route.fulfill({ json: {
    status: { enabled: false, loginEnabled: true, encryptionConfigured: true, workerOnline: true },
    accounts: [{ id, label: "登录测试", expected_handle: "fixture", state: "disconnected" }], assets: [],
    operations: [{ id, account_id: id, label: "登录测试", kind: "login", state: "waiting_verification", detail: "合成登录页面", created_at: new Date().toISOString() }],
  } }));
  await page.route("**/api/publishing/operations/" + id, route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON(); actions.push(body);
      if (body.action === "login_method") method = body.method;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { id, accountId: id, kind: "login", state: method === "qr" ? "waiting_scan" : "waiting_verification", loginMethod: method, detail: "合成登录页面", image: null } });
  });
  await login(page);
  await page.getByRole("button", { name: "查看 / 处理" }).click();
  await page.getByLabel("登录手机号", { exact: true }).fill("13800000000");
  await page.getByLabel("抖音密码", { exact: true }).fill("fixture-secret");
  const submit = page.getByRole("button", { name: "登录抖音", exact: true });
  await expect(submit).toBeDisabled();
  await page.getByLabel(/我已阅读并同意抖音/).check();
  await submit.click();
  await expect(page.getByLabel("抖音密码", { exact: true })).toHaveValue("");
  expect(actions[0]).toMatchObject({ action: "login_password", phone: "13800000000", password: "fixture-secret", confirmed: true });
  await page.getByRole("button", { name: "验证码", exact: true }).click();
  await expect(page.getByLabel("登录短信验证码", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "获取短信验证码（间隔60秒）", exact: true }).click();
  expect(actions.at(-1)?.action).toBe("request_sms");
  await page.getByRole("button", { name: "扫码", exact: true }).click();
  await expect(page.getByRole("button", { name: "刷新二维码" })).toBeVisible();
  await expect(page.getByLabel("抖音密码", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "取消此任务", exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/publishing-login-dialog.png", fullPage: true });
  await page.getByRole("button", { name: "关闭任务详情" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(actions.at(-1)?.action).toBe("close_login");
  await page.getByRole("button", { name: "查看 / 处理" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(actions.filter(a => a.action === "close_login")).toHaveLength(2);
});

test("additional identity verification replaces normal login and requires explicit user actions", async ({ page }) => {
  const id = "00000000-0000-4000-8000-000000000003";
  let stage = "choose", state = "waiting_verification";
  const preview = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  let reusedPreview = false;
  const actions: Record<string, unknown>[] = [];
  await page.route("**/api/publishing/overview", route => route.fulfill({ json: {
    status: { enabled: false, loginEnabled: true, encryptionConfigured: true, workerOnline: true }, accounts: [{ id, label: "验证测试", expected_handle: "fixture", state: "disconnected" }], assets: [],
    operations: [{ id, account_id: id, label: "验证测试", kind: "login", state, detail: "合成追加验证", created_at: new Date().toISOString() }],
  } }));
  await page.route("**/api/publishing/operations/" + id, route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON(); actions.push(body);
      if (body.action === "identity_receive_sms") stage = "manual";
      if (body.action === "identity_code") state = "awaiting_identity";
      return route.fulfill({ json: { ok: true } });
    }
    const cached = route.request().headers()["x-matrix-image-hash"] === "fixture-preview";
    reusedPreview ||= cached;
    return route.fulfill({ json: { id, accountId: id, kind: "login", state, loginMethod: "qr", imageHash: "fixture-preview", ...(cached ? {} : { image: preview }), detail: "合成追加验证", identityChallenge: state === "awaiting_identity" ? null : { stage, receiveSms: stage === "choose", submitCode: stage === "sms", requestSms: stage === "sms", face: false, sendSms: false } } });
  });
  await login(page);
  await page.getByRole("button", { name: "查看 / 处理" }).click();
  await expect(page.getByRole("heading", { name: "需要身份验证" })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新二维码" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "接收身份验证短信" })).toBeDisabled();
  expect(actions).toEqual([]);
  await page.getByLabel(/我是当前账号本人/).check();
  await page.getByRole("button", { name: "接收身份验证短信" }).click();
  await expect(page.getByLabel("身份验证码", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "提交身份验证码" })).toBeDisabled();
  await expect(page.getByText(/正在等待抖音验证码输入控件就绪/)).toBeVisible();
  await page.getByLabel("身份验证码", { exact: true }).fill("123456");
  stage = "sms";
  await expect(page.getByRole("button", { name: "提交身份验证码" })).toBeEnabled();
  await expect(page.getByLabel("身份验证码", { exact: true })).toHaveValue("123456");
  expect(reusedPreview).toBe(true);
  await expect(page.getByRole("dialog").locator("img")).toHaveAttribute("src", preview);
  await page.screenshot({ path: "test-results/publishing-identity.png" });
  await page.getByRole("button", { name: "提交身份验证码" }).click();
  await expect(page.getByRole("button", { name: "确认账号并保存登录态" })).toBeVisible();
  expect(actions.map(a => a.action)).toEqual(["identity_receive_sms", "identity_code"]);
  expect(actions[1]).toMatchObject({ code: "123456", confirmed: true });
});
