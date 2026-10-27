'use client';
import {useState} from 'react';
import {ImageOff,Loader2,RefreshCw,ImageIcon} from 'lucide-react';

type Props={src:string|null;alt:string;variant:'avatar'|'cover';initial?:string};
export default function AccountImage(props:Props){return <ImageContent key={props.src||'missing'} {...props}/>;}

function ImageContent({src,alt,variant,initial}:Props){
  const [state,setState]=useState<'loading'|'ready'|'error'>('loading'),[attempt,setAttempt]=useState(0);
  const failed=!!src&&state==='error';
  return <span className={'am-image am-image-'+variant+' am-image-'+(src?state:'missing')}>
    {src&&state!=='error'&&<img key={attempt} src={src+(attempt?'&retry='+attempt:'')} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={()=>setState('ready')} onError={()=>setState('error')}/>}
    {(!src||state!=='ready')&&<span className="am-image-placeholder" role="status" aria-label={failed?alt+'加载失败':!src?alt+'暂未获取':alt+'加载中'}>
      {src&&state==='loading'?<Loader2 size={variant==='avatar'?18:25} className="spin"/>:variant==='avatar'?<span className="am-image-initial">{initial||'抖'}</span>:failed?<ImageOff size={26}/>:<ImageIcon size={26}/>}
      {variant==='cover'&&<span>{failed?'封面加载失败':src?'加载封面…':'暂未获取封面'}</span>}
      {failed&&<button type="button" className="am-image-retry" aria-label={'重试'+alt} title="重新加载图片，不查询付费数据接口" onClick={()=>{setAttempt(v=>v+1);setState('loading');}}><RefreshCw size={11}/>{variant==='cover'?'重试':'重载'}</button>}
    </span>}
  </span>;
}
