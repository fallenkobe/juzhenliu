import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title:'矩阵流 · 0.11', description:'多账号内容运营工作台 · 抖音账号授权登录' };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
