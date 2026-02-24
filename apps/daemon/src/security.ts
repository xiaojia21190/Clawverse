import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SecurityConfig {
  allowedPeers: string[];
  sharedSecret?: string;
  requireSignedIngress?: boolean;
  maxMsgsPer10s?: number;
}

export interface SecurityValidation {
  ok: boolean;
  mode: 'open' | 'allowlist' | 'signed';
  warnings: string[];
  errors: string[];
}

export function loadSecurityConfig(): SecurityConfig {
  const fromEnv = {
    allowedPeers: (process.env.CLAWVERSE_ALLOWED_PEERS || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    sharedSecret: process.env.CLAWVERSE_SHARED_SECRET || undefined,
    requireSignedIngress: process.env.CLAWVERSE_REQUIRE_SIGNED_INGRESS === 'true',
    maxMsgsPer10s: process.env.CLAWVERSE_MAX_MSGS_PER_10S
      ? Number(process.env.CLAWVERSE_MAX_MSGS_PER_10S)
      : undefined,
  };

  const filePath = process.env.CLAWVERSE_SECURITY_CONFIG_PATH || 'data/security/network.json';
  const full = resolve(process.cwd(), filePath);

  if (!existsSync(full)) {
    return fromEnv;
  }

  try {
    const parsed = JSON.parse(readFileSync(full, 'utf8')) as SecurityConfig;
    return {
      allowedPeers: parsed.allowedPeers?.length ? parsed.allowedPeers : fromEnv.allowedPeers,
      sharedSecret: parsed.sharedSecret || fromEnv.sharedSecret,
      requireSignedIngress:
        typeof parsed.requireSignedIngress === 'boolean'
          ? parsed.requireSignedIngress
          : fromEnv.requireSignedIngress,
      maxMsgsPer10s:
        typeof parsed.maxMsgsPer10s === 'number' ? parsed.maxMsgsPer10s : fromEnv.maxMsgsPer10s,
    };
  } catch {
    return fromEnv;
  }
}

const WEAK_SECRET_EXAMPLES = new Set([
  'replace-with-long-random-secret',
  'secret',
  'changeme',
  'password',
  'clawverse',
]);

const PEER_ID_RE = /^[0-9a-f]{16}$/i;

export function validateSecurityConfig(config: SecurityConfig): SecurityValidation {
  const warnings: string[] = [];
  const errors: string[] = [];

  if ((config.requireSignedIngress || !!config.sharedSecret) && !config.sharedSecret) {
    errors.push('Signed ingress requested but sharedSecret is missing.');
  }

  if (config.sharedSecret) {
    if (config.sharedSecret.length < 32) {
      errors.push(
        `sharedSecret is too short (${config.sharedSecret.length} chars); minimum is 32.`,
      );
    }
    if (WEAK_SECRET_EXAMPLES.has(config.sharedSecret.toLowerCase())) {
      errors.push('sharedSecret is a known example/default value; replace it with a random key.');
    }
  }

  if (!config.allowedPeers?.length) {
    warnings.push('Peer allowlist is empty (open peer discovery).');
  } else {
    const invalid = config.allowedPeers.filter((id) => !PEER_ID_RE.test(id));
    if (invalid.length) {
      errors.push(
        `allowedPeers contains invalid peer ID(s) (expected 16 hex chars): ${invalid.join(', ')}`,
      );
    }
  }

  if (!config.sharedSecret) {
    warnings.push('Message signing is disabled (unsigned transport).');
  }

  if ((config.maxMsgsPer10s || 0) > 1000) {
    warnings.push('Ingress rate limit is very high; consider lowering maxMsgsPer10s.');
  }

  let mode: SecurityValidation['mode'] = 'open';
  if (config.sharedSecret || config.requireSignedIngress) mode = 'signed';
  else if (config.allowedPeers?.length) mode = 'allowlist';

  return {
    ok: errors.length === 0,
    mode,
    warnings,
    errors,
  };
}
