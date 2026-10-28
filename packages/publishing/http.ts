import { db } from "../db/index";
import { requireOwner } from "../domain/douyin-auth";
import { AppError } from "../domain/types";
import { publicOrigin, requestOrigin } from "../video/http";
import * as service from "./service";
const globalState = globalThis as typeof globalThis & {
  publishingReady?: Promise<void>;
};
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
async function body(req: Request): Promise<Record<string, unknown>> {
  if (req.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new AppError(415, "需要 JSON 请求");
  const reader = req.body?.getReader();
  if (!reader) throw new AppError(400, "请求为空");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 16384) {
        await reader.cancel();
        throw new AppError(413, "请求过大");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error();
    return data;
  } catch {
    throw new AppError(400, "JSON 无效");
  }
}
export async function handlePublishingRequest(
  req: Request,
  parts: string[],
  token?: string,
) {
  try {
    await (globalState.publishingReady ??= db.migrate().catch((e) => {
      globalState.publishingReady = undefined;
      throw e;
    }));
    if (process.env.NODE_ENV === "production" && !publicOrigin())
      throw new AppError(503, "请先配置 HTTPS 公网来源");
    await requireOwner(token);
    if (req.method !== "GET") requestOrigin(req);
    const resource = parts.join("/");
    if (req.method === "GET" && resource === "overview")
      return json(await service.overview(token));
    if (req.method === "POST" && resource === "accounts")
      return json(await service.addAccount(token, await body(req)), 201);
    if (
      parts.length === 3 &&
      parts[0] === "accounts" &&
      req.method === "POST"
    ) {
      if (parts[2] === "disconnect")
        return json(await service.disconnectAccount(token, parts[1]));
      if (parts[2] === "login" || parts[2] === "check")
        return json(
          await service.startAccountOperation(
            token,
            parts[1],
            parts[2],
            await body(req),
          ),
          202,
        );
    }
    if (req.method === "POST" && resource === "assets")
      return json(await service.uploadAsset(token, req), 201);
    if (req.method === "POST" && resource === "batches")
      return json(await service.createBatch(token, await body(req)), 202);
    if (parts[0] === "operations" && parts.length === 2) {
      if (req.method === "GET")
        return json(await service.operationDetail(token, parts[1]));
      if (req.method === "POST")
        return json(
          await service.controlOperation(token, parts[1], await body(req)),
        );
    }
    return json({ error: "接口不存在" }, 404);
  } catch (e) {
    if (e instanceof AppError)
      return json({ error: e.message, code: e.code }, e.status);
    console.error("[publishing] Internal error (details suppressed)");
    return json({ error: "发布服务暂不可用", code: "INTERNAL_ERROR" }, 500);
  }
}
