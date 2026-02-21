import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SecurityConfig {
  allowedPeers: string[];
  sharedSecret?: string;
  requireSignedIngress?: boolean;
  maxMsgsPer10s?: number;
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
