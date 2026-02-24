/**
 * Clawverse LLM Client
 * Routes all LLM calls through OpenClaw's configured providers
 * instead of requiring `claude` CLI.
 *
 * Supports: openai-completions, openai-responses, anthropic-messages
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Config ────────────────────────────────────────────────────────────────

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  api: string;
  models: { id: string; name: string }[];
}

interface OpenClawConfig {
  models?: {
    providers?: Record<string, ProviderConfig>;
  };
  agents?: {
    defaults?: {
      model?: { primary?: string };
    };
  };
}

const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH
  || resolve(process.env.HOME || '/root', '.openclaw/openclaw.json');

const CLAWVERSE_LLM_PROVIDER = process.env.CLAWVERSE_LLM_PROVIDER || '';
const CLAWVERSE_LLM_MODEL = process.env.CLAWVERSE_LLM_MODEL || '';

// Allow direct override via env (skip config file)
const CLAWVERSE_LLM_BASE_URL = process.env.CLAWVERSE_LLM_BASE_URL || '';
const CLAWVERSE_LLM_API_KEY = process.env.CLAWVERSE_LLM_API_KEY || '';
const CLAWVERSE_LLM_API_TYPE = process.env.CLAWVERSE_LLM_API_TYPE || ''; // openai-completions | anthropic-messages

function loadOpenClawConfig(): OpenClawConfig | null {
  if (!existsSync(OPENCLAW_CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(OPENCLAW_CONFIG_PATH, 'utf8')) as OpenClawConfig;
  } catch {
    return null;
  }
}

interface ResolvedProvider {
  baseUrl: string;
  apiKey: string;
  apiType: string;
  model: string;
}

function resolveProvider(): ResolvedProvider {
  // Priority 1: direct env override
  if (CLAWVERSE_LLM_BASE_URL && CLAWVERSE_LLM_API_KEY) {
    return {
      baseUrl: CLAWVERSE_LLM_BASE_URL.replace(/\/+$/, ''),
      apiKey: CLAWVERSE_LLM_API_KEY,
      apiType: CLAWVERSE_LLM_API_TYPE || 'openai-completions',
      model: CLAWVERSE_LLM_MODEL || 'gpt-4o-mini',
    };
  }

  // Priority 2: read from OpenClaw config
  const config = loadOpenClawConfig();
  if (!config?.models?.providers) {
    throw new Error(
      'No LLM provider configured. Set CLAWVERSE_LLM_BASE_URL + CLAWVERSE_LLM_API_KEY env vars, '
      + `or ensure OpenClaw config exists at ${OPENCLAW_CONFIG_PATH}`
    );
  }

  const providers = config.models.providers;

  // If explicit provider requested
  if (CLAWVERSE_LLM_PROVIDER && providers[CLAWVERSE_LLM_PROVIDER]) {
    const p = providers[CLAWVERSE_LLM_PROVIDER];
    const model = CLAWVERSE_LLM_MODEL || p.models?.[0]?.id || 'gpt-4o-mini';
    return {
      baseUrl: p.baseUrl.replace(/\/+$/, ''),
      apiKey: p.apiKey,
      apiType: p.api,
      model,
    };
  }

  // Otherwise: use the default model from agents.defaults.model.primary
  const primaryModel = config.agents?.defaults?.model?.primary || '';
  // Format: "provider/model-id"
  const [providerName, modelId] = primaryModel.includes('/')
    ? [primaryModel.split('/')[0], primaryModel.split('/').slice(1).join('/')]
    : ['', ''];

  if (providerName && providers[providerName]) {
    const p = providers[providerName];
    return {
      baseUrl: p.baseUrl.replace(/\/+$/, ''),
      apiKey: p.apiKey,
      apiType: p.api,
      model: modelId || CLAWVERSE_LLM_MODEL || p.models?.[0]?.id || 'gpt-4o-mini',
    };
  }

  // Fallback: pick first provider
  const firstKey = Object.keys(providers)[0];
  if (!firstKey) throw new Error('No providers found in OpenClaw config');
  const p = providers[firstKey];
  return {
    baseUrl: p.baseUrl.replace(/\/+$/, ''),
    apiKey: p.apiKey,
    apiType: p.api,
    model: CLAWVERSE_LLM_MODEL || p.models?.[0]?.id || 'gpt-4o-mini',
  };
}

// ─── API Calls ─────────────────────────────────────────────────────────────

async function callOpenAICompletions(
  provider: ResolvedProvider,
  prompt: string,
  maxTokens: number,
): Promise<string> {
  const url = `${provider.baseUrl}/chat/completions`;
  const body = {
    model: provider.model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature: 0.7,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

async function callAnthropicMessages(
  provider: ResolvedProvider,
  prompt: string,
  maxTokens: number,
): Promise<string> {
  const url = `${provider.baseUrl}/v1/messages`;
  const body = {
    model: provider.model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    content?: { type: string; text: string }[];
  };
  return data.content?.find(c => c.type === 'text')?.text?.trim() ?? '';
}

async function callOpenAIResponses(
  provider: ResolvedProvider,
  prompt: string,
  maxTokens: number,
): Promise<string> {
  // openai-responses uses the /responses endpoint (newer API)
  // Fall back to /chat/completions which is more broadly supported
  return callOpenAICompletions(provider, prompt, maxTokens);
}

// ─── Public API ────────────────────────────────────────────────────────────

let _cachedProvider: ResolvedProvider | null = null;

function getProvider(): ResolvedProvider {
  if (!_cachedProvider) {
    _cachedProvider = resolveProvider();
  }
  return _cachedProvider;
}

/**
 * Generate text from a prompt using OpenClaw's configured LLM provider.
 */
export async function llmGenerate(
  prompt: string,
  options?: { maxTokens?: number; model?: string },
): Promise<string> {
  const provider = { ...getProvider() };
  if (options?.model) provider.model = options.model;
  const maxTokens = options?.maxTokens ?? 512;

  switch (provider.apiType) {
    case 'anthropic-messages':
      return callAnthropicMessages(provider, prompt, maxTokens);
    case 'openai-responses':
      return callOpenAIResponses(provider, prompt, maxTokens);
    case 'openai-completions':
    default:
      return callOpenAICompletions(provider, prompt, maxTokens);
  }
}

/**
 * Get info about the resolved provider (for logging).
 */
export function llmProviderInfo(): { provider: string; model: string; apiType: string } {
  const p = getProvider();
  return { provider: p.baseUrl, model: p.model, apiType: p.apiType };
}
