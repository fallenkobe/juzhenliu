import { randomUUID } from "node:crypto";
import { db, type Row } from "../db/index";
export interface ClaimedOperation extends Row {
  id: string;
  account_id: string;
  kind: string;
  payload: string;
  lease_token: string;
  account: Row;
}
import { OWNER_ID, seal, unseal, safeImage } from "./security";
import { stamp } from "./service";
const owner = OWNER_ID;
const until = () => new Date(Date.now() + 30000).toISOString();
// One lease per owner intentionally serializes first-version browser work, even across multiple worker processes.
export async function claim(
  instanceId: string,
): Promise<ClaimedOperation | null> {
  return db.transaction(null, async (tx) => {
    if (process.env.DATABASE_URL)
      await tx.query("SELECT pg_advisory_xact_lock(91001008)");
    const now = stamp();
    const expired = await tx.query(
      "SELECT id,kind,state FROM publishing_operations WHERE owner_id=$1 AND lease_until<=$2 AND state IN ('running','waiting_scan','waiting_verification','awaiting_publish','submitting')",
      [owner, now],
    );
    for (const op of expired) {
      await tx.query(
        "UPDATE publishing_operations SET state=$3,detail=$4,lease_token=NULL,lease_until=NULL,control_ciphertext=NULL,image_data=NULL,pending_credential=NULL,updated_at=$5 WHERE owner_id=$1 AND id=$2",
        [
          owner,
          op.id,
          op.kind === "publish" ? "unknown" : "failed",
          op.kind === "publish"
            ? "执行器中断，禁止自动重发；请到抖音核实"
            : "执行器中断，请重新发起登录或检查",
          now,
        ],
      );
    }
    await tx.query(
      "UPDATE publishing_operations SET state='failed',pending_credential=NULL,image_data=NULL,detail='身份确认已过期，请重新登录',updated_at=$2 WHERE owner_id=$1 AND state='awaiting_identity' AND updated_at<$3",
      [owner, now, new Date(Date.now() - 600000).toISOString()],
    );
    const [lock] = await tx.query(
      "SELECT instance_id,lease_until FROM publishing_worker WHERE owner_id=$1",
      [owner],
    );
    if (lock && lock.lease_until > now && lock.instance_id !== instanceId)
      return null;
    await tx.query(
      "INSERT INTO publishing_worker VALUES($1,$2,$3,$4) ON CONFLICT(owner_id) DO UPDATE SET instance_id=excluded.instance_id,lease_until=excluded.lease_until,updated_at=excluded.updated_at",
      [owner, instanceId, until(), now],
    );
    const live = await tx.query(
      "SELECT id FROM publishing_operations WHERE owner_id=$1 AND lease_token IS NOT NULL AND lease_until>$2",
      [owner, now],
    );
    if (live.length) return null;
    const [op] = await tx.query<ClaimedOperation>(
      "SELECT o.* FROM publishing_operations o WHERE o.owner_id=$1 AND o.state='queued' AND NOT EXISTS(SELECT 1 FROM publishing_operations p WHERE p.owner_id=o.owner_id AND p.account_id=o.account_id AND p.state IN ('unknown','awaiting_identity')) ORDER BY o.created_at,o.id LIMIT 1",
      [owner],
    );
    if (!op) return null;
    const [a] = await tx.query(
      "SELECT * FROM publishing_accounts WHERE owner_id=$1 AND id=$2",
      [owner, op.account_id],
    );
    if (
      !a ||
      Number(op.credential_epoch) !== Number(a.epoch) ||
      (op.kind === "publish" && a.state !== "ready")
    ) {
      await tx.query(
        "UPDATE publishing_operations SET state='failed',detail='登录态已改变，请重新确认任务',updated_at=$3 WHERE owner_id=$1 AND id=$2",
        [owner, op.id, now],
      );
      return null;
    }
    const lease = randomUUID();
    await tx.query(
      "UPDATE publishing_operations SET state='running',lease_token=$3,lease_until=$4,detail='执行器已领取',updated_at=$5 WHERE owner_id=$1 AND id=$2",
      [owner, op.id, lease, until(), now],
    );
    return { ...op, lease_token: lease, account: a };
  });
}
export async function heartbeat(
  instanceId: string,
  operationId?: string,
  lease?: string,
) {
  const now = stamp(),
    end = until();
  return db.transaction(null, async (tx) => {
    const rows = await tx.query(
      "UPDATE publishing_worker SET lease_until=$3,updated_at=$4 WHERE owner_id=$1 AND instance_id=$2 AND lease_until>$4 RETURNING owner_id",
      [owner, instanceId, end, now],
    );
    if (!rows.length) return false;
    if (operationId) {
      const changed = await tx.query(
        "UPDATE publishing_operations SET lease_until=$4 WHERE owner_id=$1 AND id=$2 AND lease_token=$3 AND lease_until>$5 RETURNING id",
        [owner, operationId, lease!, end, now],
      );
      if (!changed.length) return false;
    }
    return true;
  });
}
export async function consumeControl(operationId: string, lease: string) {
  return db.transaction(null, async (tx) => {
    const [op] = await tx.query(
      "SELECT control_ciphertext FROM publishing_operations WHERE owner_id=$1 AND id=$2 AND lease_token=$3 AND lease_until>$4",
      [owner, operationId, lease, stamp()],
    );
    if (!op?.control_ciphertext) return null;
    await tx.query(
      "UPDATE publishing_operations SET control_ciphertext=NULL WHERE owner_id=$1 AND id=$2 AND lease_token=$3",
      [owner, operationId, lease],
    );
    const value = unseal<{ action: string; code?: string; expiresAt: number }>(
      op.control_ciphertext,
      owner + ":control:" + operationId,
    );
    if (value.expiresAt <= Date.now()) return null;
    if (value.action === "confirm_publish")
      await tx.query(
        "UPDATE publishing_operations SET submission_authorized=1 WHERE owner_id=$1 AND id=$2 AND lease_token=$3 AND state='awaiting_publish'",
        [owner, operationId, lease],
      );
    return value;
  });
}
export async function event(
  operationId: string,
  lease: string,
  value: Record<string, unknown>,
) {
  const states: Record<string, string> = {
    qr: "waiting_scan",
    verification: "waiting_verification",
    preview: "awaiting_publish",
    submitting: "submitting",
  };
  const labels: Record<string, string> = {
    qr: "请用目标抖音账号扫码",
    verification: "请在当前任务处理短信验证；其他验证需人工接管",
    preview: "请核对实际页面的账号、文案和声明，然后确认发布",
    submitting: "已开始提交，请勿重复操作",
  };
  const kind = String(value.type);
  if (!states[kind]) return;
  const image = value.image ? safeImage(value.image) : null;
  const allowedFrom: Record<string, string[]> = {
    qr: ["running", "waiting_scan", "waiting_verification"],
    verification: [
      "running",
      "waiting_scan",
      "waiting_verification",
      "awaiting_publish",
    ],
    preview: ["running", "waiting_verification", "awaiting_publish"],
    submitting: ["awaiting_publish"],
  };
  return db.transaction(null, async (tx) => {
    const [op] = await tx.query(
      "SELECT kind,state,submission_authorized FROM publishing_operations WHERE owner_id=$1 AND id=$2 AND lease_token=$3 AND lease_until>$4",
      [owner, operationId, lease, stamp()],
    );
    if (!op) throw new Error("Lost operation lease");
    if (kind === "submitting" && Number(op.submission_authorized) !== 1)
      throw new Error("Missing owner confirmation");
    if (
      !allowedFrom[kind].includes(op.state) ||
      ((kind === "preview" || kind === "submitting") &&
        op.kind !== "publish") ||
      (kind === "qr" && op.kind !== "login")
    )
      throw new Error("Invalid event transition");
    const changed = await tx.query(
      "UPDATE publishing_operations SET state=$4,detail=$5,image_data=COALESCE($6,image_data),updated_at=$7 WHERE owner_id=$1 AND id=$2 AND lease_token=$3 AND lease_until>$7 RETURNING id",
      [owner, operationId, lease, states[kind], labels[kind], image, stamp()],
    );
    if (!changed.length) throw new Error("Lost operation lease");
  });
}
export async function finish(
  operationId: string,
  lease: string,
  result: {
    state: string;
    detail: string;
    credential?: unknown;
    image?: string;
  },
) {
  return db.transaction(null, async (tx) => {
    const [op] = await tx.query(
      "SELECT * FROM publishing_operations WHERE owner_id=$1 AND id=$2 AND lease_token=$3 AND lease_until>$4",
      [owner, operationId, lease, stamp()],
    );
    if (!op) return false;
    const allowed: Record<string, string[]> = {
      login: ["awaiting_identity", "failed", "cancelled"],
      check: ["submitted", "failed", "cancelled"],
      publish: ["submitted", "failed", "cancelled", "unknown"],
    };
    if (!allowed[op.kind]?.includes(result.state))
      throw new Error("Invalid terminal state");
    if (
      op.kind === "publish" &&
      result.state === "submitted" &&
      op.state !== "submitting"
    )
      throw new Error("Publish was not acknowledged");
    if (
      op.kind === "publish" &&
      op.state === "submitting" &&
      ["failed", "cancelled"].includes(result.state)
    )
      result = { ...result, state: "unknown" };
    let pending: string | null = null,
      image: string | null = null;
    if (op.kind === "login" && result.state === "awaiting_identity") {
      if (!result.credential || !result.image)
        throw new Error("Login evidence missing");
      pending = seal(result.credential, owner + ":pending:" + operationId);
      image = safeImage(result.image);
    }
    if (op.kind === "check") {
      await tx.query(
        "UPDATE publishing_accounts SET state=$3,updated_at=$4 WHERE owner_id=$1 AND id=$2",
        [
          owner,
          op.account_id,
          result.state === "submitted" ? "ready" : "expired",
          stamp(),
        ],
      );
    }
    await tx.query(
      "UPDATE publishing_operations SET state=$4,detail=$5,pending_credential=$6,image_data=$7,control_ciphertext=NULL,lease_token=NULL,lease_until=NULL,updated_at=$8 WHERE owner_id=$1 AND id=$2 AND lease_token=$3",
      [
        owner,
        operationId,
        lease,
        result.state,
        result.detail,
        pending,
        image,
        stamp(),
      ],
    );
    return true;
  });
}
