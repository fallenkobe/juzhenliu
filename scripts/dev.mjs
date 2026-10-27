import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const port = process.env.PORT || '3000';
const env = { ...process.env, MATRIX_ROOT: root };
const children = [
  spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), process.argv.includes('--production')?'start':'dev', path.join(root, 'apps/web'), '--hostname', '127.0.0.1', '--port', port], { cwd: root, env, stdio: 'inherit' }),
  spawn(process.execPath, ['--import', 'tsx', path.join(root, 'apps/worker/index.ts')], { cwd: root, env, stdio: 'inherit' })
];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 150).unref();
}
for (const child of children) child.on('exit', code => stop(code ?? 0));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
