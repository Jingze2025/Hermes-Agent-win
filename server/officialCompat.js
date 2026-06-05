import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import yaml from 'js-yaml';
import { CRON_JOBS_FILE, SKILL_TOGGLES_FILE, newId, readJson, writeJson } from './storage.js';
import { getHermesPaths, getHermesStatus, runHermesMcpList } from './hermesRuntime.js';

const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
const HERMES_ENV = path.join(HERMES_HOME, '.env');
const HERMES_CONFIG = getHermesPaths().configPath;
const CRON_POLL_MS = Number(process.env.HERMES_WEB_CRON_POLL_MS || 30000);
let cronSchedulerStarted = false;
const cronRunners = new Map();

const DEFAULT_CONFIG = {
  timezone: 'Asia/Shanghai',
  memory: { provider: 'local' },
  security: { confirm_destructive_commands: true },
  browser: { enabled: false },
  voice: { enabled: false },
  gateway: { enabled: false },
  dashboard: { enabled: true, port: 9119 },
  mcp: { enabled: true },
  tools: { filesystem: true, browser: false, shell: true },
  hooks_auto_accept: false,
  approvals: { mode: 'default' }
};

const CONFIG_SCHEMA = {
  'model.provider': { label: '模型 Provider', type: 'string', category: 'model', description: 'OpenAI-compatible / Anthropic / Gemini 等 provider 名称。' },
  'model.name': { label: '模型名称', type: 'string', category: 'model', description: '实际 API model。' },
  'model.context_length': { label: '上下文长度', type: 'number', category: 'model', description: '模型上下文窗口 token 数。' },
  timezone: { label: '时区', type: 'string', category: 'runtime', description: '默认运行时时区。' },
  'memory.provider': { label: '记忆 Provider', type: 'string', category: 'memory', description: '记忆系统 provider。' },
  'security.confirm_destructive_commands': { label: '危险命令确认', type: 'boolean', category: 'security', description: '执行破坏性命令前要求确认。' },
  'browser.enabled': { label: '浏览器能力', type: 'boolean', category: 'browser', description: '是否启用浏览器自动化能力。' },
  'voice.enabled': { label: '语音能力', type: 'boolean', category: 'voice', description: '是否启用语音输入/输出能力。' },
  'gateway.enabled': { label: '消息网关', type: 'boolean', category: 'gateway', description: '是否启用 Hermes messaging gateway。' },
  'dashboard.enabled': { label: '官方 Dashboard', type: 'boolean', category: 'dashboard', description: '是否启用官方 Dashboard 能力。' },
  'dashboard.port': { label: 'Dashboard 端口', type: 'number', category: 'dashboard', description: '官方 Dashboard 默认端口。' },
  'mcp.enabled': { label: 'MCP 能力', type: 'boolean', category: 'mcp', description: '是否启用 MCP 工具服务器。' },
  'tools.filesystem': { label: '文件系统工具', type: 'boolean', category: 'tools', description: '是否允许文件系统工具。' },
  'tools.browser': { label: '浏览器工具', type: 'boolean', category: 'tools', description: '是否允许浏览器自动化工具。' },
  'tools.shell': { label: 'Shell 工具', type: 'boolean', category: 'tools', description: '是否允许 Shell/命令执行工具。' },
  hooks_auto_accept: { label: '自动接受 Hooks', type: 'boolean', category: 'security', description: '无 TTY 场景自动接受已声明 hooks。' },
  'approvals.mode': { label: '审批模式', type: 'string', category: 'security', description: '审批/权限交互模式。' }
};

function ensureHermesHome() {
  fs.mkdirSync(HERMES_HOME, { recursive: true });
}

function parseScalar(value) {
  const trimmed = String(value || '').trim();
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^['"]|['"]$/g, '');
}

function setNested(obj, key, value) {
  const parts = key.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cur[parts[i]] = cur[parts[i]] && typeof cur[parts[i]] === 'object' ? cur[parts[i]] : {};
    cur = cur[parts[i]];
  }
  cur[parts.at(-1)] = value;
}

function getNested(obj, key) {
  return key.split('.').reduce((cur, part) => cur?.[part], obj);
}

