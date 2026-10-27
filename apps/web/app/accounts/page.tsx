import type { Metadata } from 'next';
import Workbench from '../../components/workbench';
import {WorkspaceGate} from '../../components/workspace-session';

export const metadata: Metadata = {title:'账号管理 · 矩阵流',description:'通过抖音号添加账号资料与查看公开指标',robots:{index:false,follow:false}};
export const dynamic = 'force-dynamic';
export default function Page() { return <WorkspaceGate><Workbench accountWorkspace/></WorkspaceGate>; }
