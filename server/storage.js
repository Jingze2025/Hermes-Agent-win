import path from 'node:path';
import fs from 'node:fs';

export const ROOT = path.resolve(process.cwd(), '..');
export const DATA_DIR = path.resolve(ROOT, process.env.HERMES_HOME || './data');
export const WORKSPACE_DIR = path.resolve(ROOT, process.env.HERMES_WORKSPACE || './workspace');
export const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
export const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
export const COMMANDS_FILE = path.join(DATA_DIR, 'commands.json');
export const CRON_JOBS_FILE = path.join(DATA_DIR, 'cronJobs.json');
export const SKILL_TOGGLES_FILE = path.join(DATA_DIR, 'skillToggles.json');

function sanitizeJsonText(text = '') {
  return String(text).replace(/^\uFEFF/, '').replace(/\u0000/g, '');
}

export function ensureRuntimeDirs() {
  for (const dir of [DATA_DIR, WORKSPACE_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

export function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(sanitizeJsonText(fs.readFileSync(file, 'utf-8')));
  } catch (error) {
    console.error(`读取 JSON 失败: ${file}`, error);
    return fallback;
  }
}

export function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
}

// 防止用户通过 ../ 或绝对路径逃离工作目录。
export function safeResolveWorkspace(relativePath = '.') {
  const cleaned = String(relativePath || '.').replace(/^[/\\]+/, '');
  const resolved = path.resolve(WORKSPACE_DIR, cleaned);
  if (resolved !== WORKSPACE_DIR && !resolved.startsWith(WORKSPACE_DIR + path.sep)) {
    const err = new Error('出于安全考虑，禁止访问工作目录之外的路径。');
    err.status = 403;
    throw err;
  }
  return resolved;
}

export function toWorkspaceRelative(absPath) {
  return path.relative(WORKSPACE_DIR, absPath).replaceAll(path.sep, '/');
}

export function newId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
