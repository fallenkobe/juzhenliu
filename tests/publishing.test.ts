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
  MATRIX_PUBLISHING_LOGIN_ENABLED: "0",
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

test("detail polling omits unchanged previews but delivers state changes and clears removed images", async () => {
  const aid = await account();
  const { operationId } = await service.startAccountOperation(token, aid, "login", { consent: true });
  const op = (await queue.claim("worker"))!;
  await queue.event(op.id, op.lease_token, { type: "qr", image: png });
  const first = await service.operationDetail(token, operationId);
  assert.equal(first.image, png);
  assert.ok(first.imageHash);
  const challenge = { stage: "sms", submitCode: true };
  await queue.event(op.id, op.lease_token, { type: "verification", challenge });
  const response = await handlePublishingRequest(new Request("http://localhost/api/publishing/operations/" + op.id, {
    headers: { "X-Matrix-Image-Hash": first.imageHash! },
  }), ["operations", op.id], token);
  const next = await response.json();
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(next, "image"), false);
  assert.equal(next.imageHash, first.imageHash);
  assert.equal(next.identityChallenge.submitCode, true);
  assert.equal(next.state, "waiting_verification");
  await assert.rejects(() => service.operationDetail(undefined, op.id, first.imageHash!), /登录/);
  assert.equal((await service.operationDetail(token, op.id, "stale-hash")).image, png);
  await service.controlOperation(token, op.id, { action: "close_login" });
  const closed = await service.operationDetail(token, op.id, first.imageHash!);
  assert.equal(closed.image, null);
  assert.equal(closed.imageHash, null);
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
  const { writeFile } = await import("node:fs/promises");
  const { spawn } = await import("node:child_process");
  const { runOperation } = await import("../packages/publishing/runner");
  const executable = resolve(process.env.MATRIX_DATA_DIR!, "synthetic-bridge.mjs");
  await writeFile(
    executable,
    `import { createInterface } from 'node:readline';
let step = 0;
const lines = createInterface({input:process.stdin});
lines.on('line', line => {
 const v = JSON.parse(line);
 if (step++ === 0) console.log(JSON.stringify({type:'preview'}));
 else if (v.action === 'confirm_publish') console.log(JSON.stringify({type:'submitting'}));
 else if (v.action === 'submit_ack') { console.log(JSON.stringify({type:'result',state:'submitted',detail:'synthetic protocol only'})); lines.close(); process.stdin.destroy(); }
 else process.exit(1);
});
`,
  );
  process.env.MATRIX_PUBLISHING_PYTHON = executable;
  process.env.MATRIX_SAU_ROOT = "/synthetic-not-upstream";
  try {
    await batch([await account("A", true)]);
    const op = (await queue.claim("worker"))!;
    const running = runOperation(op, "worker", ((_file: any, _args: any, options: any) => spawn(process.execPath, [executable], options)) as typeof spawn);
    const deadline = Date.now() + 10000;
    while (
      (await service.operationDetail(token, op.id)).state !== "awaiting_publish"
    )
      { assert.ok(Date.now() < deadline, "synthetic child did not reach preview"); await new Promise((r) => setTimeout(r, 10)); }
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

test("login-only mode claims login but never queued publishing", async () => {
  await batch([await account("publish", true)]);
  process.env.MATRIX_PUBLISHING_ENABLED = "0";
  process.env.MATRIX_PUBLISHING_LOGIN_ENABLED = "1";
  try {
    assert.equal(await queue.claim("worker"), null);
    const aid = await account("login");
    const { operationId } = await service.startAccountOperation(token, aid, "login", { consent: true, method: "password" });
    assert.equal((await queue.claim("worker"))?.id, operationId);
  } finally { process.env.MATRIX_PUBLISHING_ENABLED = "1"; process.env.MATRIX_PUBLISHING_LOGIN_ENABLED = "0"; }
});

test("password and SMS controls are terms gated, encrypted, single-use and never returned", async () => {
  const aid = await account();
  const { operationId } = await service.startAccountOperation(token, aid, "login", { consent: true, method: "password" });
  const op = (await queue.claim("worker"))!;
  await queue.event(op.id, op.lease_token, { type: "verification", image: png });
  const input = { action: "login_password", phone: "13800000000", password: "synthetic-password-only" };
  await assert.rejects(() => service.controlOperation(token, operationId, input), /协议/);
  await service.controlOperation(token, operationId, { ...input, confirmed: true });
  const [stored] = await db.query("SELECT payload,control_ciphertext FROM publishing_operations WHERE id=$1", [op.id]);
  assert.ok(!JSON.stringify(stored).includes(input.password));
  assert.ok(!JSON.stringify(await service.operationDetail(token, op.id)).includes(input.phone));
  const control = await queue.consumeControl(op.id, op.lease_token);
  assert.equal(control?.password, input.password);
  assert.equal(await queue.consumeControl(op.id, op.lease_token), null);
  await service.controlOperation(token, op.id, { action: "login_sms", phone: input.phone, code: "123456", confirmed: true });
  assert.equal((await queue.consumeControl(op.id, op.lease_token))?.code, "123456");
  await service.controlOperation(token, op.id, { action: "refresh_qr" });
  assert.equal((await service.operationDetail(token, op.id)).loginMethod, "qr");
});

test("expired identity confirmation cannot persist session", async () => {
  const aid = await account();
  await service.startAccountOperation(token, aid, "login", { consent: true });
  const op = (await queue.claim("worker"))!;
  await queue.finish(op.id, op.lease_token, { state: "awaiting_identity", credential: state, image: png, detail: "fixture" });
  await db.query("UPDATE publishing_operations SET updated_at=$2 WHERE id=$1", [op.id, new Date(Date.now()-601000).toISOString()]);
  await assert.rejects(() => service.controlOperation(token, op.id, { action: "confirm_identity", confirmed: true }));
  const [row] = await db.query("SELECT credential_ciphertext FROM publishing_accounts WHERE id=$1", [aid]);
  assert.equal(row.credential_ciphertext, null);
});

test("session checks rotate encrypted credentials; network failure preserves them", async () => {
  const aid = await account("saved", true);
  await service.startAccountOperation(token, aid, "check", {});
  let op = (await queue.claim("worker"))!;
  const rotated = { ...state, cookies: [{ ...state.cookies[0], value: "rotated-synthetic-only" }] };
  await queue.finish(op.id, op.lease_token, { state: "submitted", credential: rotated, detail: "fixture" });
  let [row] = await db.query("SELECT * FROM publishing_accounts WHERE id=$1", [aid]);
  assert.equal(row.state, "ready");
  assert.ok(row.last_checked_at && row.session_saved_at);
  assert.deepEqual(security.unseal(row.credential_ciphertext, security.OWNER_ID + ":account:" + aid), rotated);
  const ciphertext = row.credential_ciphertext;
  await service.startAccountOperation(token, aid, "check", {});
  op = (await queue.claim("worker"))!;
  await queue.finish(op.id, op.lease_token, { state: "failed", checkStatus: "check_failed", detail: "network fixture" });
  [row] = await db.query("SELECT * FROM publishing_accounts WHERE id=$1", [aid]);
  assert.equal(row.state, "check_failed");
  assert.equal(row.credential_ciphertext, ciphertext);
});

test("credential validation excludes foreign origins and empty sessions", () => {
  assert.throws(() => security.validateCredential({ cookies: [], origins: [] }));
  assert.throws(() => security.validateCredential({ ...state, origins: [{ origin: "https://evil.test" }] }));
  assert.throws(() => security.validateCredential({ ...state, cookies: [{ ...state.cookies[0], domain: "evildouyin.com" }] }));
});

test("closing login fences late results and clears pending secrets even without a live worker", async () => {
  const aid = await account("existing", true);
  const [before] = await db.query("SELECT credential_ciphertext FROM publishing_accounts WHERE id=$1", [aid]);
  const { operationId } = await service.startAccountOperation(token, aid, "login", { consent: true });
  const op = (await queue.claim("worker"))!;
  await queue.event(op.id, op.lease_token, { type: "verification", image: png });
  await service.controlOperation(token, op.id, { action: "login_password", phone: "13800000000", password: "fixture-only", confirmed: true });
  await db.query("UPDATE publishing_operations SET lease_until=$2 WHERE id=$1", [op.id, new Date(0).toISOString()]);
  assert.deepEqual(await service.controlOperation(token, operationId, { action: "close_login" }), { ok: true, abandoned: true });
  assert.equal(await queue.heartbeat("worker", op.id, op.lease_token), false);
  assert.equal(await queue.finish(op.id, op.lease_token, { state: "awaiting_identity", credential: state, image: png, detail: "late result" }), false);
  const [closed] = await db.query("SELECT * FROM publishing_operations WHERE id=$1", [op.id]);
  assert.equal(closed.state, "cancelled");
  for (const key of ["pending_credential", "image_data", "control_ciphertext", "lease_token", "lease_until"]) assert.equal(closed[key], null);
  const [after] = await db.query("SELECT credential_ciphertext FROM publishing_accounts WHERE id=$1", [aid]);
  assert.equal(after.credential_ciphertext, before.credential_ciphertext);
  assert.deepEqual(await service.controlOperation(token, operationId, { action: "close_login" }), { ok: true, abandoned: false });
});

test("closing queued or awaiting-identity login abandons it; closing saved login preserves it", async () => {
  for (const phase of ["queued", "awaiting_identity", "submitted"]) {
    const aid = await account(phase);
    const { operationId } = await service.startAccountOperation(token, aid, "login", { consent: true });
    if (phase !== "queued") {
      const op = (await queue.claim("worker"))!;
      await queue.finish(op.id, op.lease_token, { state: "awaiting_identity", credential: state, image: png, detail: "fixture" });
      if (phase === "submitted") await service.controlOperation(token, op.id, { action: "confirm_identity", confirmed: true });
    }
    await service.controlOperation(token, operationId, { action: "close_login" });
    assert.equal((await service.operationDetail(token, operationId)).state, phase === "submitted" ? "submitted" : "cancelled");
    const [row] = await db.query("SELECT credential_ciphertext FROM publishing_accounts WHERE id=$1", [aid]);
    assert.equal(Boolean(row.credential_ciphertext), phase === "submitted");
  }
});

test("identity verification capabilities gate encrypted commands and block ordinary login controls", async () => {
  const aid = await account();
  await service.startAccountOperation(token, aid, "login", { consent: true });
  const op = (await queue.claim("worker"))!;
  await assert.rejects(() => service.controlOperation(token, op.id, { action: "identity_receive_sms", confirmed: true }));
  await queue.event(op.id, op.lease_token, { type: "verification", image: png, challenge: { stage: "choose", receiveSms: true, face: true, sendSms: true, secret: "must-not-escape" } });
  const detail = await service.operationDetail(token, op.id);
  assert.equal(detail.identityChallenge.receiveSms, true);
  assert.equal(JSON.stringify(detail).includes("must-not-escape"), false);
  await assert.rejects(() => service.controlOperation(token, op.id, { action: "identity_receive_sms" }), /本人/);
  await assert.rejects(() => service.controlOperation(token, op.id, { action: "refresh_qr" }), /追加身份验证/);
  await service.controlOperation(token, op.id, { action: "identity_receive_sms", confirmed: true });
  assert.equal((await queue.consumeControl(op.id, op.lease_token))?.action, "identity_receive_sms");
  await queue.event(op.id, op.lease_token, { type: "verification", challenge: { stage: "sms", submitCode: true, requestSms: true } });
  await service.controlOperation(token, op.id, { action: "identity_code", code: "123456", confirmed: true });
  const [stored] = await db.query("SELECT control_ciphertext,payload FROM publishing_operations WHERE id=$1", [op.id]);
  assert.equal(JSON.stringify(stored).includes("123456"), false);
  assert.equal((await queue.consumeControl(op.id, op.lease_token))?.code, "123456");
  assert.equal(await queue.consumeControl(op.id, op.lease_token), null);
  await service.controlOperation(token, op.id, { action: "close_login" });
  assert.equal((await service.operationDetail(token, op.id)).identityChallenge, null);
});

test("login error messages identify stage without leaking browser diagnostics", async () => {
  const { LoginBrowserError, loginFailure } = await import("../packages/publishing/login-errors");
  const failure = loginFailure(new LoginBrowserError("page_open", new Error("page.goto: net::ERR_CONNECTION_CLOSED https://private.test/?token=synthetic-secret")));
  assert.match(failure.detail, /LOGIN_PAGE_OPEN/);
  assert.match(failure.detail, /ERR_CONNECTION_CLOSED/);
  assert.equal(failure.detail.includes("synthetic-secret"), false);
  assert.equal(failure.detail.includes("private.test"), false);
  assert.match(loginFailure(new LoginBrowserError("screenshot")).detail, /LOGIN_SCREENSHOT/);
});

test("startup progress updates a live login without changing state or accepting late events", async () => {
  const aid = await account();
  await service.startAccountOperation(token, aid, "login", { consent: true });
  const op = (await queue.claim("worker"))!;
  await queue.event(op.id, op.lease_token, { type: "progress", phase: "page_open", detail: "untrusted-secret" });
  const detail = await service.operationDetail(token, op.id);
  assert.equal(detail.state, "running");
  assert.match(detail.detail, /浏览器已启动/);
  assert.equal(detail.detail.includes("untrusted-secret"), false);
  await service.controlOperation(token, op.id, { action: "close_login" });
  await assert.rejects(() => queue.event(op.id, op.lease_token, { type: "progress", phase: "session_read" }));
});
