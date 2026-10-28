import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readdir } from "node:fs/promises";
Object.assign(process.env, {
  MATRIX_DATA_DIR: resolve(".data", "publishing-test-" + randomUUID()),
  DATABASE_URL: "",
  MATRIX_OWNER_PASSWORD: "publishing-test-password-not-a-real-secret",
  MATRIX_PUBLISHING_KEY: "a".repeat(64),
  MATRIX_PUBLISHING_ENABLED: "1",
  NODE_ENV: "test",
});
delete process.env.MATRIX_PUBLIC_ORIGIN;
const { db } = await import("../packages/db/index");
const auth = await import("../packages/domain/douyin-auth");
const service = await import("../packages/publishing/service");
const queue = await import("../packages/publishing/queue");
const security = await import("../packages/publishing/security");
const { handlePublishingRequest } = await import("../packages/publishing/http");
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const state = {
  cookies: [
    {
      name: "sessionid",
      value: "synthetic-only",
      domain: ".douyin.com",
      path: "/",
    },
  ],
  origins: [],
};
let token: string;
before(async () => {
  await db.migrate();
  token = await auth.loginOwner(process.env.MATRIX_OWNER_PASSWORD);
});
after(async () => {
  await db.close();
});
beforeEach(async () => {
  for (const table of [
    "publishing_operations",
    "publishing_batches",
    "publishing_assets",
    "publishing_accounts",
    "publishing_worker",
  ])
    await db.query("DELETE FROM " + table);
});
async function account(label = "账号 A", ready = false) {
  const { accountId } = await service.addAccount(token, {
    label,
    expectedHandle: "account_a",
  });
  if (ready)
    await db.query(
      "UPDATE publishing_accounts SET state='ready',identity_confirmed_at=$2,credential_ciphertext=$3 WHERE id=$1",
      [
        accountId,
        service.stamp(),
        security.seal(state, security.OWNER_ID + ":account:" + accountId),
      ],
    );
  return accountId;
}
async function asset() {
  const { assetId } = await service.uploadAsset(
    token,
    new Request("http://localhost:3000/api/publishing/assets", {
      method: "POST",
      headers: { "content-type": "video/mp4", "x-file-name": "fixture.mp4" },
      body: Buffer.from([
        0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0,
      ]),
    }),
  );
  return assetId;
}
async function batch(ids: string[], extras: Record<string, unknown> = {}) {
  return service.createBatch(token, {
    assetId: await asset(),
    title: "测试标题",
    description: "测试描述",
    accountIds: ids,
    tags: [],
    confirmed: true,
    requestKey: randomUUID(),
    ...extras,
  });
}
function request(
  path: string,
  body?: unknown,
  origin = "http://localhost:3000",
) {
  return new Request("http://localhost:3000/api/publishing/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      host: "localhost:3000",
      origin,
      "X-Matrix-Request": "video-analytics-v1",
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
test("publishing API authenticates before all reads/writes and validates origin", async () => {
  assert.equal(
    (await handlePublishingRequest(request("overview"), ["overview"])).status,
    401,
  );
  assert.equal(
    (
      await handlePublishingRequest(
        request(
          "accounts",
          { label: "x", expectedHandle: "x" },
          "https://evil.test",
        ),
        ["accounts"],
        token,
      )
    ).status,
    403,
  );
  assert.equal(
    (await handlePublishingRequest(request("overview"), ["overview"], token))
      .status,
    200,
  );
});
test("accounts are independent from public account records; duplicate labels rejected", async () => {
  await account();
  await assert.rejects(() => account(), /已存在/);
  const view = await service.overview(token);
  assert.equal(view.accounts.length, 1);
  assert.equal(view.accounts[0].state, "disconnected");
  assert.equal("credential_ciphertext" in view.accounts[0], false);
});
test("login requires explicit credential-storage consent and feature configuration", async () => {
  const aid = await account();
  await assert.rejects(
    () => service.startAccountOperation(token, aid, "login", {}),
    /确认/,
  );
  process.env.MATRIX_PUBLISHING_ENABLED = "0";
  await assert.rejects(
    () => service.startAccountOperation(token, aid, "login", { consent: true }),
    /未启用/,
  );
  process.env.MATRIX_PUBLISHING_ENABLED = "1";
});
test("login result requires screenshot identity confirmation; credentials encrypted and scoped", async () => {
  const aid = await account();
  const { operationId } = await service.startAccountOperation(
    token,
    aid,
    "login",
    { consent: true },
  );
  const op = await queue.claim("worker-a");
  assert.equal(op?.id, operationId);
  await queue.finish(op!.id, op!.lease_token, {
    state: "awaiting_identity",
    detail: "核对身份",
    credential: state,
    image: png,
  });
  let [record] = await db.query(
    "SELECT * FROM publishing_accounts WHERE id=$1",
    [aid],
  );
  assert.equal(record.credential_ciphertext, null);
  await assert.rejects(
    () =>
      service.controlOperation(token, operationId, {
        action: "confirm_identity",
      }),
    /核对/,
  );
  await service.controlOperation(token, operationId, {
    action: "confirm_identity",
    confirmed: true,
  });
  [record] = await db.query("SELECT * FROM publishing_accounts WHERE id=$1", [
    aid,
  ]);
  assert.equal(record.state, "ready");
  assert.equal(record.epoch, 1);
  assert.ok(!record.credential_ciphertext.includes("synthetic-only"));
  assert.deepEqual(
    security.unseal(
      record.credential_ciphertext,
      security.OWNER_ID + ":account:" + aid,
    ),
    state,
  );
  assert.throws(() =>
    security.unseal(record.credential_ciphertext, "other-owner"),
  );
  const detail = await service.operationDetail(token, operationId);
  assert.equal(detail.image, null);
  assert.equal(JSON.stringify(detail).includes("synthetic-only"), false);
});
test("cannot create a publish batch with merely added or foreign accounts", async () => {
  const aid = await account();
  await assert.rejects(() => batch([aid]), /尚未登录/);
  await assert.rejects(() => batch([randomUUID()]), /不存在/);
});
test("explicit publish confirmation and idempotency persist one child per account", async () => {
  const a = await account("A", true),
    b = await account("B", true),
    assetId = await asset(),
    requestKey = randomUUID();
  const body = {
    assetId,
    title: "标题",
    description: "",
    accountIds: [a, b, a],
    tags: [],
    requestKey,
  };
  await assert.rejects(() => service.createBatch(token, body), /明确确认/);
  const first = await service.createBatch(token, { ...body, confirmed: true });
  const repeat = await service.createBatch(token, { ...body, confirmed: true });
  assert.equal(first.batchId, repeat.batchId);
  assert.equal(repeat.reused, true);
  assert.equal((await service.overview(token)).operations.length, 2);
  await assert.rejects(
    () =>
      service.createBatch(token, {
        ...body,
        title: "另一个标题",
        confirmed: true,
      }),
    /其他内容/,
  );
});
test("MP4 upload validates magic and safely removes rejected files", async () => {
  await assert.rejects(
    () =>
      service.uploadAsset(
        token,
        new Request("http://localhost", {
          method: "POST",
          headers: { "content-type": "video/mp4" },
          body: "not-video",
        }),
      ),
    /MP4/,
  );
  assert.equal((await service.overview(token)).assets.length, 0);
  const list = await readdir(service.assetDirectory());
  assert.ok(!list.some((x) => x.includes("..")));
});
test("multiple workers cannot claim the same owner concurrently", async () => {
  await batch([await account("A", true), await account("B", true)]);
  const one = await queue.claim("worker-one");
  assert.ok(one);
  const two = await queue.claim("worker-two");
  assert.equal(two, null);
  assert.equal(
    await queue.heartbeat("worker-two", one!.id, one!.lease_token),
    false,
  );
});
test("lease expiry fences late events/finish and makes a publish result unknown", async () => {
  await batch([await account("A", true)]);
  const op = await queue.claim("old-worker");
  await db.query(
    "UPDATE publishing_operations SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=$1",
    [op!.id],
  );
  await db.query(
    "UPDATE publishing_worker SET lease_until='2000-01-01T00:00:00.000Z'",
  );
  await assert.rejects(
    () => queue.event(op!.id, op!.lease_token, { type: "submitting" }),
    /lease/,
  );
  assert.equal(
    await queue.finish(op!.id, op!.lease_token, {
      state: "submitted",
      detail: "late",
    }),
    false,
  );
  await queue.claim("new-worker");
  const detail = await service.operationDetail(token, op!.id);
  assert.equal(detail.state, "unknown");
  await assert.rejects(
    () => service.controlOperation(token, op!.id, { action: "cancel" }),
    /不能撤销/,
  );
});
test("unknown outcome blocks later work for that same account, not another account", async () => {
  const a = await account("A", true),
    b = await account("B", true);
  await batch([a]);
  const op = await queue.claim("worker");
  await queue.finish(op!.id, op!.lease_token, {
    state: "unknown",
    detail: "needs verification",
  });
  await batch([a]);
  await batch([b]);
  const next = await queue.claim("worker");
  assert.equal(next?.account_id, b);
});
test("disconnect clears credentials and cancels queued operations", async () => {
  const a = await account("A", true);
  await batch([a]);
  await service.disconnectAccount(token, a);
  const view = await service.overview(token);
  assert.equal(view.accounts[0].state, "disconnected");
  assert.equal(view.operations[0].state, "cancelled");
  const [row] = await db.query(
    "SELECT credential_ciphertext FROM publishing_accounts WHERE id=$1",
    [a],
  );
  assert.equal(row.credential_ciphertext, null);
});
test("task controls are encrypted, task-bound, single-use and state restricted", async () => {
  await batch([await account("A", true)]);
  const op = await queue.claim("worker");
  await assert.rejects(
    () =>
      service.controlOperation(token, op!.id, {
        action: "sms_code",
        code: "123456",
      }),
    /无效/,
  );
  await queue.event(op!.id, op!.lease_token, {
    type: "verification",
    image: png,
  });
  await service.controlOperation(token, op!.id, {
    action: "sms_code",
    code: "123456",
  });
  const [row] = await db.query(
    "SELECT control_ciphertext FROM publishing_operations WHERE id=$1",
    [op!.id],
  );
  assert.ok(!row.control_ciphertext.includes("123456"));
  assert.equal(
    (await queue.consumeControl(op!.id, op!.lease_token))?.code,
    "123456",
  );
  assert.equal(await queue.consumeControl(op!.id, op!.lease_token), null);
});
test("actual browser preview requires a new explicit confirmation", async () => {
  await batch([await account("A", true)]);
  const op = await queue.claim("worker");
  await assert.rejects(
    () =>
      service.controlOperation(token, op!.id, {
        action: "confirm_publish",
        confirmed: true,
      }),
    /实际发布页面/,
  );
  await queue.event(op!.id, op!.lease_token, { type: "preview", image: png });
  await assert.rejects(
    () =>
      service.controlOperation(token, op!.id, { action: "confirm_publish" }),
    /实际发布页面/,
  );
  await service.controlOperation(token, op!.id, {
    action: "confirm_publish",
    confirmed: true,
  });
  assert.equal(
    (await queue.consumeControl(op!.id, op!.lease_token))?.action,
    "confirm_publish",
  );
});
test("image protocol rejects URLs and non-PNG payloads", () => {
  assert.throws(() => security.safeImage("https://evil.test"));
  assert.throws(() => security.safeImage("data:image/png;base64,YmFk"));
  assert.equal(security.safeImage(png), png);
});
test("same worker cannot claim two live operations and terminal transitions are fenced", async () => {
  await batch([await account("A", true), await account("B", true)]);
  const op = (await queue.claim("worker"))!;
  assert.equal(await queue.claim("worker"), null);
  await assert.rejects(
    () =>
      queue.finish(op.id, op.lease_token, {
        state: "ready",
        detail: "invalid",
      }),
    /Invalid terminal/,
  );
  await assert.rejects(
    () =>
      queue.finish(op.id, op.lease_token, {
        state: "submitted",
        detail: "invalid",
      }),
    /not acknowledged/,
  );
  await queue.event(op.id, op.lease_token, { type: "preview", image: png });
  await assert.rejects(
    () => queue.event(op.id, op.lease_token, { type: "submitting" }),
    /Missing owner/,
  );
  await service.controlOperation(token, op.id, {
    action: "confirm_publish",
    confirmed: true,
  });
  await queue.consumeControl(op.id, op.lease_token);
  await queue.event(op.id, op.lease_token, { type: "submitting" });
  await assert.rejects(
    () => queue.event(op.id, op.lease_token, { type: "preview", image: png }),
    /Invalid event/,
  );
  await queue.finish(op.id, op.lease_token, {
    state: "failed",
    detail: "lost response",
  });
  assert.equal((await service.operationDetail(token, op.id)).state, "unknown");
});
test("unknown requires explicit manual resolution, never requeues original operation", async () => {
  const a = await account("A", true);
  await batch([a]);
  const op = (await queue.claim("worker"))!;
  await queue.finish(op.id, op.lease_token, {
    state: "unknown",
    detail: "uncertain",
  });
  await assert.rejects(() =>
    service.controlOperation(token, op.id, { action: "resolve_not_published" }),
  );
  await service.controlOperation(token, op.id, {
    action: "resolve_not_published",
    confirmed: true,
  });
  assert.equal((await service.operationDetail(token, op.id)).state, "failed");
  assert.equal(await queue.claim("worker"), null);
});
test("runner fails closed when upstream is not configured", async () => {
  const { runOperation } = await import("../packages/publishing/runner");
  delete process.env.MATRIX_SAU_ROOT;
  await batch([await account("A", true)]);
  const op = (await queue.claim("worker"))!;
  await runOperation(op, "worker");
  assert.equal((await service.operationDetail(token, op.id)).state, "failed");
});
test("synthetic subprocess protocol fences submit acknowledgement and records submitted", async () => {
  const { writeFile, chmod } = await import("node:fs/promises");
  const { runOperation } = await import("../packages/publishing/runner");
  const executable = resolve(process.env.MATRIX_DATA_DIR!, "synthetic-bridge");
  await writeFile(
    executable,
    `#!/usr/bin/env python3
import sys,json
json.loads(sys.stdin.readline())
print(json.dumps({'type':'preview'}),flush=True)
assert json.loads(sys.stdin.readline())['action']=='confirm_publish'
print(json.dumps({'type':'submitting'}),flush=True)
assert json.loads(sys.stdin.readline())['action']=='submit_ack'
print(json.dumps({'type':'result','state':'submitted','detail':'synthetic protocol only'}),flush=True)
`,
  );
  await chmod(executable, 0o700);
  process.env.MATRIX_PUBLISHING_PYTHON = executable;
  process.env.MATRIX_SAU_ROOT = "/synthetic-not-upstream";
  try {
    await batch([await account("A", true)]);
    const op = (await queue.claim("worker"))!;
    const running = runOperation(op, "worker");
    while (
      (await service.operationDetail(token, op.id)).state !== "awaiting_publish"
    )
      await new Promise((r) => setTimeout(r, 10));
    await service.controlOperation(token, op.id, {
      action: "confirm_publish",
      confirmed: true,
    });
    await running;
    assert.equal(
      (await service.operationDetail(token, op.id)).state,
      "submitted",
    );
  } finally {
    delete process.env.MATRIX_PUBLISHING_PYTHON;
    delete process.env.MATRIX_SAU_ROOT;
  }
});
