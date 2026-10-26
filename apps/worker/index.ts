import { randomUUID } from 'node:crypto';
import { tick } from './engine';
import { db } from '../../packages/db/index';
let stopped=false;
const id=randomUUID();
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{stopped=true;});
console.log('[worker] Alpha 0.01 simulation engine running. No real publishing or spending.');
while(!stopped){try{await tick(id);}catch(error){console.error('[worker]',error instanceof Error?error.message:'Task engine error');}await new Promise(r=>setTimeout(r,1000));}
await db.close();