function parseSimpleYaml(text = '') {
  const out = {};
  const stack = [{ indent: -1, value: out }];
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const match = raw.match(/^(\s*)([^:#][^:]*):\s*(.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    const key = match[2].trim();
    const rest = match[3];
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).value;
    if (rest === '') {
      parent[key] = parent[key] && typeof parent[key] === 'object' ? parent[key] : {};
      stack.push({ indent, value: parent[key] });
    } else {
      parent[key] = parseScalar(rest);
    }
  }
  return out;
}

function yamlScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (value == null) return '';
  const s = String(value);
  return /[:#\n]|^\s|\s$/.test(s) ? JSON.stringify(s) : s;
}

function toSimpleYaml(obj, indent = 0) {
  const pad = ' '.repeat(indent);
  const lines = [];
  for (const [key, value] of Object.entries(obj || {})) {
    if (Array.isArray(value)) {
      lines.push(`${pad}${key}:`);
      for (const item of value) lines.push(`${pad}  - ${yamlScalar(item)}`);
    } else if (value && typeof value === 'object') {
      lines.push(`${pad}${key}:`);
      lines.push(toSimpleYaml(value, indent + 2));
    } else {
      lines.push(`${pad}${key}: ${yamlScalar(value)}`);
    }
  }
  return lines.filter(Boolean).join('\n');
}

export function getConfigRaw() {
  const exists = fs.existsSync(HERMES_CONFIG);
  return { ok: true, path: HERMES_CONFIG, exists, yaml: exists ? fs.readFileSync(HERMES_CONFIG, 'utf8').replace(/^\uFEFF/, '') : yaml.dump(DEFAULT_CONFIG, { lineWidth: 120, noRefs: true, sortKeys: false }) };
}

export function saveConfigRaw(yamlText = '') {
  ensureHermesHome();
  fs.writeFileSync(HERMES_CONFIG, String(yamlText || '').replace(/^\uFEFF/, ''), 'utf8');
  return { ok: true, path: HERMES_CONFIG };
}

export function getConfig() {
  const raw = getConfigRaw();
  let parsed = {};
  try {
    parsed = raw.exists ? (yaml.load(raw.yaml) || {}) : {};
  } catch {
    parsed = {};
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
  return { ...structuredClone(DEFAULT_CONFIG), ...parsed, _path: HERMES_CONFIG, _exists: raw.exists };
}

export function saveConfig(config = {}) {
  const clean = { ...config };
  delete clean._path;
  delete clean._exists;
  const text = yaml.dump(clean, { lineWidth: 120, noRefs: true, sortKeys: false });
  return saveConfigRaw(text);
}

export function getConfigSchema() {
  return { fields: CONFIG_SCHEMA, category_order: ['model', 'runtime', 'memory', 'security', 'browser', 'voice', 'gateway', 'dashboard', 'mcp', 'tools'] };
}

const ENV_DESCRIPTIONS = {
  OPENAI_API_KEY: 'OpenAI API Key',
  ANTHROPIC_API_KEY: 'Anthropic API Key',
  GOOGLE_API_KEY: 'Google / Gemini API Key',
  OPENROUTER_API_KEY: 'OpenRouter API Key',
  DEEPSEEK_API_KEY: 'DeepSeek API Key',
  MOONSHOT_API_KEY: 'Moonshot / Kimi API Key',
  MINIMAX_API_KEY: 'MiniMax API Key',
  HERMES_API_KEY: 'Hermes custom API Key'
};

function parseEnv(text = '') {
  const map = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    map[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return map;
}

function writeEnv(map = {}) {
  ensureHermesHome();
  // Preserve existing file structure (comments, blank lines, ordering).
  const existing = fs.existsSync(HERMES_ENV) ? fs.readFileSync(HERMES_ENV, 'utf8') : '';
  const lines = existing.split(/\r?\n/);
  const touched = new Set();
  const updated = lines.map((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match) return line; // comment or blank
    const key = match[1];
    if (!(key in map)) return line;
    touched.add(key);
    const val = String(map[key] ?? '');
    return val ? `${key}=${val.includes(' ') ? JSON.stringify(val) : val}` : `${key}=`;
  });
  // Append new keys not already in file
  for (const [k, v] of Object.entries(map)) {
    if (touched.has(k)) continue;
    if (!v && v !== 0) continue;
    const val = String(v);
    updated.push(`${k}=${val.includes(' ') ? JSON.stringify(val) : val}`);
  }
  const out = updated.join('\n').replace(/\n{3,}/g, '\n\n');
  fs.writeFileSync(HERMES_ENV, out.endsWith('\n') ? out : out + '\n', 'utf8');
}

function mask(value = '') {
  const s = String(value || '');
  if (!s) return '';
  if (s.length <= 8) return '***';
  return `${s.slice(0, 4)}***${s.slice(-4)}`;
}

export function getEnvVars() {
  const fileVars = fs.existsSync(HERMES_ENV) ? parseEnv(fs.readFileSync(HERMES_ENV, 'utf8')) : {};
  const keys = [...new Set([...Object.keys(ENV_DESCRIPTIONS), ...Object.keys(fileVars)])].sort();
  const out = {};
  for (const key of keys) {
    const value = fileVars[key] ?? process.env[key] ?? '';
    out[key] = {
      key,
      description: ENV_DESCRIPTIONS[key] || '自定义环境变量',
      is_set: Boolean(value),
      redacted_value: mask(value),
      source: fileVars[key] != null ? HERMES_ENV : process.env[key] != null ? 'process.env' : '',
      editable: true
    };
  }
  return out;
}

export function setEnvVar(key, value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(key || ''))) throw new Error('环境变量名不合法。');
  // Only update the single key, preserving the rest of the file.
  const current = fs.existsSync(HERMES_ENV) ? parseEnv(fs.readFileSync(HERMES_ENV, 'utf8')) : {};
  current[key] = String(value || '');
  writeEnv(current);
  // Also propagate to process.env so the running server picks it up immediately.
  if (value) process.env[key] = String(value);
  else delete process.env[key];
  return { ok: true, key, info: getEnvVars()[key] };
}

