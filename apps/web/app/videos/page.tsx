import type { Metadata } from 'next';
import VideoAnalytics from '../../components/video-analytics';
import {WorkspaceGate} from '../../components/workspace-session';

export const metadata: Metadata = {title:'视频分析 · 矩阵流',description:'查询抖音视频累计指标与历史逐日趋势',robots:{index:false,follow:false}};
export const dynamic = 'force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{videoId?:string|string[];accountUid?:string|string[]}>}) {
  const {videoId:id,accountUid:uid}=await searchParams;
  const accountUid=typeof uid==='string'&&/^\d{1,25}$/.test(uid)?uid:'';
  const initialVideoId=typeof id==='string'&&/^\d{15,22}$/.test(id)?id:'';
  return <WorkspaceGate><VideoAnalytics standalone={process.env.MATRIX_VIDEO_ONLY === '1'} initialVideoId={initialVideoId} accountUid={accountUid}/></WorkspaceGate>;
}
