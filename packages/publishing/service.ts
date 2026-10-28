import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { db, dataDir, type Client } from "../db/index";
import { requireOwner } from "../domain/douyin-auth";
import { AppError } from "../domain/types";
import {
  OWNER_ID,
  enabled,
  encryptionConfigured,
  requireEnabled,
  seal,
  unseal,
  safeImage,
} from "./security";
import {
  activeStates,
  type PublishingAccount,
  type PublishingAsset,
  type PublishingOperation,
  type PublishPayload,
} from "./types";
export const stamp = () => new Date().toISOString();
const id = () => randomUUID();
const owner = OWNER_ID;
const accountColumns =
  "id,label,expected_handle,state,epoch,identity_confirmed_at,created_at,updated_at";
export const assetDirectory = () => path.join(dataDir, "publishing", "assets");
export function identifier(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value))
    throw new AppError(400, "记录编号无效");
  return value;
}
function text(value: unknown, max: number, name: string, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim()) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new AppError(400, name + "无效");
  return value.trim();
}
async function account(tx: Client, accountId: string) {
  const [a] = await tx.query(
    "SELECT * FROM publishing_accounts WHERE owner_id=$1 AND id=$2",
    [owner, identifier(accountId)],
  );
  if (!a) throw new AppError(404, "发布账号不存在");
  return a;
}
export async function status(token: string | undefined) {
  await requireOwner(token);
  const [w] = await db.query(
    "SELECT updated_at,lease_until FROM publishing_worker WHERE owner_id=$1",
    [owner],
  );
  return {
    enabled: enabled(),
    encryptionConfigured: encryptionConfigured(),
    workerOnline: !!w && w.lease_until > stamp(),
    workerUpdatedAt: w?.updated_at ?? null,
    mode: "personal",
    requiresPageConfirmation: true,
  };
}
export async function overview(token: string | undefined) {
  await requireOwner(token);
  return {
    status: await status(token),
    accounts: await db.query<PublishingAccount>(
      `SELECT ${accountColumns} FROM publishing_accounts WHERE owner_id=$1 ORDER BY created_at DESC`,
      [owner],
    ),
    assets: await db.query<PublishingAsset>(
      "SELECT id,filename,mime,bytes,created_at FROM publishing_assets WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100",
      [owner],
    ),
    operations: await db.query<PublishingOperation>(
      `SELECT o.id,o.account_id,o.batch_id,o.kind,o.state,o.detail,o.created_at,o.updated_at,a.label FROM publishing_operations o JOIN publishing_accounts a ON o.account_id=a.id AND o.owner_id=a.owner_id WHERE o.owner_id=$1 ORDER BY o.created_at DESC LIMIT 100`,
      [owner],
    ),
  };
}
export async function addAccount(
  token: string | undefined,
  body: Record<string, unknown>,
) {
  await requireOwner(token);
  const label = text(body.label, 60, "备注", true),
    handle = text(body.expectedHandle, 40, "预期抖音号", true);
  if (!/^[A-Za-z0-9_.-]+$/.test(handle))
    throw new AppError(400, "预期抖音号格式无效");
  return db.transaction(null, async (tx) => {
    const list = await tx.query(
      "SELECT id,label FROM publishing_accounts WHERE owner_id=$1",
      [owner],
    );
    if (list.length >= 20)
      throw new AppError(409, "自用版最多保存 20 个发布账号");
    if (list.some((x) => x.label === label))
      throw new AppError(409, "账号备注已存在");
    const accountId = id(),
      now = stamp();
    await tx.query(
      "INSERT INTO publishing_accounts(id,owner_id,label,expected_handle,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)",
      [accountId, owner, label, handle, now],
    );
    return { accountId };
  });
}
export async function disconnectAccount(
  token: string | undefined,
  accountId: string,
) {
  await requireOwner(token);
  return db.transaction(null, async (tx) => {
    await account(tx, accountId);
    const busy = await tx.query(
      "SELECT id FROM publishing_operations WHERE owner_id=$1 AND account_id=$2 AND state IN ('running','waiting_scan','waiting_verification','awaiting_identity','awaiting_publish','submitting')",
      [owner, accountId],
    );
    if (busy.length) throw new AppError(409, "请先结束该账号当前任务");
    await tx.query(
      "UPDATE publishing_operations SET state='cancelled',detail='账号已断开',updated_at=$3 WHERE owner_id=$1 AND account_id=$2 AND state='queued'",
      [owner, accountId, stamp()],
    );
    await tx.query(
      "UPDATE publishing_accounts SET credential_ciphertext=NULL,state='disconnected',epoch=epoch+1,identity_confirmed_at=NULL,updated_at=$3 WHERE owner_id=$1 AND id=$2",
      [owner, accountId, stamp()],
    );
    return { ok: true };
  });
}
export async function startAccountOperation(
  token: string | undefined,
  accountId: string,
  kind: "login" | "check",
  body: Record<string, unknown>,
) {
  await requireOwner(token);
  requireEnabled();
  if (kind === "login" && body.consent !== true)
    throw new AppError(400, "请确认扫码并将登录态加密保存在此服务器");
  return db.transaction(null, async (tx) => {
    const a = await account(tx, accountId);
    const active = await tx.query(
      `SELECT id FROM publishing_operations WHERE owner_id=$1 AND account_id=$2 AND state IN (${activeStates.map((s) => `'${s}'`).join(",")})`,
      [owner, accountId],
    );
    if (active.length) throw new AppError(409, "账号已有未完成任务");
    if (kind === "check" && !a.credential_ciphertext)
      throw new AppError(409, "请先登录账号");
    const op = id(),
      now = stamp();
    await tx.query(
      "INSERT INTO publishing_operations(id,owner_id,account_id,kind,state,payload,credential_epoch,detail,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)",
      [
        op,
        owner,
        accountId,
        kind,
        "queued",
        "{}",
        a.epoch,
        "等待发布执行器",
        now,
      ],
    );
    return { operationId: op };
  });
}
export async function uploadAsset(token: string | undefined, req: Request) {
  await requireOwner(token);
  const mime = req.headers.get("content-type")?.split(";")[0] ?? "";
  if (mime !== "video/mp4") throw new AppError(415, "第一版仅支持 MP4 视频");
  let filename: string;
  try {
    filename = decodeURIComponent(
      req.headers.get("x-file-name") || "video.mp4",
    );
  } catch {
    throw new AppError(400, "文件名无效");
  }
  filename = text(
    path.basename(filename.replace(/\\/g, "/")),
    160,
    "文件名",
    true,
  );
  const max = 100 * 1024 * 1024;
  const length = Number(req.headers.get("content-length"));
  if (length > max) throw new AppError(413, "视频最大 100 MB");
  const reader = req.body?.getReader();
  if (!reader) throw new AppError(400, "文件为空");
  const assetId = id();
  await mkdir(assetDirectory(), { recursive: true, mode: 0o700 });
  const filePath = path.join(assetDirectory(), assetId + ".mp4"),
    file = await open(filePath, "wx", 0o600);
  let bytes = 0,
    head = Buffer.alloc(0);
  const hash = createHash("sha256");
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > max) {
        await reader.cancel();
        throw new AppError(413, "视频最大 100 MB");
      }
      const b = Buffer.from(part.value);
      if (head.length < 32) head = Buffer.concat([head, b]).subarray(0, 32);
      hash.update(b);
      await file.write(b);
    }
    if (bytes < 12 || head.subarray(4, 8).toString() !== "ftyp")
      throw new AppError(400, "文件不是有效的 MP4 容器");
    await file.close();
    await requireOwner(token);
    await db.transaction(null, async (tx) => {
      const [usage] = await tx.query(
        "SELECT COALESCE(SUM(bytes),0) AS used FROM publishing_assets WHERE owner_id=$1",
        [owner],
      );
      if (Number(usage.used) + bytes > 1024 * 1024 * 1024)
        throw new AppError(409, "素材空间已达 1 GB，请管理员清理后再上传");
      await tx.query(
        "INSERT INTO publishing_assets VALUES($1,$2,$3,$4,$5,$6,$7)",
        [assetId, owner, filename, mime, bytes, hash.digest("hex"), stamp()],
      );
    });
    return { assetId };
  } catch (e) {
    await file.close().catch(() => {});
    await unlink(filePath).catch(() => {});
    throw e;
  } finally {
    reader.releaseLock();
  }
}
function parsePayload(body: Record<string, unknown>): PublishPayload {
  const tags = body.tags ?? [];
  if (
    !Array.isArray(tags) ||
    tags.length > 5 ||
    tags.some(
      (t) =>
        typeof t !== "string" || !t.trim() || t.length > 20 || /[\s#]/.test(t),
    )
  )
    throw new AppError(400, "最多 5 个话题，每个不超过 20 字且不含空格或 #");
  const declaration = body.declaration ?? null;
  if (declaration !== null && declaration !== "内容由AI生成")
    throw new AppError(400, "声明选项无效");
  return {
    assetId: identifier(body.assetId),
    title: text(body.title, 30, "标题", true),
    description: text(body.description ?? "", 1000, "描述"),
    tags: tags as string[],
    declaration,
  };
}
export async function createBatch(
  token: string | undefined,
  body: Record<string, unknown>,
) {
  await requireOwner(token);
  requireEnabled();
  if (body.confirmed !== true)
    throw new AppError(400, "请明确确认所选账号、素材和文案");
  const requestKey = identifier(body.requestKey),
    payload = parsePayload(body);
  if (
    !Array.isArray(body.accountIds) ||
    !body.accountIds.length ||
    body.accountIds.length > 20
  )
    throw new AppError(400, "请选择 1–20 个账号");
  const accountIds = [...new Set(body.accountIds.map(identifier))].sort();
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ accountIds, payload }))
    .digest("hex");
  return db.transaction(null, async (tx) => {
    const [existing] = await tx.query(
      "SELECT id,fingerprint FROM publishing_batches WHERE owner_id=$1 AND request_key=$2",
      [owner, requestKey],
    );
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new AppError(409, "请求编号已用于其他内容");
      return { batchId: existing.id, reused: true };
    }
    const [asset] = await tx.query(
      "SELECT id FROM publishing_assets WHERE owner_id=$1 AND id=$2",
      [owner, payload.assetId],
    );
    if (!asset) throw new AppError(404, "素材不存在");
    const [size] = await tx.query(
      "SELECT COUNT(*) AS n FROM publishing_operations WHERE owner_id=$1 AND state IN ('queued','running','waiting_scan','waiting_verification','awaiting_identity','awaiting_publish','submitting')",
      [owner],
    );
    if (Number(size.n) + accountIds.length > 100)
      throw new AppError(429, "未完成任务最多 100 个");
    const accounts = [];
    for (const aid of accountIds) {
      const a = await account(tx, aid);
      if (
        a.state !== "ready" ||
        !a.credential_ciphertext ||
        !a.identity_confirmed_at
      )
        throw new AppError(409, `${a.label} 尚未登录并核对身份`);
      accounts.push(a);
    }
    const batchId = id(),
      now = stamp();
    await tx.query("INSERT INTO publishing_batches VALUES($1,$2,$3,$4,$5)", [
      batchId,
      owner,
      requestKey,
      fingerprint,
      now,
    ]);
    for (const a of accounts) {
      await tx.query(
        "INSERT INTO publishing_operations(id,owner_id,account_id,batch_id,kind,state,payload,credential_epoch,detail,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)",
        [
          id(),
          owner,
          a.id,
          batchId,
          "publish",
          "queued",
          JSON.stringify(payload),
          a.epoch,
          "等待发布执行器",
          now,
        ],
      );
    }
    return { batchId, reused: false };
  });
}
export async function operationDetail(
  token: string | undefined,
  operationId: string,
) {
  await requireOwner(token);
  const [op] = await db.query(
    "SELECT id,kind,state,detail,image_data,updated_at,account_id FROM publishing_operations WHERE owner_id=$1 AND id=$2",
    [owner, identifier(operationId)],
  );
  if (!op) throw new AppError(404, "任务不存在");
  return {
    id: op.id,
    kind: op.kind,
    state: op.state,
    detail: op.detail,
    image: op.image_data,
    updatedAt: op.updated_at,
    accountId: op.account_id,
  };
}
export async function controlOperation(
  token: string | undefined,
  operationId: string,
  body: Record<string, unknown>,
) {
  await requireOwner(token);
  return db.transaction(null, async (tx) => {
    const [op] = await tx.query(
      "SELECT * FROM publishing_operations WHERE owner_id=$1 AND id=$2",
      [owner, identifier(operationId)],
    );
    if (!op) throw new AppError(404, "任务不存在");
    const now = stamp(),
      action = body.action;
    if (action === "resolve_submitted" || action === "resolve_not_published") {
      if (op.state !== "unknown" || body.confirmed !== true)
        throw new AppError(409, "请先到抖音核实后明确确认");
      await tx.query(
        "UPDATE publishing_operations SET state=$3,detail=$4,updated_at=$5 WHERE owner_id=$1 AND id=$2",
        [
          owner,
          op.id,
          action === "resolve_submitted" ? "submitted" : "failed",
          action === "resolve_submitted"
            ? "所有者人工核实已提交；审核结果以抖音为准"
            : "所有者人工核实未发布；不会自动重试，需另建任务",
          now,
        ],
      );
      return { ok: true };
    }
    if (action === "cancel") {
      if (op.state === "queued") {
        await tx.query(
          "UPDATE publishing_operations SET state='cancelled',detail='用户取消',updated_at=$3 WHERE owner_id=$1 AND id=$2",
          [owner, op.id, now],
        );
        return { ok: true };
      }
      if (
        ![
          "running",
          "waiting_scan",
          "waiting_verification",
          "awaiting_identity",
          "awaiting_publish",
        ].includes(op.state)
      )
        throw new AppError(409, "已提交或结果不明的任务不能撤销，请到抖音核实");
    } else if (action === "confirm_identity") {
      if (
        op.state !== "awaiting_identity" ||
        !op.pending_credential ||
        body.confirmed !== true
      )
        throw new AppError(409, "请核对当前账号页面后确认");
      const credential = unseal(
        op.pending_credential,
        owner + ":pending:" + op.id,
      );
      await tx.query(
        "UPDATE publishing_accounts SET credential_ciphertext=$3,state='ready',epoch=epoch+1,identity_confirmed_at=$4,updated_at=$4 WHERE owner_id=$1 AND id=$2",
        [
          owner,
          op.account_id,
          seal(credential, owner + ":account:" + op.account_id),
          now,
        ],
      );
      await tx.query(
        "UPDATE publishing_operations SET state='submitted',detail='登录态已加密保存；身份由所有者核对，非机器认证',pending_credential=NULL,image_data=NULL,control_ciphertext=NULL,lease_token=NULL,lease_until=NULL,updated_at=$3 WHERE owner_id=$1 AND id=$2",
        [owner, op.id, now],
      );
      return { ok: true };
    } else if (action === "confirm_publish") {
      if (op.state !== "awaiting_publish" || body.confirmed !== true)
        throw new AppError(409, "请先核对实际发布页面");
    } else if (action === "sms_code") {
      if (
        op.state !== "waiting_verification" ||
        typeof body.code !== "string" ||
        !/^\d{4,8}$/.test(body.code)
      )
        throw new AppError(400, "当前验证码无效");
    } else if (action === "request_sms") {
      if (op.state !== "waiting_verification")
        throw new AppError(409, "当前没有等待短信验证");
    } else throw new AppError(400, "不支持的操作");
    if (op.state === "awaiting_identity" && action === "cancel") {
      await tx.query(
        "UPDATE publishing_operations SET state='cancelled',pending_credential=NULL,image_data=NULL,detail='未保存此次登录',updated_at=$3 WHERE owner_id=$1 AND id=$2",
        [owner, op.id, now],
      );
      return { ok: true };
    }
    if (!op.lease_until || op.lease_until <= now)
      throw new AppError(409, "执行器已离线，请刷新任务状态");
    if (op.control_ciphertext) throw new AppError(409, "上一步操作正在处理");
    await tx.query(
      "UPDATE publishing_operations SET control_ciphertext=$3,updated_at=$4 WHERE owner_id=$1 AND id=$2",
      [
        owner,
        op.id,
        seal(
          {
            action,
            ...(action === "sms_code" ? { code: body.code } : {}),
            expiresAt: Date.now() + 60000,
          },
          owner + ":control:" + op.id,
        ),
        now,
      ],
    );
    return { ok: true };
  });
}
