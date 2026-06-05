import path from 'node:path';
import { DATA_DIR, WORKSPACE_DIR, newId, readJson, safeResolveWorkspace, writeJson } from './storage.js';
import { runHermesAgentLoop } from './hermesAgentLoop.js';
import { usageFromMessages } from './ai.js';

const AGENTS_FILE = path.join(DATA_DIR, 'subagents.json');
const MAX_TASKS = 100;
const MAX_LOGS = 120;
const runners = new Map();
const RUNNING_TIMEOUT_MS = Number(process.env.HERMES_SUBAGENT_STALE_TIMEOUT_MS || 3 * 60 * 1000);

export const SUBAGENT_TEMPLATES = [
  {
    id: 'review',
    title: '代码审查子代理',
    prompt: '请作为代码审查子代理，检查当前项目中与本次任务相关的代码，输出：发现的问题、风险等级、建议修复方案、是否可交付。'
  },
  {
    id: 'qa',
    title: '功能验收子代理',
    prompt: '请作为功能验收子代理，对指定功能做端到端验收。输出：测试范围、通过项、失败项、修复建议、最终结论。'
  },
  {
    id: 'research',
    title: '调研分析子代理',
    prompt: '请作为调研分析子代理，围绕主题收集信息、比较方案，并给出可执行建议。'
  },
  {
    id: 'writer',
    title: '文档写作子代理',
    prompt: '请作为文档写作子代理，把给定内容整理成结构清晰、可交付的中文文档。'
  }
];

function nowIso() {
  return new Date().toISOString();
}

function readTasks() {
  const tasks = readJson(AGENTS_FILE, []);
  return Array.isArray(tasks) ? tasks : [];
}

function writeTasks(tasks = []) {
  writeJson(AGENTS_FILE, tasks.slice(0, MAX_TASKS));
}

function normalizeTask(task = {}) {
  return {
    priority: 'normal',
    tags: [],
    progress: 0,
    log: [],
    ...task
  };
}

function appendLog(task, text) {
  const log = Array.isArray(task.log) ? task.log : [];
  return [...log, { time: nowIso(), text }].slice(-MAX_LOGS);
}

function patchTask(id, patchOrFn) {
  const tasks = readTasks();
  const index = tasks.findIndex((task) => task.id === id);
  if (index < 0) return null;
  const current = normalizeTask(tasks[index]);
  const patch = typeof patchOrFn === 'function' ? patchOrFn(current) : patchOrFn;
  tasks[index] = { ...current, ...patch, updatedAt: nowIso() };
  writeTasks(tasks);
  return tasks[index];
}

