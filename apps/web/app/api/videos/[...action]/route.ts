import { NextRequest } from 'next/server';
import { OWNER_COOKIE } from '../../../../../../packages/domain/douyin-auth';
import { handleVideoRequest } from '../../../../../../packages/video/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;
async function handler(req: NextRequest, {params}: {params: Promise<{action:string[]}>}) {
  return handleVideoRequest(req,(await params).action,req.cookies.get(OWNER_COOKIE)?.value);
}
export {handler as GET,handler as POST,handler as DELETE};
