import path from 'node:path';
import { root, dataDir } from '../config/env';

export const assistantRoot = root;
export const assistantDirectory = path.join(dataDir, 'browser-assistant');
