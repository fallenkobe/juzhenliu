import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { stat } from "node:fs/promises";
import { root } from "../config/env";
import { OWNER_ID, UPSTREAM_REVISION, unseal } from "./security";
import { assetDirectory } from "./service";
import * as queue from "./queue";
export async function runOperation(op: any, instanceId: string) {
  const python = process.env.MATRIX_PUBLISHING_PYTHON || "python3";
  const upstream = process.env.MATRIX_SAU_ROOT;
  if (!upstream) {
    await queue.finish(op.id, op.lease_token, {
      state: "failed",
      detail: "未配置发布引擎目录 MATRIX_SAU_ROOT",
    });
    return;
  }
  const payload = JSON.parse(op.payload);
  if (op.kind === "publish") {
    payload.file = path.join(assetDirectory(), payload.assetId + ".mp4");
    try {
      await stat(payload.file);
    } catch {
      await queue.finish(op.id, op.lease_token, {
        state: "failed",
        detail: "素材文件已丢失，未启动发布",
      });
      return;
    }
  }
  let credential: unknown;
  if (op.kind !== "login") {
    try {
      credential = unseal(
        op.account.credential_ciphertext,
        OWNER_ID + ":account:" + op.account_id,
      );
    } catch {
      await queue.finish(op.id, op.lease_token, {
        state: "failed",
        detail: "登录态无法解密，请重新登录",
      });
      return;
    }
  }
  // Minimal child environment: don't hand TikHub keys / owner passwords / encryption keys to upstream.
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV || "production",
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: "C.UTF-8",
    MATRIX_SAU_ROOT: upstream,
    PYTHONUNBUFFERED: "1",
  };
  if (process.env.PLAYWRIGHT_BROWSERS_PATH)
    env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const child = spawn(
    python,
    ["-I", path.join(root, "scripts/publishing/sau_bridge.py")],
    {
      env,
      stdio: ["pipe", "pipe", "ignore"],
      detached: process.platform !== "win32",
    },
  );
  let finished = false,
    submitting = false,
    chain = Promise.resolve();
  const stop = () => {
    if (child.pid) {
      try {
        if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
        else child.kill();
      } catch {}
    }
  };
  const complete = async (result: {
    state: string;
    detail: string;
    credential?: unknown;
    image?: string;
  }) => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    clearTimeout(deadline);
    child.stdin.end();
    stop();
    try {
      await queue.finish(op.id, op.lease_token, result);
    } catch {
      // Child is already stopped. Leave the durable lease to expire conservatively;
      // never let a persistence failure keep a browser alive or cause a retry.
      console.error("发布任务结果未能落库；执行器已停止，等待租约恢复处理");
    }
  };
  const deadline = setTimeout(() => {
    void complete({
      state: op.kind === "publish" ? "unknown" : "failed",
      detail: "执行超过 15 分钟，已停止；发布结果需人工核实",
    });
  }, 910000);
  let polling = false;
  const timer = setInterval(() => {
    if (polling || finished) return;
    polling = true;
    void (async () => {
      if (!(await queue.heartbeat(instanceId, op.id, op.lease_token))) {
        finished = true;
        clearInterval(timer);
        clearTimeout(deadline);
        stop();
        return;
      }
      const command = await queue.consumeControl(op.id, op.lease_token);
      if (command?.action === "cancel") {
        await complete({
          state: submitting ? "unknown" : "cancelled",
          detail: submitting
            ? "提交过程中停止，需人工核实"
            : "用户取消，执行器已停止",
        });
      } else if (command) child.stdin.write(JSON.stringify(command) + "\n");
    })()
      .catch(() => {
        void complete({
          state: op.kind === "publish" ? "unknown" : "failed",
          detail: "任务租约或控制通道异常，已停止",
        });
      })
      .finally(() => {
        polling = false;
      });
  }, 1000);
  child.stdin.on("error", () => {});
  child.on("error", () => {
    void complete({
      state: "failed",
      detail: "无法启动 Python 发布执行器，请检查安装路径",
    });
  });
  let bufferSize = 0;
  const lines = createInterface({ input: child.stdout });
  child.stdout.on("data", (chunk) => {
    bufferSize += chunk.length;
    if (bufferSize > 30 * 1024 * 1024)
      void complete({
        state: op.kind === "publish" ? "unknown" : "failed",
        detail: "执行器输出异常，已停止",
      });
  });
  lines.on("line", (line) => {
    chain = chain
      .then(async () => {
        if (finished) return;
        if (line.length > 3 * 1024 * 1024) throw new Error("Oversized event");
        const value = JSON.parse(line);
        if (value.type === "result") {
          const allowed =
            op.kind === "login"
              ? ["awaiting_identity", "failed", "cancelled"]
              : op.kind === "check"
                ? ["submitted", "failed", "cancelled"]
                : ["submitted", "failed", "cancelled", "unknown"];
          if (!allowed.includes(value.state)) throw new Error("Invalid result");
          if (submitting && ["failed", "cancelled"].includes(value.state))
            value.state = "unknown";
          await complete({
            state: value.state,
            detail: String(value.detail || "").slice(0, 300),
            ...(op.kind === "login"
              ? { credential: value.credential, image: value.image }
              : {}),
          });
        } else {
          if (value.type === "submitting") submitting = true;
          await queue.event(op.id, op.lease_token, value);
          if (value.type === "submitting")
            child.stdin.write(JSON.stringify({ action: "submit_ack" }) + "\n");
        }
      })
      .catch(() =>
        complete({
          state: op.kind === "publish" ? "unknown" : "failed",
          detail: "执行器协议异常，已停止；不自动重发",
        }),
      );
  });
  const ended = new Promise<void>((resolve) =>
    child.on("close", () => {
      void chain.then(async () => {
        if (!finished)
          await complete({
            state: op.kind === "publish" ? "unknown" : "failed",
            detail: "执行器退出但没有可信结果；不自动重发",
          });
        resolve();
      });
    }),
  );
  child.stdin.write(
    JSON.stringify({
      kind: op.kind,
      revision: UPSTREAM_REVISION,
      payload,
      credential,
    }) + "\n",
  );
  await ended;
}
