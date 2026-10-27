import {createHash} from 'node:crypto';
import {db} from '../db/index';
import {requireOwner} from '../domain/douyin-auth';
import {AppError} from '../domain/types';
import {imageCandidates,safeImageUrl} from './image-urls';
import type {AccountProfile} from './types';
import type {AccountWorkPage} from './works-types';

const MAX_IMAGE=5*1024*1024,MAX_CACHE=32*1024*1024,CACHE_MS=30*60000;
type ImageData={bytes:Uint8Array;type:string};
type CacheEntry=ImageData&{expires:number};
const state={cache:new Map<string,CacheEntry>(),pending:new Map<string,Promise<ImageData>>(),bytes:0,active:0,queue:[] as (()=>void)[]};

async function sourcesFor(token:string|undefined,action:string[]):Promise<string[]> {
  const session=await requireOwner(token);
  const [kind,id,workId]=action;
  if(kind==='preview'&&action.length===2&&/^[a-f0-9-]{36}$/.test(id)){
    const [row]=await db.query('SELECT profile_json FROM account_lookups WHERE lookup_id=$1 AND session_hash=$2 AND expires_at>$3',[id,session,new Date().toISOString()]);
    if(!row)throw new AppError(404,'账号预览已过期，请重新获取资料','IMAGE_NOT_FOUND');
    const p=JSON.parse(row.profile_json) as AccountProfile;return imageCandidates(p.avatarUrls,p.avatarUrl);
  }
  if(!/^\d{1,25}$/.test(id||'')||!((kind==='avatar'&&action.length===2)||(kind==='cover'&&action.length===3&&/^\d{15,22}$/.test(workId))))throw new AppError(400,'图片标识无效');
  const [row]=await db.query('SELECT profile_json FROM managed_douyin_accounts WHERE uid=$1',[id]);
  if(!row)throw new AppError(404,'账号记录不存在','IMAGE_NOT_FOUND');
  if(kind==='avatar'){const p=JSON.parse(row.profile_json) as AccountProfile;return imageCandidates(p.avatarUrls,p.avatarUrl);}
  const pages=await db.query('SELECT page_json FROM account_work_pages WHERE uid=$1 ORDER BY fetched_at DESC',[id]);
  for(const row of pages){const w=(JSON.parse(row.page_json) as AccountWorkPage).items.find(w=>w.id===workId);if(w)return imageCandidates(w.coverUrls,w.coverUrl);}
  throw new AppError(404,'尚未保存此作品','IMAGE_NOT_FOUND');
}

function imageType(bytes:Uint8Array):string|null {
  const b=Buffer.from(bytes);
  if(b.length>=8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
  if(['GIF87a','GIF89a'].includes(b.subarray(0,6).toString('ascii')))return 'image/gif';
  if(b.subarray(0,4).toString('ascii')==='RIFF'&&b.subarray(8,12).toString('ascii')==='WEBP')return 'image/webp';
  if(b.subarray(4,8).toString('ascii')==='ftyp'&&['avif','avis'].includes(b.subarray(8,12).toString('ascii')))return 'image/avif';
  return null;
}

async function download(url:string,signal:AbortSignal,transport:typeof fetch):Promise<ImageData> {
  let target=url;
  for(let hop=0;hop<=2;hop++){
    // Validate each hop, including redirects. Never forward request cookies or API keys.
    if(!safeImageUrl(target))throw new Error('Invalid image host');
    const response=await transport(target,{redirect:'manual',cache:'no-store',signal,headers:{Accept:'image/avif,image/webp,image/png,image/jpeg,image/gif',Referer:'https://www.douyin.com/','User-Agent':'Mozilla/5.0'}});
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');await response.body?.cancel();
      if(!location||hop===2)throw new Error('Image redirect rejected');
      target=new URL(location,target).href;continue;
    }
    const type=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if(!response.ok||!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(type||'')||Number(response.headers.get('content-length'))>MAX_IMAGE){await response.body?.cancel();throw new Error('Image unavailable');}
    if(!response.body)throw new Error('Empty image');
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try{
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_IMAGE){await reader.cancel();throw new Error('Image too large');}chunks.push(value);}
    }finally{reader.releaseLock();}
    const bytes=Buffer.concat(chunks),actual=imageType(bytes);
    if(!actual||actual!==type)throw new Error('Invalid image content');
    return {bytes,type:actual};
  }
  throw new Error('Image unavailable');
}

async function fetchCandidates(urls:string[],transport:typeof fetch):Promise<ImageData> {
  if(state.active>=6){
    if(state.queue.length>=64)throw new AppError(503,'图片正在加载，请稍后重试','IMAGE_BUSY');
    await new Promise<void>(resolve=>state.queue.push(resolve));
  }else state.active++;
  try{
    const deadline=AbortSignal.timeout(12000);
    for(const url of urls){
      if(deadline.aborted)break;
      try{return await download(url,AbortSignal.any([deadline,AbortSignal.timeout(4000)]),transport);}catch{/* Try only the saved alternatives; never query a paid API here. */}
    }
    throw new AppError(502,'图片暂不可用，可重试或刷新账号资料、作品列表','IMAGE_UNAVAILABLE');
  }finally{const next=state.queue.shift();if(next)next();else state.active--;}
}

async function cachedImage(urls:string[],transport:typeof fetch):Promise<ImageData> {
  const key=createHash('sha256').update(JSON.stringify(urls)).digest('hex');
  const cached=state.cache.get(key);
  if(cached&&cached.expires>Date.now()){state.cache.delete(key);state.cache.set(key,cached);return cached;}
  if(cached){state.bytes-=cached.bytes.length;state.cache.delete(key);}
  const running=state.pending.get(key);if(running)return running;
  const pending=fetchCandidates(urls,transport).then(image=>{
    while(state.bytes+image.bytes.length>MAX_CACHE||state.cache.size>=128){const first=state.cache.keys().next().value;if(!first)break;state.bytes-=state.cache.get(first)!.bytes.length;state.cache.delete(first);}
    state.cache.set(key,{...image,expires:Date.now()+CACHE_MS});state.bytes+=image.bytes.length;return image;
  }).finally(()=>state.pending.delete(key));
  state.pending.set(key,pending);return pending;
}

export async function accountImage(token:string|undefined,action:string[],transport:typeof fetch=fetch):Promise<Response> {
  const urls=await sourcesFor(token,action);
  if(!urls.length)throw new AppError(404,'暂未取得图片地址，请刷新资料','IMAGE_NOT_FOUND');
  const image=await cachedImage(urls,transport);
  await requireOwner(token);
  return new Response(new Uint8Array(image.bytes),{headers:{'Content-Type':image.type,'Content-Length':String(image.bytes.length),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin'}});
}
