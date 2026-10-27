import type {Metadata} from 'next';
import {WorkspaceLogin} from '../../components/workspace-session';
import {workspaceReturnPath} from '../../../../packages/domain/workspace-path';
export const metadata:Metadata={title:'登录矩阵流',robots:{index:false,follow:false}};
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{next?:string|string[]}>}){
  return <WorkspaceLogin returnTo={workspaceReturnPath((await searchParams).next)}/>;
}
