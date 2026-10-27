// Only original HTTPS image CDN addresses returned with account/work data are accepted.
export function safeImageUrl(value:unknown):string|null {
  if(typeof value!=='string'||value.length>4096)return null;
  try{
    const u=new URL(value);
    if(u.protocol!=='https:'||u.username||u.password||u.port||!['douyinpic.com','byteimg.com','douyincdn.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))return null;
    u.hash='';return u.href;
  }catch{return null;}
}

export function imageCandidates(...sources:unknown[]):string[] {
  const result=new Set<string>();
  for(const source of sources){
    const values=typeof source==='string'?[source]:Array.isArray(source)?source:source&&typeof source==='object'?(source as {url_list?:unknown}).url_list:[];
    if(!Array.isArray(values))continue;
    for(const value of values){const url=safeImageUrl(value);if(url)result.add(url);if(result.size===6)return [...result];}
  }
  return [...result];
}
