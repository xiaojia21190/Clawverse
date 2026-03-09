import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PROJECT_ROOT = resolve(PACKAGE_ROOT, '..', '..');

export function getProjectRoot(): string {
  const fromEnv = process.env.CLAWVERSE_PROJECT_ROOT;
  return fromEnv ? resolve(fromEnv) : DEFAULT_PROJECT_ROOT;
}

export function resolveProjectPath(pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : resolve(getProjectRoot(), pathValue);
}

