import type { Metadata } from "next";
import { WorkspaceGate } from "../../components/workspace-session";
import PublishingCenter from "../../components/publishing-center";
export const metadata: Metadata = {
  title: "多账号发布 · 矩阵流",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default function Page() {
  return (
    <WorkspaceGate>
      <PublishingCenter />
    </WorkspaceGate>
  );
}
