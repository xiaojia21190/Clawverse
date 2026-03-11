export type RequestOperatorKind =
  | 'town-viewer'
  | 'openclaw-worker'
  | 'manual-cli'
  | 'daemon-policy'
  | 'unknown';

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

export function normalizeRemoteAddress(value: string | undefined | null): string {
  return value?.trim() || 'unknown';
}

export function isLoopbackAddress(value: string | undefined | null): boolean {
  const remote = normalizeRemoteAddress(value).toLowerCase();
  return remote === '127.0.0.1'
    || remote === '::1'
    || remote === '::ffff:127.0.0.1'
    || remote.startsWith('::ffff:127.0.0.');
}

export function resolveRequestOperatorKind(
  source: string | null,
  origin: string | null,
  userAgent: string | null,
): RequestOperatorKind {
  const normalizedSource = normalize(source);
  const normalizedOrigin = normalize(origin);
  const normalizedAgent = normalize(userAgent);

  if (normalizedSource === 'town-viewer' || normalizedSource.includes('town-viewer')) {
    return 'town-viewer';
  }
  if (normalizedSource === 'daemon-policy' || normalizedSource.includes('daemon-policy')) {
    return 'daemon-policy';
  }
  if (normalizedSource.includes('worker') || normalizedSource.includes('openclaw')) {
    return 'openclaw-worker';
  }
  if (normalizedSource === 'manual-cli' || normalizedSource.includes('cli')) {
    return 'manual-cli';
  }

  if (
    (normalizedOrigin.includes('localhost') || normalizedOrigin.includes('127.0.0.1'))
    && normalizedAgent.includes('mozilla/')
  ) {
    return 'town-viewer';
  }
  if (normalizedAgent.includes('mozilla/') && !!normalizedOrigin) {
    return 'town-viewer';
  }

  if (
    normalizedAgent.includes('curl/')
    || normalizedAgent.includes('powershell/')
    || normalizedAgent.includes('wget/')
    || normalizedAgent.includes('httpie/')
    || normalizedAgent.includes('python-requests/')
    || normalizedAgent.includes('go-http-client/')
    || normalizedAgent.includes('node-fetch/')
    || normalizedAgent.includes('undici')
    || (!normalizedSource && !normalizedOrigin && !!normalizedAgent)
    || (!normalizedSource && !normalizedOrigin && !normalizedAgent)
  ) {
    return 'manual-cli';
  }

  return 'unknown';
}
