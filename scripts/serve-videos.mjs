import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root,'.env')); } catch(e) { if(e.code !== 'ENOENT') throw e; }
let originValid = false;
try { const u = new URL(process.env.MATRIX_PUBLIC_ORIGIN || ''); originValid = u.protocol === 'https:' && u.origin === process.env.MATRIX_PUBLIC_ORIGIN && !u.username && !u.password; } catch {}
const limit = Number(process.env.MATRIX_VIDEO_DAILY_LIMIT || 100);
if (!(process.env.TIKHUB_API_KEY || '').trim() || (process.env.MATRIX_OWNER_PASSWORD || '').length < 24 || !originValid || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
  console.error('视频服务启动失败：请配置 TIKHUB_API_KEY、至少 24 位 MATRIX_OWNER_PASSWORD、HTTPS 的 MATRIX_PUBLIC_ORIGIN，以及 1–1000 的 MATRIX_VIDEO_DAILY_LIMIT。');
  process.exit(1);
}
// One Web process: no browser assistant and no publishing/advertising worker.
const child = spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'start',path.join(root,'apps/web'),'--hostname','127.0.0.1','--port',process.env.PORT || '3000'],{cwd:root,env:{...process.env,NODE_ENV:'production',MATRIX_ROOT:root,MATRIX_VIDEO_ONLY:'1'},stdio:'inherit'});
child.on('error',()=>{console.error('视频服务无法启动');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code ?? 1;});
process.on('SIGINT',()=>child.kill());
process.on('SIGTERM',()=>child.kill());
