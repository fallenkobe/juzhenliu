import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';

const channel=process.env.PLAYWRIGHT_CHANNEL||(existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')?'msedge':undefined);
export default defineConfig({
  testDir:'./tests/e2e',fullyParallel:false,workers:1,timeout:60000,
  expect:{timeout:15000},reporter:'list',
  use:{baseURL:'http://127.0.0.1:3100',viewport:{width:1440,height:1000},headless:true,channel,trace:'retain-on-failure'},
  webServer:{command:process.env.E2E_PRODUCTION==='1'?'npm run preview':'npm run dev',url:'http://127.0.0.1:3100/api/health',timeout:120000,reuseExistingServer:false,env:{PORT:'3100',MATRIX_DATA_DIR:path.resolve('.data','e2e-'+process.pid),ALPHA_MODE:'demo',DATABASE_URL:'',MATRIX_OWNER_PASSWORD:'browser-test-password-only-32-characters',DOUYIN_CLIENT_KEY:'',DOUYIN_CLIENT_SECRET:'',DOUYIN_REDIRECT_URI:'',DOUYIN_TOKEN_KEY:''}}
});
