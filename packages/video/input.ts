import { AppError } from '../domain/types';

const validId = (s: string) => /^\d{15,22}$/.test(s);
export function parseVideoId(input: unknown): string {
  if (typeof input !== 'string' || input.length > 2048) throw new AppError(400, '请输入视频 ID 或完整的抖音视频链接');
  const text = input.trim();
  if (validId(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['douyin.com', 'www.douyin.com', 'iesdouyin.com', 'www.iesdouyin.com'].includes(url.hostname)) throw new Error();
    const fromPath = url.pathname.match(/^\/(?:video|note)\/(\d+)\/?$/)?.[1] || url.pathname.match(/^\/share\/video\/(\d+)\/?$/)?.[1];
    const id = fromPath || url.searchParams.get('modal_id');
    if (id && validId(id)) return id;
  } catch { /* User URLs are parsed locally, never fetched. */ }
  throw new AppError(400, '链接中没有有效的视频 ID。请使用 douyin.com/video/… 完整链接、含 modal_id 的页面链接或数字 ID；暂不支持短链和整段分享文案');
}