function durationMs(task = {}) {
  const start = Date.parse(task.startedAt || task.createdAt || '');
  const end = Date.parse(task.finishedAt || nowIso());
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

function publicTask(raw = {}) {
  const task = normalizeTask(raw);
  const output = String(task.output || '');
  const error = String(task.error || '');
  return {
    ...task,
    durationMs: durationMs(task),
    cancellable: ['queued', 'running'].includes(task.status),
    retryable: ['completed', 'failed', 'cancelled', 'timeout'].includes(task.status),
    outputPreview: output.length > 2400 ? `${output.slice(0, 2400)}\n...` : output,
    errorPreview: error.length > 1600 ? `${error.slice(0, 1600)}\n...` : error
  };
}

function normalizeCwd(value) {
  if (!value) return WORKSPACE_DIR;
  const raw = String(value || '').trim();
  if (!raw || raw === '.' || raw === './') return WORKSPACE_DIR;
  try {
    return safeResolveWorkspace(raw);
  } catch {
    return WORKSPACE_DIR;
  }
}

async function executeSubagentTask(task) {
  const startedAt = nowIso();
  patchTask(task.id, (current) => ({
    status: 'running',
    progress: 12,
    startedAt,
    finishedAt: '',
    output: '',
    error: '',
    log: appendLog(current, '子代理任务已启动，正在调用 Hermes Agent Loop。')
  }));

  const session = {
    id: `subagent-session-${task.id}`,
    title: task.title,
    model: task.model,
    messages: [{ role: 'user', content: task.prompt, createdAt: task.createdAt }]
  };

  const controller = { cancelled: false };
  runners.set(task.id, controller);

  try {
    const result = await runHermesAgentLoop({
      session,
      message: task.prompt,
      model: task.model,
      skillPrompt: task.skillPrompt || '',
      enabledSkills: task.enabledSkills || [],
      fileContext: task.fileContext || '',
      attachedFiles: task.attachedFiles || [],
      cwd: task.cwd || WORKSPACE_DIR
    });

    const latest = readTasks().find((t) => t.id === task.id);
    if (latest?.status === 'cancelled' || controller.cancelled) {
      patchTask(task.id, (current) => ({
        progress: 100,
        finishedAt: current.finishedAt || nowIso(),
        log: appendLog(current, '底层 Hermes 调用返回；任务此前已标记取消，结果已忽略。')
      }));
      return;
    }

    const finishedAt = nowIso();
    patchTask(task.id, (current) => ({
      status: result.ok ? 'completed' : 'failed',
      progress: 100,
      finishedAt,
      command: result.command,
      output: result.output || '',
      error: result.error || '',
      code: result.code ?? null,
      tokenUsage: usageFromMessages([
        { role: 'user', content: task.prompt },
        { role: 'assistant', content: result.output || result.error || '' }
      ]),
      log: appendLog(current, result.ok ? '子代理任务已完成。' : '子代理任务失败。')
    }));
  } catch (error) {
    patchTask(task.id, (current) => ({
      status: 'failed',
      progress: 100,
      finishedAt: nowIso(),
      error: error?.message || String(error),
      log: appendLog(current, `子代理任务异常：${error?.message || String(error)}`)
    }));
  } finally {
    runners.delete(task.id);
  }
}

export function listSubagentTasks() {
  refreshStaleTasks();
  return readTasks()
    .map(normalizeTask)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .map(publicTask);
}

export function getSubagentTask(id) {
  refreshStaleTasks();
  const task = readTasks().find((item) => item.id === id);
  return task ? publicTask(task) : null;
}

function refreshStaleTasks() {
  const currentMs = Date.now();
  const tasks = readTasks();
  let changed = false;
  const next = tasks.map((task) => {
    if (!['queued', 'running'].includes(task.status)) return task;
    if (runners.has(task.id)) return task;
    const started = Date.parse(task.startedAt || task.createdAt || '');
    if (!Number.isFinite(started) || currentMs - started < RUNNING_TIMEOUT_MS) return task;
    changed = true;
    const updated = normalizeTask(task);
    return {
      ...updated,
      status: 'timeout',
      progress: 100,
      finishedAt: nowIso(),
      error: `任务超过 ${Math.round(RUNNING_TIMEOUT_MS / 1000)} 秒仍未返回，已标记超时。`,
      log: appendLog(updated, '任务超过后台监控时限，已标记超时。')
    };
  });
  if (changed) writeTasks(next);
}

export function createSubagentTask(input = {}) {
  const prompt = String(input.prompt || input.message || '').trim();
  if (!prompt) throw new Error('请填写子代理任务内容。');
  const createdAt = nowIso();
  const tags = Array.isArray(input.tags)
    ? input.tags.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8)
    : String(input.tags || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8);
  const task = {
    id: newId('agent'),
    title: String(input.title || prompt.slice(0, 36) || '子代理任务').trim(),
    prompt,
    model: String(input.model || '').trim(),
    priority: ['low', 'normal', 'high'].includes(input.priority) ? input.priority : 'normal',
    tags,
    status: 'queued',
    progress: 0,
    cwd: normalizeCwd(input.cwd),
    source: input.source || 'web-ui',
    createdAt,
    updatedAt: createdAt,
    startedAt: '',
    finishedAt: '',
    command: '',
    output: '',
    error: '',
    code: null,
    log: [{ time: createdAt, text: '任务已创建，等待后台执行。' }]
  };
  const tasks = [task, ...readTasks()].slice(0, MAX_TASKS);
  writeTasks(tasks);
  setTimeout(() => executeSubagentTask(task), 0);
  return publicTask(task);
}

export function cancelSubagentTask(id) {
  const task = getSubagentTask(id);
  if (!task) return null;
  if (!['queued', 'running'].includes(task.status)) return task;
  const runner = runners.get(id);
  if (runner) runner.cancelled = true;
  return publicTask(patchTask(id, (current) => ({
    status: 'cancelled',
    progress: 100,
    finishedAt: nowIso(),
    log: appendLog(current, '用户请求取消。当前版本会阻止结果回写；如底层 Hermes CLI 已启动，将等待其自然返回。')
  })));
}

export function retrySubagentTask(id) {
  const existing = getSubagentTask(id);
  if (!existing) return null;
  return createSubagentTask({
    title: `${existing.title} · 重试`,
    prompt: existing.prompt,
    model: existing.model,
    cwd: existing.cwd,
    priority: existing.priority,
    tags: existing.tags,
    source: 'web-ui-retry'
  });
}

export function deleteSubagentTask(id) {
  const tasks = readTasks();
  const task = tasks.find((item) => item.id === id);
  if (!task) return { ok: false, deleted: false };
  if (['queued', 'running'].includes(task.status)) {
    cancelSubagentTask(id);
  }
  writeTasks(tasks.filter((item) => item.id !== id));
  return { ok: true, deleted: true, id };
}

export function getSubagentOverview() {
  const tasks = listSubagentTasks();
  return {
    ok: true,
    templates: SUBAGENT_TEMPLATES,
    counts: {
      queued: tasks.filter((t) => t.status === 'queued').length,
      running: tasks.filter((t) => t.status === 'running').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
      timeout: tasks.filter((t) => t.status === 'timeout').length,
      cancelled: tasks.filter((t) => t.status === 'cancelled').length,
      total: tasks.length
    },
    tasks
  };
}
