import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = resolve(SCRIPT_DIR, '..', '..');

export function getProjectRoot() {
  return process.env.CLAWVERSE_PROJECT_ROOT
    ? resolve(process.env.CLAWVERSE_PROJECT_ROOT)
    : DEFAULT_PROJECT_ROOT;
}

export function resolveProjectPath(pathValue) {
  return isAbsolute(pathValue) ? pathValue : resolve(getProjectRoot(), pathValue);
}