export function deleteEnvVar(key) {
  const current = fs.existsSync(HERMES_ENV) ? parseEnv(fs.readFileSync(HERMES_ENV, 'utf8')) : {};
  current[key] = '';  // writeEnv will write KEY= (empty value)
  writeEnv(current);
  delete process.env[key];
  return { ok: true, key };
}

export function revealEnvVar(key) {
  const fileVars = fs.existsSync(HERMES_ENV) ? parseEnv(fs.readFileSync(HERMES_ENV, 'utf8')) : {};
  return { key, value: fileVars[key] ?? process.env[key] ?? '' };
}

export function listCronJobs() {
  return readJson(CRON_JOBS_FILE, []);
}

export function createCronJob(input = {}) {
  const prompt = String(input.prompt || '').trim();
  const schedule = String(input.schedule || '').trim();
  if (!prompt || !schedule) throw new Error('任务内容和计划不能为空。');
  const now = new Date().toISOString();
  const job = {
    id: newId('cron'),
    name: String(input.name || '').trim(),
    prompt,
    schedule,
    deliver: input.deliver || 'local',
    enabled: true,
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    runCount: 0,
    status: 'scheduled'
  };
  const jobs = [job, ...listCronJobs()];
  writeJson(CRON_JOBS_FILE, jobs);
  return job;
}

export function updateCronJob(id, patch = {}) {
  const jobs = listCronJobs();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx < 0) return null;
  jobs[idx] = { ...jobs[idx], ...patch, updatedAt: new Date().toISOString() };
  writeJson(CRON_JOBS_FILE, jobs);
  return jobs[idx];
}

export function deleteCronJob(id) {
  const jobs = listCronJobs().filter((j) => j.id !== id);
  writeJson(CRON_JOBS_FILE, jobs);
  return { ok: true, id };
}

export function cancelCronJob(id) {
  const runner = cronRunners.get(id);
  if (runner) {
    try { runner.kill?.('SIGTERM'); } catch {}
    cronRunners.delete(id);
  }
  const job = updateCronJob(id, { status: 'cancelled', enabled: false, lastResult: { ok: false, error: 'Cancelled by user.', finishedAt: new Date().toISOString() } });
  return job ? { ok: true, job } : null;
}

