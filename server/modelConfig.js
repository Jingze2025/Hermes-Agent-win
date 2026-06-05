/**
 * Model configuration — single source of truth.
 *
 * We use the same storage that the Hermes CLI reads, so the Web UI, the old
 * 京择AGI UI and the Hermes CLI all stay in sync across Windows/Mac/Linux:
 *
 *   data/.env         → API keys and per-provider BASE_URL overrides
 *   data/config.yaml  → default model + provider + base_url (Hermes schema)
 *   data/providers.json → shared provider catalog (optional, editable)
 *   data/model-config.json → auxiliary Web-UI-only cache (label, updatedAt)
 *
 * Writing the UI form goes straight into .env + config.yaml, so the
 * hermes CLI, hermes doctor and any other tooling see the change
 * immediately — no restart dance required.
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { DATA_DIR } from './storage.js';

const HERMES_HOME = process.env.HERMES_HOME ? path.resolve(process.env.HERMES_HOME) : DATA_DIR;
const ENV_FILE = path.join(HERMES_HOME, '.env');
const CONFIG_FILE = path.join(HERMES_HOME, 'config.yaml');
const PROVIDERS_FILE = path.join(HERMES_HOME, 'providers.json');
const MODEL_CONFIG_CACHE = path.join(HERMES_HOME, 'model-config.json');

// -----------------------------------------------------------------------------
// Fallback provider catalog (used only if data/providers.json is missing).
// Keep schema identical to providers.json.
// -----------------------------------------------------------------------------
const FALLBACK_PROVIDERS = {
  openrouter: {
    name: 'OpenRouter',
    desc: '全球模型聚合入口',
    provider_slug: 'openrouter',
    protocol: 'openai',
    env_key: 'OPENROUTER_API_KEY',
    base_url: 'https://openrouter.ai/api/v1',
    base_url_env: 'OPENROUTER_BASE_URL',
    models: []
  },
  openai: {
    name: 'OpenAI 官方',
    provider_slug: 'openai',
    protocol: 'openai',
    env_key: 'OPENAI_API_KEY',
    base_url: 'https://api.openai.com/v1',
    base_url_env: 'OPENAI_BASE_URL',
    models: []
  },
  anthropic: {
    name: 'Anthropic Claude',
    provider_slug: 'anthropic',
    protocol: 'anthropic',
    env_key: 'ANTHROPIC_API_KEY',
    base_url: '',
    models: []
  },
  custom: {
    name: '自定义 OpenAI 兼容',
    provider_slug: 'custom',
    protocol: 'openai',
    env_key: 'OPENAI_API_KEY',
    base_url: '',
    models: []
  }
};

function loadProviders() {
  try {
    if (fs.existsSync(PROVIDERS_FILE)) {
      const raw = fs.readFileSync(PROVIDERS_FILE, 'utf8').replace(/^\uFEFF/, '');
      const json = JSON.parse(raw);
      if (json?.providers && typeof json.providers === 'object') return json.providers;
    }
  } catch (error) {
    console.error('读取 providers.json 失败，使用回退目录:', error?.message || error);
  }
  return FALLBACK_PROVIDERS;
}

function providerById(id) {
  const providers = loadProviders();
  return providers[id] || providers.custom || FALLBACK_PROVIDERS.custom;
}

// -----------------------------------------------------------------------------
// .env helpers — preserve comments, update in place.
// -----------------------------------------------------------------------------
function readEnvMap() {
  const out = {};
  if (!fs.existsSync(ENV_FILE)) return out;
  const text = fs.readFileSync(ENV_FILE, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function upsertEnvKeys(updates = {}) {
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true });
  const original = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const lines = original.split(/\r?\n/);
  const touched = new Set();
  const renderValue = (v) => {
    const s = String(v ?? '');
    // Quote if contains spaces, quotes or # so dotenv treats it as a single token.
    return /[\s"'#]/.test(s) ? JSON.stringify(s) : s;
  };

  const updated = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const idx = trimmed.indexOf('=');
    if (idx < 0) return line;
    const key = trimmed.slice(0, idx).trim();
    if (!(key in updates)) return line;
    touched.add(key);
    const nextVal = updates[key];
    if (nextVal === '' || nextVal == null) return `${key}=`;
    return `${key}=${renderValue(nextVal)}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (touched.has(key)) continue;
    if (value === '' || value == null) continue;
    updated.push(`${key}=${renderValue(value)}`);
  }

  const out = updated.join('\n').replace(/\n{3,}/g, '\n\n');
  fs.writeFileSync(ENV_FILE, out.endsWith('\n') ? out : out + '\n', 'utf8');

  // Propagate to current process so the new key is visible immediately.
  for (const [k, v] of Object.entries(updates)) {
    if (v === '' || v == null) delete process.env[k];
    else process.env[k] = String(v);
  }
}

// -----------------------------------------------------------------------------
// config.yaml helpers — Hermes schema: { model: { default, provider, base_url } }
// -----------------------------------------------------------------------------
function readConfigYaml() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, '');
    const parsed = yaml.load(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.error('读取 config.yaml 失败:', error?.message || error);
    return {};
  }
}

function writeConfigYaml(data) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  const text = yaml.dump(data, { lineWidth: 120, noRefs: true, sortKeys: false });
  fs.writeFileSync(CONFIG_FILE, text, 'utf8');
}

// -----------------------------------------------------------------------------
// Auxiliary UI cache — only stores the friendly label + updatedAt.
// Never holds the actual key or URL (those live in .env / config.yaml).
// -----------------------------------------------------------------------------
function readUiCache() {
  try {
    if (!fs.existsSync(MODEL_CONFIG_CACHE)) return {};
    return JSON.parse(fs.readFileSync(MODEL_CONFIG_CACHE, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return {};
  }
}

function writeUiCache(cache) {
  fs.mkdirSync(path.dirname(MODEL_CONFIG_CACHE), { recursive: true });
  fs.writeFileSync(MODEL_CONFIG_CACHE, JSON.stringify(cache, null, 2), 'utf8');
}

// -----------------------------------------------------------------------------
// Model identity — always derived fresh from .env + config.yaml.
// -----------------------------------------------------------------------------
function maskKey(key = '') {
  if (!key) return '';
  if (key.length <= 10) return '***';
  return `${key.slice(0, 6)}***${key.slice(-4)}`;
}

function normalizeProviderId(raw) {
  return String(raw || '').trim().toLowerCase() || 'custom';
}

function resolveCurrent() {
  const cfg = readConfigYaml();
  const model = cfg.model && typeof cfg.model === 'object' ? cfg.model : {};
  const apiModel = String(model.default || model.model || model.name || '').trim();
  const providerId = normalizeProviderId(model.provider);
  const baseUrl = String(model.base_url || '').trim().replace(/\/+$/, '');
  if (!apiModel) return null;

  const preset = providerById(providerId);
  const env = readEnvMap();
  const envKey = preset.env_key || 'OPENAI_API_KEY';
  const apiKey = env[envKey] || process.env[envKey] || '';
  const resolvedBaseUrl = baseUrl || (preset.base_url_env && env[preset.base_url_env]) || preset.base_url || '';

  const cache = readUiCache();
  const label = cache.label || `${preset.name || providerId} · ${apiModel}`;

  return {
    id: providerId === 'custom' ? `custom/${apiModel}` : `${providerId}/${apiModel}`,
    source: cache.source || 'custom',
    officialProvider: providerId,
    provider: preset.protocol || 'openai',
    label,
    apiModel,
    baseUrl: resolvedBaseUrl,
    apiKey,
    envKey,
    updatedAt: cache.updatedAt || ''
  };
}

function publicFromRuntime(runtime) {
  if (!runtime) return null;
  return {
    id: runtime.id,
    source: runtime.source,
    officialProvider: runtime.officialProvider,
    provider: runtime.provider,
    label: runtime.label,
    apiModel: runtime.apiModel,
    baseUrl: runtime.baseUrl,
    apiKeyMasked: maskKey(runtime.apiKey),
    apiKeyConfigured: Boolean(runtime.apiKey),
    envKey: runtime.envKey,
    updatedAt: runtime.updatedAt
  };
}

// -----------------------------------------------------------------------------
// Public API — used by the server.
// -----------------------------------------------------------------------------
export function getOfficialProviders() {
  const presets = loadProviders();
  const env = readEnvMap();
  return Object.entries(presets).map(([id, p]) => ({
    id,
    label: p.name || id,
    desc: p.desc || '',
    aliases: [],
    authenticated: Boolean(env[p.env_key] || process.env[p.env_key]),
    protocol: p.protocol || 'openai',
    baseUrl: p.base_url || '',
    baseUrlEnv: p.base_url_env || '',
    env: p.env_key || '',
    envPrefix: p.env_prefix || ''
  }));
}

export function getOfficialModels(provider = 'openrouter') {
  const presets = loadProviders();
  const id = normalizeProviderId(provider);
  const preset = presets[id] || presets.custom || {};
  return {
    provider: id,
    label: preset.name || id,
    models: Array.isArray(preset.models) ? preset.models.map((m) => ({ id: m.id, description: m.name || '' })) : []
  };
}

export function getCustomModelConfig() {
  return resolveCurrent();
}

export function saveCustomModelConfig(input = {}) {
  const providerId = normalizeProviderId(input.officialProvider || input.providerId || input.provider);
  const preset = providerById(providerId);
  const apiModel = String(input.apiModel || input.model || '').trim();
  const baseUrlInput = String(input.baseUrl ?? '').trim().replace(/\/+$/, '');
  const apiKey = String(input.apiKey || '').trim();
  const label = String(input.label || '').trim() || `${preset.name || providerId} · ${apiModel || '模型'}`;

  if (!apiModel) throw new Error('请选择或填写需要调用的模型名。');
  if ((preset.protocol || 'openai') !== 'anthropic' && !baseUrlInput && !preset.base_url) {
    throw new Error('请填写连接网址 Base URL。');
  }
  // Key is allowed to be blank if previously set — we keep the existing one.

  const baseUrl = baseUrlInput || preset.base_url || '';

  // 1) Update config.yaml (Hermes native schema).
  const cfg = readConfigYaml();
  const modelCfg = (cfg.model && typeof cfg.model === 'object') ? { ...cfg.model } : {};
  modelCfg.default = apiModel;
  modelCfg.provider = providerId;
  if (baseUrl) modelCfg.base_url = baseUrl;
  else delete modelCfg.base_url;
  cfg.model = modelCfg;
  writeConfigYaml(cfg);

  // 2) Update .env (API key + optional per-provider BASE_URL override).
  const envUpdates = {};
  if (apiKey) {
    const envKey = preset.env_key || 'OPENAI_API_KEY';
    envUpdates[envKey] = apiKey;
    // Mirror to OPENAI_API_KEY for providers routed through the custom/OpenAI protocol
    // so aux clients (e.g. auxiliary_client) pick it up too.
    if (preset.protocol === 'openai' && envKey !== 'OPENAI_API_KEY' && providerId === 'custom') {
      envUpdates.OPENAI_API_KEY = apiKey;
    }
  }
  if (baseUrl && preset.base_url_env) envUpdates[preset.base_url_env] = baseUrl;
  if (Object.keys(envUpdates).length) upsertEnvKeys(envUpdates);

  // 3) Update UI cache (label only).
  writeUiCache({
    label,
    source: input.source || 'custom',
    updatedAt: new Date().toISOString()
  });

  return getPublicModelConfig();
}

export function getDefaultModelId() {
  return resolveCurrent()?.id || '';
}

export function getPublicModelConfig() {
  const runtime = resolveCurrent();
  return {
    current: runtime ? publicFromRuntime(runtime) : null,
    providers: getOfficialProviders(),
    hermesConfigPath: CONFIG_FILE,
    envPath: ENV_FILE,
    providersPath: PROVIDERS_FILE
  };
}

export function getPublicModels() {
  const runtime = resolveCurrent();
  if (!runtime) return [];
  return [{
    id: runtime.id,
    apiModel: runtime.apiModel,
    label: runtime.label,
    provider: runtime.provider,
    officialProvider: runtime.officialProvider,
    baseUrl: runtime.baseUrl,
    custom: true
  }];
}

export function resolveModelRuntime(modelId) {
  const runtime = resolveCurrent();
  if (!runtime) {
    return { id: modelId || '', apiModel: modelId || '', label: modelId || '未配置模型', provider: '', baseUrl: '', apiKey: '' };
  }
  // Any id is acceptable — we always serve the single active runtime,
  // matching the behaviour of Hermes CLI (one default model at a time).
  return runtime;
}
