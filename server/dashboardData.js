import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listSessions, searchSessions } from './sessions.js';
import { getHermesStatus, runHermesMcpList } from './hermesRuntime.js';

const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
const LOG_DIR = path.join(HERMES_HOME, 'logs');

const LOG_FILES = {
  agent: 'agent.log',
  errors: 'errors.log',
  gateway: 'gateway.log',
  mcp: 'mcp-stderr.log'
};

function readTail(file, maxLines = 300) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.slice(-Math.max(1, Math.min(Number(maxLines) || 300, 2000)));
}

function lineLevel(line = '') {
  const value = String(line).toLowerCase();
  if (/\b(error|exception|traceback|failed|fatal)\b/.test(value)) return 'error';
  if (/\b(warn|warning|deprecated)\b/.test(value)) return 'warn';
  if (/\b(debug|trace)\b/.test(value)) return 'debug';
  return 'info';
}

function lineComponent(line = '') {
  const value = String(line).toLowerCase();
  for (const key of ['gateway', 'agent', 'tools', 'tool', 'cli', 'cron', 'mcp', 'web', 'auth']) {
    if (value.includes(key)) return key === 'tool' ? 'tools' : key;
  }
  return 'general';
}

export function getLogFiles() {
  return Object.entries(LOG_FILES).map(([id, name]) => {
    const file = path.join(LOG_DIR, name);
    const exists = fs.existsSync(file);
    const stat = exists ? fs.statSync(file) : null;
    return {
      id,
      name,
      path: file,
      exists,
      size: stat?.size || 0,
      updatedAt: stat?.mtime?.toISOString?.() || null
    };
  });
}

export function getLogs({ file = 'agent', lines = 300, level = 'all', component = 'all', q = '' } = {}) {
  const safeFile = LOG_FILES[file] ? file : 'agent';
  const fullPath = path.join(LOG_DIR, LOG_FILES[safeFile]);
  const query = String(q || '').trim().toLowerCase();
  const rawLines = readTail(fullPath, lines);
  const entries = rawLines.map((text, index) => ({
    id: `${safeFile}-${index}`,
    file: safeFile,
    text,
    level: lineLevel(text),
    component: lineComponent(text)
  })).filter((entry) => {
    if (level !== 'all' && entry.level !== level) return false;
    if (component !== 'all' && entry.component !== component) return false;
    if (query && !entry.text.toLowerCase().includes(query)) return false;
    return true;
  });
  return {
    ok: true,
    file: safeFile,
    path: fullPath,
    exists: fs.existsSync(fullPath),
    files: getLogFiles(),
    entries,
    count: entries.length,
    readLines: rawLines.length,
    checkedAt: new Date().toISOString()
  };
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function tokenUsageOf(session = {}) {
  const usage = session.tokenUsage || {};
  const prompt = Number(usage.prompt || usage.input || 0);
  const completion = Number(usage.completion || usage.output || 0);
  const total = Number(usage.total || prompt + completion || 0);
  return { prompt, completion, total: total || prompt + completion };
}

export async function getAnalytics({ days = 30 } = {}) {
  const range = Math.max(1, Math.min(Number(days) || 30, 365));
  const sessions = listSessions();
  const sinceMs = Date.now() - range * 86400000;
  const dailyMap = new Map();
  const modelMap = new Map();
  const skillMap = new Map();

  for (let i = range - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86400000);
    dailyMap.set(dayKey(d), { date: dayKey(d), sessions: 0, messages: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0 });
  }

  for (const session of sessions) {
    const updated = new Date(session.updatedAt || session.createdAt || 0);
    if (Number.isNaN(updated.getTime()) || updated.getTime() < sinceMs) continue;
    const key = dayKey(updated);
    const usage = tokenUsageOf(session);
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const daily = dailyMap.get(key) || { date: key, sessions: 0, messages: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    daily.sessions += 1;
    daily.messages += messages.length;
    daily.input_tokens += usage.prompt;
    daily.output_tokens += usage.completion;
    daily.total_tokens += usage.total;
    dailyMap.set(key, daily);

    const model = session.model || 'unknown';
    const modelEntry = modelMap.get(model) || { model, sessions: 0, messages: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    modelEntry.sessions += 1;
    modelEntry.messages += messages.length;
    modelEntry.input_tokens += usage.prompt;
    modelEntry.output_tokens += usage.completion;
    modelEntry.total_tokens += usage.total;
    modelMap.set(model, modelEntry);

    for (const msg of messages) {
      const content = String(msg.content || '');
      const match = content.match(/【技能列表】([^\n]+)/);
      if (!match) continue;
      for (const name of match[1].split(/[、,，]/).map((s) => s.trim()).filter(Boolean)) {
        const item = skillMap.get(name) || { skill: name, loads: 0, last_used_at: null };
        item.loads += 1;
        item.last_used_at = session.updatedAt || session.createdAt || item.last_used_at;
        skillMap.set(name, item);
      }
    }
  }

  const totals = [...dailyMap.values()].reduce((acc, d) => {
    acc.total_sessions += d.sessions;
    acc.total_messages += d.messages;
    acc.total_input += d.input_tokens;
    acc.total_output += d.output_tokens;
    acc.total_tokens += d.total_tokens;
    return acc;
  }, { total_sessions: 0, total_messages: 0, total_input: 0, total_output: 0, total_tokens: 0 });

  let runtime = null;
  try { runtime = await getHermesStatus(); } catch { runtime = null; }

  return {
    ok: true,
    source: 'local-sessions',
    days: range,
    generatedAt: new Date().toISOString(),
    totals,
    daily: [...dailyMap.values()],
    by_model: [...modelMap.values()].sort((a, b) => b.total_tokens - a.total_tokens),
    skills: {
      summary: {
        total_skill_loads: [...skillMap.values()].reduce((sum, s) => sum + s.loads, 0),
        distinct_skills_used: skillMap.size
      },
      top_skills: [...skillMap.values()].sort((a, b) => b.loads - a.loads).slice(0, 20)
    },
    runtime: runtime ? {
      ok: runtime.ok,
      hermes: runtime.hermes?.version || runtime.hermes?.command || '',
      mcpServers: runtime.config?.servers?.length || 0
    } : null
  };
}

export async function getOfficialSkillsSnapshot() {
  const status = await getHermesStatus().catch(() => null);
  const mcp = await runHermesMcpList().catch((error) => ({ ok: false, error: error?.message || String(error), output: '' }));
  const servers = status?.config?.servers || [];
  return {
    ok: true,
    source: 'hermes-runtime-snapshot',
    skills: [],
    toolsets: [
      {
        name: 'mcp_servers',
        description: 'Hermes config.yaml 中配置的 MCP servers。',
        configured: servers.length > 0,
        tools: servers.map((server) => server.name)
      },
      {
        name: 'hermes_mcp_list',
        description: 'hermes mcp list 输出快照。',
        configured: Boolean(mcp?.ok),
        tools: String(mcp?.output || '').split(/\r?\n/).filter(Boolean).slice(0, 50)
      }
    ],
    runtime: status ? { ok: status.ok, configPath: status.paths?.configPath, servers } : null,
    mcp
  };
}
