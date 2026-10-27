import type { NextConfig } from 'next';
import { resolve } from 'node:path';

const config: NextConfig = {
  turbopack: { root: resolve(import.meta.dirname, '../..') },
  serverExternalPackages: ['pg'],
  outputFileTracingExcludes: { '/*': ['../../.data/**/*', '../../tests/**/*', '../../validation/**/*', '../../.env'] },
  poweredByHeader: false,
  devIndicators: false,
  logging: { incomingRequests: { ignore: [/\/api\/douyin\/callback/] } },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Frame-Options', value: 'DENY' }
    ] }, { source: '/api/douyin/:path*', headers: [{ key:'Referrer-Policy', value:'no-referrer' }] }, { source:'/douyin', headers:[{ key:'Referrer-Policy', value:'no-referrer' }] }];
  }
};
export default config;
