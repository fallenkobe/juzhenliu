export type LoginStage = "browser_start" | "page_open" | "login_panel" | "session_read" | "screenshot";
export const loginStageLabels: Record<LoginStage, string> = {
  browser_start: "正在启动独立登录浏览器",
  page_open: "浏览器已启动，正在加载抖音页面",
  login_panel: "正在等待抖音登录控件",
  session_read: "正在读取抖音登录状态",
  screenshot: "正在生成登录页面预览",
};
export class LoginBrowserError extends Error {
  constructor(public stage: LoginStage, cause?: unknown) { super(stage, { cause }); }
}
export function loginFailure(error: unknown) {
  const stage = error instanceof LoginBrowserError ? error.stage : "session_read";
  const cause = error instanceof LoginBrowserError ? error.cause : error;
  const message = cause instanceof Error ? cause.message : "";
  // Do not expose Playwright logs, input values, URLs or paths to the Web response.
  const network = message.match(/net::(ERR_[A-Z_]{1,45})\b/)?.[1];
  const reasons: Record<LoginStage, string> = {
    browser_start: "独立浏览器启动失败，请检查浏览器安装及运行权限",
    page_open: "浏览器已启动，但抖音页面连接失败或超时",
    login_panel: "抖音页面已打开，但登录控件未就绪；可能是页面资源加载失败",
    session_read: "浏览器已启动，但读取登录页面时发生异常",
    screenshot: "登录页面已打开，但生成遮盖输入框的预览失败",
  };
  return { state: "failed", checkStatus: "check_failed", detail: `[LOGIN_${stage.toUpperCase()}] ${reasons[stage]}${network ? `（${network}）` : ""}，请重新发起登录` };
}
