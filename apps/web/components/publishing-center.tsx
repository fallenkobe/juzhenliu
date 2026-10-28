"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Users, Upload, RefreshCw, LogOut, X, Menu } from "lucide-react";
import WorkspaceSidebar from "./workspace-sidebar";
import { logoutWorkspace, redirectToWorkspaceLogin } from "./workspace-session";
import {
  stateLabels,
  type PublishingAccount,
  type PublishingAsset,
  type PublishingOperation,
  type OperationState,
} from "../../../packages/publishing/types";
import "./publishing-center.css";
interface Overview {
  status: {
    enabled: boolean;
    encryptionConfigured: boolean;
    workerOnline: boolean;
  };
  accounts: PublishingAccount[];
  assets: PublishingAsset[];
  operations: PublishingOperation[];
}
interface Detail {
  id: string;
  state: OperationState;
  kind: string;
  detail: string;
  image: string | null;
  accountId: string;
}
async function api<T>(
  resource: string,
  body?: unknown,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api/publishing/" + resource, {
    ...options,
    method: body === undefined ? "GET" : "POST",
    headers: {
      "X-Matrix-Request": "video-analytics-v1",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
  });
  const value = await response.json();
  if (response.status === 401) {
    redirectToWorkspaceLogin();
    throw new Error("会话失效，请重新登录");
  }
  if (!response.ok) throw new Error(value.error || "请求未完成");
  return value;
}
export default function PublishingCenter() {
  const [data, setData] = useState<Overview | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false);
  const [label, setLabel] = useState(""),
    [handle, setHandle] = useState(""),
    [loginConsent, setLoginConsent] = useState(false);
  const [asset, setAsset] = useState(""),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [tags, setTags] = useState(""),
    [ai, setAi] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [reviewed, setReviewed] = useState(false),
    [code, setCode] = useState("");
  const request = useRef<{ key: string; fingerprint: string } | null>(null),
    modal = useRef<HTMLDivElement>(null),
    closingFocus = useRef<HTMLElement | null>(null);
  const refresh = useCallback(async () => {
    const result = await api<Overview>("overview");
    setData(result);
  }, []);
  useEffect(() => {
    let active = true;
    const update = () => {
      if (active)
        void refresh().catch((e) => {
          if (active) setError(e.message);
        });
    };
    update();
    const timer = setInterval(update, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    setConfirmed(false);
  }, [asset, title, description, tags, ai, selected]);
  useEffect(() => {
    setDetail(null);
    setReviewed(false);
    setCode("");
    if (!detailId) return;
    let active = true;
    const update = async () => {
      try {
        const value = await api<Detail>("operations/" + detailId);
        if (active) setDetail(value);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void update();
    const timer = setInterval(() => void update(), 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [detailId]);
  useEffect(() => {
    setReviewed(false);
    setCode("");
  }, [detail?.state]);
  useEffect(() => {
    if (!detailId) return;
    closingFocus.current = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailId(null);
      if (e.key === "Tab") {
        const items = Array.from(
          modal.current?.querySelectorAll<HTMLElement>(
            "button:not([disabled]),input:not([disabled])",
          ) ?? [],
        );
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
      closingFocus.current?.focus();
    };
  }, [detailId]);
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function control(action: string) {
    if (!detailId) return;
    await api("operations/" + detailId, {
      action,
      confirmed: reviewed,
      ...(action === "sms_code" ? { code } : {}),
    });
    setCode("");
    setReviewed(false);
    setMessage("操作已提交");
    const value = await api<Detail>("operations/" + detailId);
    setDetail(value);
  }
  async function publish() {
    const payload = {
      assetId: asset,
      title,
      description,
      tags: tags
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      declaration: ai ? "内容由AI生成" : null,
      accountIds: selected,
    };
    const fingerprint = JSON.stringify(payload);
    if (request.current?.fingerprint !== fingerprint)
      request.current = { key: crypto.randomUUID(), fingerprint };
    const result = await api<{ batchId: string }>("batches", {
      ...payload,
      confirmed,
      requestKey: request.current.key,
    });
    setMessage(
      "已保存批次 " +
        result.batchId +
        "，每个账号独立执行；实际页面填好后需再次核对。",
    );
    setConfirmed(false);
  }
  const ready = data?.status.enabled && data.status.encryptionConfigured;
  return (
    <div className="app-shell">
      <WorkspaceSidebar
        active="publish"
        mobile={mobile}
        onClose={() => setMobile(false)}
        onNavigate={(next) => {
          if (next === "publish") return;
          if (next === "tasks") {
            document
              .getElementById("publishing-tasks")
              ?.scrollIntoView({ behavior: "smooth" });
            return;
          }
          window.location.assign(
            next === "accounts"
              ? "/accounts"
              : next === "overview"
                ? "/"
                : "/?view=" + next,
          );
        }}
        user={
          <div className="sidebar-user">
            <span className="user-avatar">M</span>
            <span>
              <b>个人工作空间</b>
              <small>多账号发布</small>
            </span>
            <button
              className="icon-button"
              aria-label="退出矩阵流"
              onClick={() =>
                void logoutWorkspace().catch((e) => setError(e.message))
              }
            >
              <LogOut size={16} />
            </button>
          </div>
        }
      />
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="打开导航"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>工作台</span>
            <b>多账号发布</b>
          </div>
          <button
            className="secondary"
            onClick={() => void act(refresh)}
            disabled={busy}
          >
            <RefreshCw size={16} />
            刷新
          </button>
        </header>
        <main className="pc-main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">PERSONAL PUBLISHING</div>
              <h1>多账号发布</h1>
              <p>账号独立登录，任务逐个执行。发布提交与平台审核分开记录。</p>
            </div>
            <span
              className={
                "status " + (data?.status.workerOnline ? "good" : "warn")
              }
            >
              {data?.status.workerOnline ? "执行器在线" : "执行器离线"}
            </span>
          </div>
          {error && (
            <p role="alert" className="pc-notice pc-error">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="pc-notice">
              {message}
            </p>
          )}
          {!ready && (
            <p className="pc-notice">
              当前未启用真实执行。可先整理发布账号和素材；管理员完成加密密钥、固定版本引擎及执行器配置后才能扫码和发布。
            </p>
          )}
          <section className="panel pc-section">
            <h2>
              <Users size={20} />
              发布账号
            </h2>
            <p className="muted">
              这里的登录态与“账号管理”的公开资料分开。备注和预期抖音号不代表平台身份认证。
            </p>
            <form
              className="pc-account-form"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  await api("accounts", { label, expectedHandle: handle });
                  setLabel("");
                  setHandle("");
                });
              }}
            >
              <label>
                账号备注
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={60}
                  required
                  placeholder="例如：生活记录号"
                />
              </label>
              <label>
                预期抖音号
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  maxLength={40}
                  required
                  placeholder="扫码后仍需核对"
                />
              </label>
              <button className="secondary" disabled={busy}>
                添加发布账号
              </button>
            </form>
            <label className="pc-check">
              <input
                type="checkbox"
                checked={loginConsent}
                onChange={(e) => setLoginConsent(e.target.checked)}
              />
              我同意为所选自有账号扫码，并将登录态加密保存在此服务器；可随时断开。
            </label>
            <div className="pc-accounts">
              {data?.accounts.map((a) => (
                <article key={a.id} className="pc-account">
                  <div>
                    <b>{a.label}</b>
                    <small>预期抖音号：{a.expected_handle}</small>
                    <span
                      className={
                        "status " + (a.state === "ready" ? "good" : "warn")
                      }
                    >
                      {a.state === "ready"
                        ? "已登录 · 所有者已核对"
                        : a.state === "expired"
                          ? "需重新登录"
                          : "未连接"}
                    </span>
                  </div>
                  <div className="pc-actions">
                    <button
                      className="secondary"
                      disabled={busy || !ready || !loginConsent}
                      onClick={() =>
                        void act(async () => {
                          const r = await api<{ operationId: string }>(
                            "accounts/" + a.id + "/login",
                            { consent: loginConsent },
                          );
                          setDetailId(r.operationId);
                        })
                      }
                    >
                      扫码登录
                    </button>
                    <button
                      className="secondary"
                      disabled={busy || !ready || a.state === "disconnected"}
                      onClick={() =>
                        void act(async () => {
                          const r = await api<{ operationId: string }>(
                            "accounts/" + a.id + "/check",
                            {},
                          );
                          setDetailId(r.operationId);
                        })
                      }
                    >
                      检查
                    </button>
                    <button
                      className="text-button"
                      disabled={busy || a.state === "disconnected"}
                      onClick={() => {
                        if (
                          window.confirm(
                            "断开 " +
                              a.label +
                              " 并删除服务器保存的登录态？不会退出其他设备。",
                          )
                        )
                          void act(async () => {
                            await api("accounts/" + a.id + "/disconnect", {});
                          });
                      }}
                    >
                      断开
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {data && !data.accounts.length && (
              <p className="muted">还没有发布账号，先添加一个备注。</p>
            )}
          </section>
          <section className="panel pc-section">
            <h2>
              <Upload size={20} />
              视频与文案
            </h2>
            <label
              className={"secondary upload-label" + (busy ? " disabled" : "")}
            >
              <Upload size={16} />
              上传 MP4（最大 100 MB）
              <input
                type="file"
                accept="video/mp4"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  void act(async () => {
                    if (file.size > 100 * 1024 * 1024)
                      throw new Error("视频最大 100 MB");
                    const response = await fetch("/api/publishing/assets", {
                      method: "POST",
                      headers: {
                        "X-Matrix-Request": "video-analytics-v1",
                        "Content-Type": "video/mp4",
                        "X-File-Name": encodeURIComponent(file.name),
                      },
                      body: file,
                    });
                    const value = await response.json();
                    if (!response.ok)
                      throw new Error(value.error || "上传失败");
                    setAsset(value.assetId);
                  });
                }}
              />
            </label>
            <div className="pc-form">
              <label>
                选择素材
                <select
                  value={asset}
                  onChange={(e) => setAsset(e.target.value)}
                >
                  <option value="">请选择已上传视频</option>
                  {data?.assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.filename} · {(a.bytes / 1048576).toFixed(1)} MB
                    </option>
                  ))}
                </select>
              </label>
              <label>
                标题（最多 30 字）
                <input
                  value={title}
                  maxLength={30}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                描述
                <textarea
                  value={description}
                  maxLength={1000}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </label>
              <label>
                话题（逗号分隔，最多 5 个）
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  maxLength={110}
                />
              </label>
            </div>
            <label className="pc-check">
              <input
                type="checkbox"
                checked={ai}
                onChange={(e) => setAi(e.target.checked)}
              />
              该视频含 AI 生成内容，需要选择“内容由AI生成”声明
            </label>
            <p className="muted">
              第一版统一文案、立即发布；封面采用平台默认，实际页面需核对。不自动勾选原创、商业推广或其他声明。
            </p>
          </section>
          <section className="panel pc-section">
            <h2>
              <Send size={20} />
              选择目标账号
            </h2>
            <div className="pc-targets">
              {data?.accounts.map((a) => (
                <label className="pc-check" key={a.id}>
                  <input
                    type="checkbox"
                    disabled={a.state !== "ready"}
                    checked={selected.includes(a.id)}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked
                          ? [...prev, a.id]
                          : prev.filter((id) => id !== a.id),
                      )
                    }
                  />
                  {a.label}
                  <small>
                    {a.state !== "ready" ? "请先登录核对" : a.expected_handle}
                  </small>
                </label>
              ))}
            </div>
            <label className="pc-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              我已确认素材、文案及所选 {selected.length}{" "}
              个自有账号，创建发布任务。任务填好实际页面后，我会再次核对并确认提交。
            </label>
            <button
              className="primary"
              disabled={
                busy ||
                !ready ||
                !confirmed ||
                !selected.length ||
                !asset ||
                !title.trim()
              }
              onClick={() => void act(publish)}
            >
              <Send size={16} />
              {busy ? "处理中…" : "创建多账号发布任务"}
            </button>
          </section>
          <section id="publishing-tasks" className="panel pc-section">
            <h2>任务记录</h2>
            <p className="muted">
              关闭网页不会取消任务。需要扫码或确认时会等待；超时停止，不自动重发。这里只显示最近
              100 条。
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>账号 / 类型</th>
                    <th>状态</th>
                    <th>说明</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.operations.map((o) => (
                    <tr key={o.id}>
                      <td>
                        {o.label}
                        <small className="pc-small">
                          {o.kind === "login"
                            ? "登录"
                            : o.kind === "check"
                              ? "登录检查"
                              : "视频发布"}{" "}
                          · {new Date(o.created_at).toLocaleString()}
                        </small>
                      </td>
                      <td>{stateLabels[o.state]}</td>
                      <td>{o.detail}</td>
                      <td>
                        <button
                          className="secondary"
                          onClick={() => setDetailId(o.id)}
                        >
                          查看 / 处理
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
      {detailId && (
        <div className="dialog-backdrop">
          <div
            ref={modal}
            className="dialog wide pc-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="处理发布任务"
          >
            <div className="dialog-heading">
              <h2>{detail ? stateLabels[detail.state] : "加载任务…"}</h2>
              <button
                className="icon-button"
                aria-label="关闭任务详情"
                onClick={() => setDetailId(null)}
              >
                <X />
              </button>
            </div>
            {error && (
              <p role="alert" className="pc-notice pc-error">
                {error}
              </p>
            )}
            <p>{detail?.detail}</p>
            <p className="muted">
              当前账号：
              {data?.accounts.find((a) => a.id === detail?.accountId)?.label} ·
              预期抖音号：
              {
                data?.accounts.find((a) => a.id === detail?.accountId)
                  ?.expected_handle
              }
            </p>
            {detail?.image && (
              <img
                className="pc-browser"
                src={detail.image}
                alt="此任务当前抖音浏览器页面，仅供所有者核对"
              />
            )}
            {detail?.state === "waiting_scan" && (
              <p>
                请用目标账号扫描页面中的二维码。验证码或其他安全验证可能需要额外处理。
              </p>
            )}
            {detail?.state === "waiting_verification" && (
              <div className="pc-actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void act(() => control("request_sms"))}
                >
                  请求短信验证码
                </button>
                <input
                  aria-label="短信验证码"
                  value={code}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={8}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
                <button
                  className="primary"
                  disabled={busy || code.length < 4}
                  onClick={() => void act(() => control("sms_code"))}
                >
                  提交此任务验证码
                </button>
                <p className="muted">
                  仅使用本次抖音验证的短信；不支持滑块等验证时请取消，交管理员处理。
                </p>
              </div>
            )}
            {detail &&
              ["awaiting_identity", "awaiting_publish"].includes(
                detail.state,
              ) && (
                <>
                  <label className="pc-check">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    {detail.state === "awaiting_identity"
                      ? "我已核对截图中的实际账号与预期账号一致（人工确认，不是平台认证）"
                      : "我已核对实际账号、视频、文案和声明，同意现在提交到抖音"}
                  </label>
                  <button
                    className="primary"
                    disabled={busy || !reviewed}
                    onClick={() =>
                      void act(() =>
                        control(
                          detail.state === "awaiting_identity"
                            ? "confirm_identity"
                            : "confirm_publish",
                        ),
                      )
                    }
                  >
                    {detail.state === "awaiting_identity"
                      ? "确认账号并保存登录态"
                      : "确认实际页面，立即提交"}
                  </button>
                </>
              )}
            {detail &&
              [
                "queued",
                "running",
                "waiting_scan",
                "waiting_verification",
                "awaiting_identity",
                "awaiting_publish",
              ].includes(detail.state) && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void act(() => control("cancel"))}
                >
                  取消此任务
                </button>
              )}
            {detail?.state === "unknown" && (
              <>
                <p className="pc-notice pc-error">
                  请先到抖音创作者中心核实是否已发布。本账号的后续任务暂停，不能把“没收到成功响应”当作未发布。
                </p>
                <label className="pc-check">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  我已在抖音创作者中心人工核实该任务结果
                </label>
                <div className="pc-actions">
                  <button
                    className="secondary"
                    disabled={busy || !reviewed}
                    onClick={() => void act(() => control("resolve_submitted"))}
                  >
                    已找到发布记录
                  </button>
                  <button
                    className="secondary"
                    disabled={busy || !reviewed}
                    onClick={() =>
                      void act(() => control("resolve_not_published"))
                    }
                  >
                    确认未发布（不自动重试）
                  </button>
                </div>
              </>
            )}
            <p className="muted">关闭这个窗口不会取消后台任务。</p>
          </div>
        </div>
      )}
    </div>
  );
}
