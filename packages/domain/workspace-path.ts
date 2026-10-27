export function workspaceReturnPath(value:unknown):string {
  if(typeof value!=='string')return '/accounts';
  if(value==='/'||value==='/accounts'||value==='/videos')return value;
  if(/^\/\?view=(overview|accounts|analytics|assets|publish|promotion|tasks|settings)$/.test(value))return value;
  if(/^\/videos\?videoId=\d{15,22}$/.test(value))return value;
  return '/accounts';
}
