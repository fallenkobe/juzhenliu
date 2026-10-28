import { test, expect } from "@playwright/test";
const origin = "http://127.0.0.1:3100";
async function login(page: any) {
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
