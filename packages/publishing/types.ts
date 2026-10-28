export type OperationState =
  | "queued"
  | "running"
  | "waiting_scan"
  | "waiting_verification"
  | "awaiting_identity"
  | "awaiting_publish"
  | "submitting"
  | "submitted"
  | "failed"
  | "unknown"
  | "cancelled";
export type OperationKind = "login" | "check" | "publish";
export interface IdentityChallenge {
  stage: "choose" | "sms" | "manual";
  receiveSms: boolean;
  requestSms: boolean;
  submitCode: boolean;
  face: boolean;
  sendSms: boolean;
}
export interface PublishingAccount {
  id: string;
  label: string;
  expected_handle: string;
  state: string;
  epoch: number;
  identity_confirmed_at: string | null;
  last_checked_at: string | null;
  session_saved_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface PublishingAsset {
  id: string;
  filename: string;
  mime: string;
  bytes: number;
  created_at: string;
}
export interface PublishingOperation {
  id: string;
  account_id: string;
  batch_id: string | null;
  kind: OperationKind;
  state: OperationState;
  detail: string;
  created_at: string;
  updated_at: string;
  label: string;
}
export interface PublishPayload {
  assetId: string;
  title: string;
  description: string;
  tags: string[];
  declaration: string | null;
}
export const stateLabels: Record<OperationState, string> = {
  queued: "排队中",
  running: "执行中",
  waiting_scan: "等待扫码",
  waiting_verification: "等待验证",
  awaiting_identity: "待核对账号",
  awaiting_publish: "待确认发布页面",
  submitting: "正在提交",
  submitted: "已提交，待平台审核",
  failed: "未提交 / 已停止",
  unknown: "结果待人工核实",
  cancelled: "已取消",
};
export const activeStates = [
  "queued",
  "running",
  "waiting_scan",
  "waiting_verification",
  "awaiting_identity",
  "awaiting_publish",
  "submitting",
];
