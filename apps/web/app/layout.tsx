import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title:'矩阵流 · Alpha 0.01', description:'多账号内容运营工作台 · Alpha 演示版本' };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
