import { ensureReady } from '../packages/db/seed';
import { db, storageMode } from '../packages/db/index';
await ensureReady();
console.log(`Alpha 0.01 database ready (${storageMode}, simulation only).`);
await db.close();