export function triggerCronJob(id) {
  const current = listCronJobs().find((j) => j.id === id);
  const job = updateCronJob(id, { lastRunAt: new Date().toISOString(), runCount: (current?.runCount || 0) + 1, status: 'running' });
  if (!job) return null;
  executeCronJob(job).catch(() => {});
  return { ok: true, job, note: 'Cron 任务已提交给本地 Hermes 执行器。' };
}

function parseDueTime(job) {
  const schedule = String(job.schedule || '').trim().toLowerCase();
  const now = Date.now();
  if (/^every\s+(\d+)\s*(m|min|mins|minute|minutes)$/.test(schedule)) {
    const n = Number(schedule.match(/^every\s+(\d+)/)?.[1] || 0);
    const last = job.lastRunAt ? new Date(job.lastRunAt).getTime() : 0;
    return !last || now - last >= n * 60000;
  }
  if (/^every\s+(\d+)\s*(h|hour|hours)$/.test(schedule)) {
    const n = Number(schedule.match(/^every\s+(\d+)/)?.[1] || 0);
    const last = job.lastRunAt ? new Date(job.lastRunAt).getTime() : 0;
    return !last || now - last >= n * 3600000;
  }
  if (/^daily\s+\d{1,2}:\d{2}$/.test(schedule)) {
    const [, hh, mm] = schedule.match(/^daily\s+(\d{1,2}):(\d{2})$/) || [];
    const target = new Date();
    target.setHours(Number(hh), Number(mm), 0, 0);
    const lastKey = job.lastRunAt ? new Date(job.lastRunAt).toDateString() : '';
    return now >= target.getTime() && lastKey !== new Date().toDateString();
  }
  const at = Date.parse(job.schedule);
  if (!Number.isNaN(at)) return now >= at && !job.lastRunAt;
  return false;
}

async function executeCronJob(job) {
  const prompt = String(job.prompt || '').trim();
  if (!prompt) return null;
  const command = process.platform === 'win32' ? 'hermes.cmd' : 'hermes';
  const args = ['-z', prompt];
  const startedAt = new Date().toISOString();
  const result = await new Promise((resolve) => {
    const child = execFile(command, args, { cwd: process.cwd(), timeout: 180000, windowsHide: true, maxBuffer: 3 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (error, stdout, stderr) => {
      cronRunners.delete(job.id);
      resolve({ ok: !error, code: error?.code ?? 0, output: `${stdout || ''}${stderr ? `\n${stderr}` : ''}`.trim(), error: error?.message || '' });
    });
    cronRunners.set(job.id, child);
    child.on('error', (error) => {
      cronRunners.delete(job.id);
      resolve({ ok: false, code: error?.code || 'ERR', output: '', error: error?.message || String(error) });
    });
  });
  const current = listCronJobs().find((j) => j.id === job.id) || job;
  if (current.status === 'cancelled') return current;
  const run = { startedAt, finishedAt: new Date().toISOString(), ...result };
  return updateCronJob(job.id, {
    lastRunAt: run.finishedAt,
    runCount: (current.runCount || 0) + (current.status === 'running' ? 0 : 1),
    status: result.ok ? 'completed' : 'failed',
    lastResult: run
  });
}

export function startCronScheduler() {
  if (cronSchedulerStarted) return { ok: true, alreadyStarted: true };
  cronSchedulerStarted = true;
  setInterval(() => {
    for (const job of listCronJobs()) {
      if (!job.enabled || job.status === 'running') continue;
      if (parseDueTime(job)) {
        updateCronJob(job.id, { status: 'running' });
        executeCronJob(job).catch((error) => updateCronJob(job.id, { status: 'failed', lastResult: { ok: false, error: error?.message || String(error), finishedAt: new Date().toISOString() } }));
      }
    }
  }, CRON_POLL_MS).unref?.();
  return { ok: true, pollMs: CRON_POLL_MS };
}

function skillToggles() {
  return readJson(SKILL_TOGGLES_FILE, {});
}

function writeSkillToggles(payload) {
  writeJson(SKILL_TOGGLES_FILE, payload || {});
}

function discoverSkillDirs() {
  const roots = [
    path.join(HERMES_HOME, 'skills'),
    path.join(process.cwd(), 'runtime', 'hermes-official', 'skills'),
    path.join(process.cwd(), '..', 'skills')
  ];
  const found = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      const skillFile = path.join(dir, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        const name = path.basename(dir);
        const text = fs.readFileSync(skillFile, 'utf8').slice(0, 1200);
        const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() || name;
        const description = text.split(/\r?\n/).find((line) => line.trim() && !line.startsWith('#'))?.trim() || '';
        found.push({ name, title, description, category: path.basename(path.dirname(dir)), path: dir, source: root });
        continue;
      }
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).slice(0, 200)) {
        stack.push(path.join(dir, entry.name));
      }
    }
  }
  return found;
}

