import path from 'node:path';

// Keep all entry points on the same repository root without walking the
// filesystem at import time (Next watches imported modules in development).
export const root = path.resolve(process.env.MATRIX_ROOT || (
  path.basename(process.cwd()) === 'web' && path.basename(path.dirname(process.cwd())) === 'apps'
    ? path.resolve(process.cwd(), '../..')
    : process.cwd()
));

try {
  process.loadEnvFile(path.join(root, '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

// Resolve relative data paths against the repository, regardless of which
// process (Web, worker, or assistant) imported this module.
export const dataDir = path.resolve(/* turbopackIgnore: true */ root, process.env.MATRIX_DATA_DIR || '.data');
