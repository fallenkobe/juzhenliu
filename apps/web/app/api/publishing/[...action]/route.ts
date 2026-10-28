import { cookies } from "next/headers";
import { OWNER_COOKIE } from "../../../../../../packages/domain/douyin-auth";
import { handlePublishingRequest } from "../../../../../../packages/publishing/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(
  req: Request,
  { params }: { params: Promise<{ action: string[] }> },
) {
  const { action } = await params;
  return handlePublishingRequest(
    req,
    action,
    (await cookies()).get(OWNER_COOKIE)?.value,
  );
}
export { handle as GET, handle as POST };
