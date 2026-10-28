import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "../domain/types";
export const OWNER_ID = "personal-owner-v1"; // Stable principal, never derived from session/password. Not multi-tenant auth.
export const UPSTREAM_REVISION = "3847fff01f5434a8a32829833163cd6723cabc59";
export function encryptionConfigured() {
  return /^[a-f0-9]{64}$/i.test(process.env.MATRIX_PUBLISHING_KEY || "");
}
export function enabled() {
  return (
    process.env.MATRIX_PUBLISHING_ENABLED === "1" && !process.env.DATABASE_URL
  );
}
export function loginEnabled() {
  return (process.env.MATRIX_PUBLISHING_LOGIN_ENABLED === "1" || enabled()) && !process.env.DATABASE_URL;
}
export function requireLoginEnabled() {
  if (!loginEnabled() || !encryptionConfigured())
    throw new AppError(503, "登录执行未启用或凭证加密密钥未配置", "LOGIN_DISABLED");
}
export function validateCredential(value: unknown) {
  const state = value as { cookies?: { name: string; value: string; domain: string }[]; origins?: { origin: string }[] };
  if (!state || !Array.isArray(state.cookies) || !Array.isArray(state.origins) || JSON.stringify(state).length > 1024 * 1024 ||
      !state.cookies.some(c => ["sessionid", "sessionid_ss"].includes(c.name) && typeof c.value === "string" && c.value.length > 0) ||
      state.cookies.some(c => typeof c.domain !== "string" || !/(^|\.)douyin\.com$/.test(c.domain)) ||
      state.origins.some(o => { try { const u = new URL(o.origin); return u.protocol !== "https:" || !/(^|\.)douyin\.com$/.test(u.hostname); } catch { return true; } }))
    throw new Error("Invalid Douyin session");
  return value;
}
export function requireEnabled() {
  if (!enabled() || !encryptionConfigured())
    throw new AppError(
      503,
      "发布执行未启用或凭证加密密钥未配置",
      "PUBLISHING_DISABLED",
    );
}
function key() {
  if (!encryptionConfigured())
    throw new AppError(503, "发布凭证加密未配置", "PUBLISHING_KEY");
  return Buffer.from(process.env.MATRIX_PUBLISHING_KEY!, "hex");
}
export function seal(value: unknown, aad: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(aad));
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    bytes.toString("base64url"),
  ].join(".");
}
export function unseal<T>(value: string, aad: string): T {
  const [v, iv, tag, data] = value.split(".");
  if (v !== "v1") throw new Error("Invalid encrypted record");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64url"),
  );
  cipher.setAAD(Buffer.from(aad));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(data, "base64url")),
      cipher.final(),
    ]).toString("utf8"),
  ) as T;
}
export function safeImage(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 1600000 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value)
  )
    throw new Error("Invalid browser image");
  const b = Buffer.from(value.split(",")[1], "base64");
  if (
    b.length < 8 ||
    !b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("Invalid PNG");
  return value;
}
