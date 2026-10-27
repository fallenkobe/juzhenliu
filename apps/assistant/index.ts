import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { BrowserAssistant } from './browser';
import { assistantDirectory } from '../../packages/assistant/paths';
import {ranges,type AnalysisRange,type AnalysisTopic} from '../../packages/assistant/analysis';

const helper=new BrowserAssistant();await helper.initialize();
const token=randomBytes(32).toString('hex');
const port=Number(process.env.MATRIX_ASSISTANT_PORT||37211);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid assistant port');
const equal=(value:string)=>/^[a-f0-9]{64}$/.test(value)&&timingSafeEqual(Buffer.from(value),Buffer.from(token));
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(value:unknown,status=200)=>{res.statusCode=status;res.end(JSON.stringify(value));};
  if(req.headers.host!==`127.0.0.1:${port}`||req.headers.origin||!equal(String(req.headers.authorization||'').replace(/^Bearer /,'')))return send({error:'只接受已配对的本机工作台请求'},403);
  try{
    if(req.method==='GET'&&req.url==='/status')return send(await helper.status());
    if(req.method!=='POST')return send({error:'接口不存在'},404);
    const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>10*1024*1024)return send({error:'请求过大'},413);chunks.push(Buffer.from(chunk));}
    const buffer=Buffer.concat(chunks);
    if(req.url==='/reference')return send(await helper.setReference(buffer));
    const body=JSON.parse(buffer.toString('utf8')||'{}');
    if(req.url==='/open'){if(!['home','data'].includes(body.page))return send({error:'页面不在允许范围'},400);return send(await helper.open(body.page));}
    if(req.url==='/close')return send(await helper.close());
    if(req.url==='/last30')return send(await helper.last30Days());
    if(['/inspect','/sync','/analyze'].includes(req.url||'')){
      const label=typeof body.accountLabel==='string'?body.accountLabel.trim():'';if(!label||label.length>40)return send({error:'请填写 1–40 字的账号备注，并确认浏览器中的账号'},400);
      if(req.url==='/analyze'){
        if(!['works','fans'].includes(body.topic)||!ranges.includes(body.range))return send({error:'分析类型或日期范围无效'},400);
        return send(await helper.analyze(label,body.topic as AnalysisTopic,body.range as AnalysisRange));
      }
      return send(req.url==='/inspect'?await helper.inspect(label):await helper.exportAndSync(label));
    }
    return send({error:'接口不存在'},404);
  }catch(error){return send({error:error instanceof Error?error.message:'助手操作失败'},400);}
});
await mkdir(assistantDirectory,{recursive:true});
await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
await writeFile(path.join(assistantDirectory,'connection.json'),JSON.stringify({port,token,pid:process.pid,startedAt:new Date().toISOString()}),{mode:0o600});
console.log(`矩阵流本机助手已启动（127.0.0.1:${port}），浏览器登录态只保留在本机。`);
const referencePath=process.argv.find(a=>a.startsWith('--reference='))?.slice('--reference='.length);
if(referencePath){await helper.setReference(await readFile(path.resolve(referencePath)));console.log('已载入参考 Excel，未修改原文件。');}
if(process.argv.includes('--open'))await helper.open('home').catch(()=>console.error('浏览器未能打开，请从工作台重试。'));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void helper.close().finally(()=>server.close(()=>process.exit(0)));});
