import {NextRequest,NextResponse} from 'next/server';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {assistantDirectory} from '../../../../../../packages/assistant/paths';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const actions=new Set(['status','open','close','inspect','sync','reference','last30','analyze']);
function json(value:unknown,status=200){return NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});}
function localRequest(req:NextRequest){
  const host=req.headers.get('host')||'';
  if(!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host)||req.headers.get('sec-fetch-site')==='cross-site')return false;
  const origin=req.headers.get('origin');if(origin){try{if(new URL(origin).host!==host)return false;}catch{return false;}}
  return req.method==='GET'||!!origin&&req.headers.get('x-matrix-request')==='assistant-0.11';
}
async function limitedBody(req:NextRequest){
  const reader=req.body?.getReader();if(!reader)return Buffer.alloc(0);const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10*1024*1024){await reader.cancel();throw new Error('请求超过 10 MB');}chunks.push(value);}}finally{reader.releaseLock();}return Buffer.concat(chunks);
}
async function handler(req:NextRequest,{params}:{params:Promise<{action:string[]}>}){
  if(!localRequest(req))return json({error:'本机验证入口只接受本机工作台的同源请求'},403);
  const {action}=await params,key=action.join('/');if(!actions.has(key)||action.length!==1||(key==='status'?req.method!=='GET':req.method!=='POST'))return json({error:'接口不存在'},404);
  let connection:{port:number;token:string};
  try{connection=JSON.parse(await readFile(/* turbopackIgnore: true */path.join(assistantDirectory,'connection.json'),'utf8'));if(!Number.isInteger(connection.port)||connection.port<1024||connection.port>65535||!/^[a-f0-9]{64}$/.test(connection.token))throw new Error();}
  catch{return key==='status'?json({online:false,message:'运行 npm run assistant 启动本机助手'}):json({error:'本机助手未启动，请运行 npm run assistant'},503);}
  try{
    const body=req.method==='POST'?await limitedBody(req):undefined;
    const response=await fetch(`http://127.0.0.1:${connection.port}/${key}`,{method:req.method,headers:{Authorization:'Bearer '+connection.token,'Content-Type':key==='reference'?'application/octet-stream':'application/json'},body,signal:AbortSignal.timeout(key==='status'?10000:key==='analyze'?90000:45000),cache:'no-store',redirect:'error'});
    return json(await response.json(),response.status);
  }catch(error){if(error instanceof Error&&error.message==='请求超过 10 MB')return json({error:error.message},413);return key==='status'?json({online:false,message:'本机助手未连接，请运行 npm run assistant'}):json({error:'助手连接中断或操作超时，请检查独立浏览器窗口后再试'},503);}
}
export{handler as GET,handler as POST};