export async function getSkillsApi() {
  const toggles = skillToggles();
  const diskSkills = discoverSkillDirs();
  const status = await getHermesStatus().catch(() => null);
  const mcpSkills = (status?.config?.servers || []).map((server) => ({
    name: `mcp:${server.name}`,
    title: server.name,
    description: `${server.command || ''} ${(server.args || []).join(' ')}`.trim(),
    category: 'mcp',
    path: HERMES_CONFIG,
    source: 'mcp_servers'
  }));
  return [...diskSkills, ...mcpSkills].map((skill) => ({
    ...skill,
    enabled: toggles[skill.name] ?? true
  }));
}

export async function getToolsetsApi() {
  const status = await getHermesStatus().catch(() => null);
  const mcp = await runHermesMcpList().catch(() => null);
  return [
    {
      name: 'mcp_servers',
      configured: (status?.config?.servers || []).length > 0,
      tools: (status?.config?.servers || []).map((s) => s.name),
      description: 'Hermes config.yaml MCP servers'
    },
    {
      name: 'hermes_mcp_list',
      configured: Boolean(mcp?.ok),
      tools: String(mcp?.output || '').split(/\r?\n/).filter(Boolean),
      description: 'hermes mcp list output'
    }
  ];
}

export async function toggleSkill(name, enabled) {
  const toggles = skillToggles();
  toggles[String(name || '')] = Boolean(enabled);
  writeSkillToggles(toggles);
  return { ok: true, name, enabled: Boolean(enabled) };
}

export function getOAuthProviders() {
  const env = getEnvVars();
  const providers = [
    { id: 'openai', name: 'OpenAI', key: 'OPENAI_API_KEY', flow: 'api-key', docs_url: 'https://platform.openai.com/api-keys' },
    { id: 'anthropic', name: 'Anthropic', key: 'ANTHROPIC_API_KEY', flow: 'api-key', docs_url: 'https://console.anthropic.com/settings/keys' },
    { id: 'google', name: 'Google Gemini', key: 'GOOGLE_API_KEY', flow: 'api-key', docs_url: 'https://aistudio.google.com/app/apikey' },
    { id: 'openrouter', name: 'OpenRouter', key: 'OPENROUTER_API_KEY', flow: 'api-key', docs_url: 'https://openrouter.ai/keys' },
    { id: 'deepseek', name: 'DeepSeek', key: 'DEEPSEEK_API_KEY', flow: 'api-key', docs_url: 'https://platform.deepseek.com/api_keys' },
    { id: 'moonshot', name: 'Moonshot / Kimi', key: 'MOONSHOT_API_KEY', flow: 'api-key', docs_url: 'https://platform.moonshot.cn/console/api-keys' }
  ];
  return { providers: providers.map((p) => ({
    ...p,
    cli_command: `设置 ${p.key}`,
    status: {
      logged_in: Boolean(env[p.key]?.is_set),
      token_preview: env[p.key]?.redacted_value || '',
      source_label: env[p.key]?.source || '',
      expires_at: null,
      error: ''
    }
  })) };
}

export function disconnectOAuthProvider(providerId) {
  const map = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GOOGLE_API_KEY', openrouter: 'OPENROUTER_API_KEY', deepseek: 'DEEPSEEK_API_KEY', moonshot: 'MOONSHOT_API_KEY' };
  const key = map[providerId];
  if (!key) return { ok: false, error: 'Unknown provider.' };
  return deleteEnvVar(key);
}
