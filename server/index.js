import './env.js';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { ensureRuntimeDirs, WORKSPACE_DIR, newId } from './storage.js';
import { streamChat, usageFromMessages } from './ai.js';
import { getOfficialModels, getPublicModelConfig, getPublicModels, saveCustomModelConfig, resolveModelRuntime } from './modelConfig.js';
import { getMemory, updateMemory, addMemoryFact } from './memory.js';
import { createSession, deleteSession, getSession, importSessions, listSessions, listSessionsPage, getSessionMessages, searchSessions, saveSessions, updateSession } from './sessions.js';
import { listCommands, saveCommands } from './commands.js';
import { deletePath, handleUpload, listDir, makeDir, readFile, uploadMiddleware, writeFile, chatUploadMiddleware, extractChatFiles } from './files.js';
import { inspectCommand, getSecurityStatus } from './security.js';
import { extractHermesToolCall, runPowerShellCommand, stripHermesToolCall, EXEC_ROOT } from './terminalTool.js';
import { planPowerShellFromUserMessage } from './toolPlanner.js';
import { getHermesStatus, runHermesMcpList, runHermesMcpTest, writeDefaultHermesConfig, diagnoseHermesRuntime, repairHermesRuntime, addHermesMcpServer } from './hermesRuntime.js';

import { createSubagentTask, listSubagentTasks, getSubagentTask, cancelSubagentTask, retrySubagentTask, deleteSubagentTask, getSubagentOverview } from './subagents.js';
import { getLogs, getAnalytics, getOfficialSkillsSnapshot } from './dashboardData.js';
import { getConfig, saveConfig, getConfigRaw, saveConfigRaw, getConfigSchema, getEnvVars, setEnvVar, deleteEnvVar, revealEnvVar, listCronJobs, createCronJob, updateCronJob, deleteCronJob, triggerCronJob, cancelCronJob, startCronScheduler, getSkillsApi, getToolsetsApi, toggleSkill, getOAuthProviders, disconnectOAuthProvider } from './officialCompat.js';
import { listOfficialSessions, exportOfficialSession, getOfficialSessionDbInfo } from './officialSessions.js';
import { attachOfficialTuiBridge } from './officialTuiBridge.js';

ensureRuntimeDirs();
startCronScheduler();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(PROJECT_ROOT, 'web-dist');
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || true;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN }
});
attachOfficialTuiBridge(io);
const PORT = Number(process.env.PORT || 5174);

const HERMES_HOME = process.env.HERMES_HOME || path.join(PROJECT_ROOT, 'data');
const HERMES_LOG_DIR = path.join(HERMES_HOME, 'logs');
const HERMES_LOG_FILES = {
  agent: 'hermes.log',
  errors: 'errors.log',
  gateway: 'gateway.log',
  mcp: 'mcp-stderr.log'
};

function liveLogLevel(line = '') {
  const value = String(line).toLowerCase();
  if (/\b(error|exception|traceback|failed|fatal)\b/.test(value)) return 'error';
  if (/\b(warn|warning|deprecated)\b/.test(value)) return 'warn';
  if (/\b(debug|trace)\b/.test(value)) return 'debug';
  return 'info';
}

function liveLogComponent(line = '') {
  const value = String(line).toLowerCase();
  for (const key of ['gateway', 'agent', 'tools', 'tool', 'cli', 'cron', 'mcp', 'web', 'auth']) {
    if (value.includes(key)) return key === 'tool' ? 'tools' : key;
  }
  return 'general';
}

function clearLiveLogTimer(socket) {
  if (socket.data?.liveLogTimer) clearInterval(socket.data.liveLogTimer);
  socket.data.liveLogTimer = null;
}

function startLiveLogStream(socket, { file = 'agent', lines = 80 } = {}) {
  clearLiveLogTimer(socket);
  const safeFile = HERMES_LOG_FILES[file] ? file : 'agent';
  const fullPath = path.join(HERMES_LOG_DIR, HERMES_LOG_FILES[safeFile]);
  const history = getLogs({ file: safeFile, lines, level: 'all', component: 'all' });
  socket.emit('logs:history', history);

  let lastSize = 0;
  let pending = '';
  try {
    lastSize = fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0;
  } catch {
    lastSize = 0;
  }

  socket.data.liveLogTimer = setInterval(() => {
    try {
      if (!fs.existsSync(fullPath)) return;
      const stat = fs.statSync(fullPath);
      if (stat.size < lastSize) {
        lastSize = 0;
        pending = '';
      }
      if (stat.size === lastSize) return;

      const stream = fs.createReadStream(fullPath, { start: lastSize, end: stat.size - 1, encoding: 'utf8' });
      lastSize = stat.size;
      stream.on('data', (chunk) => {
        const text = pending + String(chunk || '').replace(/^\uFEFF/, '');
        const parts = text.split(/\r?\n/);
        pending = parts.pop() || '';
        for (const raw of parts) {
          const line = raw.trimEnd();
          if (!line) continue;
          socket.emit('logs:line', {
            id: `${safeFile}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            file: safeFile,
            text: line,
            level: liveLogLevel(line),
            component: liveLogComponent(line),
            at: new Date().toISOString()
          });
        }
      });
      stream.on('error', (error) => socket.emit('logs:error', error.message));
    } catch (error) {
      socket.emit('logs:error', error.message || String(error));
    }
  }, 1000);
}

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: '10mb' }));

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function streamAssistantOnce({ session, model, send, onUsage }) {
  let text = '';
  for await (const chunk of streamChat({
    model,
    messages: session.messages,
    onUsage
  })) {
    text += chunk;
    send('chunk', { text: chunk });
  }
  return text;
}

function toolResultPrompt({ toolCall, toolResult }) {
  const output = String(toolResult.output || '').trim();
  const error = String(toolResult.error || '').trim();
  return [
    '【Hermes 工具执行结果】',
    `工具：${toolCall.tool}`,
    `命令：${toolCall.command}`,
    toolCall.reason ? `原因：${toolCall.reason}` : '',
    `执行状态：${toolResult.ok ? '成功' : toolResult.needsConfirmation ? '需要用户确认' : '失败'}`,
    `工作目录：${toolResult.cwd || EXEC_ROOT}`,
    output ? `stdout:\n${output.slice(0, 12000)}` : '',
    error ? `stderr/error:\n${error.slice(0, 8000)}` : '',
    '请基于以上工具结果给用户最终回答。不要再次输出 hermes-tool，除非确实还需要额外只读查询。'
  ].filter(Boolean).join('\n\n');
}

function maskKey(key = '') {
  const value = String(key || '');
  if (!value) return '未配置';
  if (value.length <= 10) return '***';
  return `${value.slice(0, 6)}***${value.slice(-4)}`;
}

function isModelIdentityQuestion(text = '') {
  const value = String(text || '').toLowerCase();
  return /什么模型|哪个模型|模型名|模型编号|当前模型|用的模型|你是什么模型|model/.test(value);
}

function contextStatsText(session = {}) {
  const messages = session.messages || [];
  const chars = messages.reduce((sum, m) => sum + String(m.content || '').length, 0);
  const approxTokens = Math.ceil(chars / 3);
  return [
    `当前会话消息数：${messages.length}`,
    `当前会话近似上下文：约 ${approxTokens} tokens（约 ${(approxTokens / 1000).toFixed(1)}K tokens，本地按 1 token≈3 字符粗估）`
  ].join('\n');
}

function runtimeInfoText(modelId, session) {
  const runtime = resolveModelRuntime(modelId);
  return [
    '【Hermes 运行时信息】',
    `当前实际调用模型显示名：${runtime.label || runtime.id || '未命名模型'}`,
    `当前实际调用模型 ID：${runtime.id || modelId || '未知'}`,
    `当前实际调用 API model：${runtime.apiModel || '未知'}`,
    `当前 Provider：${runtime.provider || 'openai'}`,
    runtime.baseUrl ? `当前 Base URL：${runtime.baseUrl}` : '',
    `当前 API Key：${maskKey(runtime.apiKey)}`,
    contextStatsText(session),
    '如果用户询问模型、上下文、配置或运行状态，请基于以上信息自然回答；不要说你看不到后端配置。'
  ].filter(Boolean).join('\n');
}

function modelIdentityText(modelId) {
  const runtime = resolveModelRuntime(modelId);
  return [
    '当前 Hermes 网页端实际接入的模型配置如下：',
    '',
    `- 显示名称：${runtime.label || runtime.id || '未命名模型'}`,
    `- 模型 ID：${runtime.id || modelId || '未知'}`,
    `- API model：${runtime.apiModel || '未知'}`,
    `- Provider：${runtime.provider || 'openai'}`,
    runtime.baseUrl ? `- Base URL：${runtime.baseUrl}` : '',
    `- API Key：${maskKey(runtime.apiKey)}`,
    '',
    '当前未配置模型。请在右侧“模型配置”填写并测试新的 Provider、Base URL、API Key 和 Model 后再发起对话。'
  ].filter(Boolean).join('\n');
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, workspace: WORKSPACE_DIR, models: getPublicModels() });
});

app.get('/api/hermes/status', asyncHandler(async (req, res) => res.json(await getHermesStatus())));
app.get('/api/hermes/diagnose', asyncHandler(async (req, res) => res.json(await diagnoseHermesRuntime())));
app.post('/api/hermes/repair', asyncHandler(async (req, res) => res.json(await repairHermesRuntime(req.body || {}))));
app.post('/api/hermes/config/default', asyncHandler(async (req, res) => res.json(writeDefaultHermesConfig({ overwrite: Boolean(req.body?.overwrite) }))));
app.get('/api/hermes/mcp/list', asyncHandler(async (req, res) => res.json(await runHermesMcpList())));
app.post('/api/hermes/mcp/test/:name', asyncHandler(async (req, res) => res.json(await runHermesMcpTest(req.params.name))));
app.post('/api/hermes/mcp/server', asyncHandler(async (req, res) => res.json(addHermesMcpServer(req.body || {}))));

app.get('/api/models', (req, res) => res.json(getPublicModels()));
app.get('/api/model-config', (req, res) => res.json(getPublicModelConfig()));
app.get('/api/model-config/official-models', (req, res) => res.json(getOfficialModels(req.query.provider || 'openrouter', { refresh: req.query.refresh === '1' })));
app.put('/api/model-config', (req, res) => res.json(saveCustomModelConfig(req.body || {})));
app.post('/api/model-config/test', asyncHandler(async (req, res) => {
  const saved = saveCustomModelConfig(req.body || {});
  const runtime = resolveModelRuntime(saved.current.id);
  if (!runtime.apiKey) return res.status(400).json({ ok: false, error: 'API Key 为空。' });

  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: runtime.apiKey, baseURL: runtime.baseUrl || undefined });
  try {
    const result = await client.chat.completions.create({
      model: runtime.apiModel,
      messages: [{ role: 'user', content: '请只回复：模型连接成功' }],
      max_tokens: 20,
      stream: false
    });
    res.json({
      ok: true,
      message: '模型连接成功',
      model: saved.current,
      sample: result.choices?.[0]?.message?.content || ''
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error?.message || '模型连接失败。' });
  }
}));

app.get('/api/security/status', (req, res) => res.json(getSecurityStatus()));
app.post('/api/security/inspect-command', (req, res) => res.json(inspectCommand(req.body?.command || '')));

app.get('/api/subagents', (req, res) => res.json(getSubagentOverview()));
app.get('/api/subagents/:id', (req, res) => {
  const task = getSubagentTask(req.params.id);
  if (!task) return res.status(404).json({ error: '子代理任务不存在。' });
  res.json(task);
});
app.post('/api/subagents', (req, res) => res.json(createSubagentTask(req.body || {})));
app.post('/api/subagents/:id/cancel', (req, res) => {
  const task = cancelSubagentTask(req.params.id);
  if (!task) return res.status(404).json({ error: '子代理任务不存在。' });
  res.json(task);
});
app.post('/api/subagents/:id/retry', (req, res) => {
  const task = retrySubagentTask(req.params.id);
  if (!task) return res.status(404).json({ error: '子代理任务不存在。' });
  res.json(task);
});
app.delete('/api/subagents/:id', (req, res) => res.json(deleteSubagentTask(req.params.id)));

app.get('/api/sessions', asyncHandler(async (req, res) => {
  if (req.query.source === 'official') {
    const official = await listOfficialSessions({ limit: req.query.limit || 50, source: req.query.hermesSource || '', q: req.query.q || '', offset: req.query.offset || 0 });
    return res.json({ sessions: official.sessions, total: official.total ?? official.sessions.length, limit: Number(req.query.limit || 50), offset: Number(req.query.offset || 0), source: official.source || 'official', ok: official.ok, error: official.error, sqliteError: official.sqliteError, db: getOfficialSessionDbInfo(), raw: official.output });
  }
  if (req.query.source === 'mixed') {
    const local = listSessionsPage({ limit: req.query.limit, offset: req.query.offset, q: req.query.q });
    const official = await listOfficialSessions({ limit: req.query.officialLimit || 30, q: req.query.q || '' }).catch((error) => ({ ok: false, sessions: [], error: error.message }));
    return res.json({ ...local, sessions: [...(official.sessions || []), ...(local.sessions || [])], total: (official.total ?? official.sessions?.length ?? 0) + (local.total || 0), source: 'mixed', officialOk: official.ok, officialError: official.error || official.sqliteError, officialSource: official.source, db: getOfficialSessionDbInfo() });
  }
  if (req.query.rich === '1' || req.query.limit || req.query.offset || req.query.q) {
    return res.json(listSessionsPage({ limit: req.query.limit, offset: req.query.offset, q: req.query.q }));
  }
  res.json(listSessions());
}));
app.get('/api/sessions/search', (req, res) => res.json({ results: searchSessions(req.query.q || '', req.query.limit || 20) }));
app.get('/api/sessions/:id/messages', asyncHandler(async (req, res) => {
  if (req.query.source === 'official' || String(req.params.id).startsWith('official')) {
    const payload = await exportOfficialSession(req.params.id);
    if (!payload.ok && !payload.messages.length) return res.status(404).json({ error: payload.error || '官方会话不存在。', output: payload.output });
    return res.json({ id: req.params.id, messages: payload.messages, source: 'official', raw: payload.output });
  }
  const payload = getSessionMessages(req.params.id);
  if (!payload) return res.status(404).json({ error: '会话不存在。' });
  res.json(payload);
}));
app.post('/api/sessions', (req, res) => res.json(createSession(req.body?.title)));
app.put('/api/sessions/:id', (req, res) => {
  const session = updateSession(req.params.id, req.body || {});
  if (!session) return res.status(404).json({ error: '会话不存在。' });
  res.json(session);
});
app.delete('/api/sessions/:id', (req, res) => res.json(deleteSession(req.params.id)));
app.post('/api/sessions/import', (req, res) => res.json(importSessions(req.body)));

app.get('/api/logs', (req, res) => res.json(getLogs(req.query || {})));
app.get('/api/analytics/usage', asyncHandler(async (req, res) => res.json(await getAnalytics({ days: req.query.days }))));
app.get('/api/official-skills', asyncHandler(async (req, res) => res.json(await getOfficialSkillsSnapshot())));

app.get('/api/config', (req, res) => res.json(getConfig()));
app.put('/api/config', (req, res) => res.json(saveConfig(req.body?.config || req.body || {})));
app.get('/api/config/schema', (req, res) => res.json(getConfigSchema()));
app.get('/api/config/raw', (req, res) => res.json(getConfigRaw()));
app.put('/api/config/raw', (req, res) => res.json(saveConfigRaw(req.body?.yaml || req.body?.yaml_text || '')));

app.get('/api/env', (req, res) => res.json(getEnvVars()));
app.put('/api/env', (req, res) => res.json(setEnvVar(req.body?.key, req.body?.value)));
app.delete('/api/env', (req, res) => res.json(deleteEnvVar(req.body?.key || req.query.key)));
app.post('/api/env/reveal', (req, res) => res.json(revealEnvVar(req.body?.key)));
app.get('/api/providers/oauth', (req, res) => res.json(getOAuthProviders()));
app.delete('/api/providers/oauth/:providerId', (req, res) => res.json(disconnectOAuthProvider(req.params.providerId)));
app.post('/api/providers/oauth/:providerId/start', (req, res) => res.json({ ok: true, provider: req.params.providerId, flow: 'api-key', message: '当前兼容层使用 API Key 登录：请在密钥管理页保存对应 API Key。' }));

app.get('/api/cron/jobs', (req, res) => res.json(listCronJobs()));
app.post('/api/cron/jobs', (req, res) => res.json(createCronJob(req.body || {})));
app.put('/api/cron/jobs/:id', (req, res) => {
  const job = updateCronJob(req.params.id, req.body || {});
  if (!job) return res.status(404).json({ error: 'Cron 任务不存在。' });
  res.json(job);
});
app.post('/api/cron/jobs/:id/pause', (req, res) => {
  const job = updateCronJob(req.params.id, { enabled: false, status: 'paused' });
  if (!job) return res.status(404).json({ error: 'Cron 任务不存在。' });
  res.json({ ok: true, job });
});
app.post('/api/cron/jobs/:id/resume', (req, res) => {
  const job = updateCronJob(req.params.id, { enabled: true, status: 'scheduled' });
  if (!job) return res.status(404).json({ error: 'Cron 任务不存在。' });
  res.json({ ok: true, job });
});
app.post('/api/cron/jobs/:id/trigger', (req, res) => {
  const result = triggerCronJob(req.params.id);
  if (!result) return res.status(404).json({ error: 'Cron 任务不存在。' });
  res.json(result);
});
app.post('/api/cron/jobs/:id/cancel', (req, res) => {
  const result = cancelCronJob(req.params.id);
  if (!result) return res.status(404).json({ error: 'Cron 任务不存在。' });
  res.json(result);
});
app.delete('/api/cron/jobs/:id', (req, res) => res.json(deleteCronJob(req.params.id)));

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('hello', { ok: true, at: new Date().toISOString(), source: 'hermes-web-compat-events' });
  const timer = setInterval(() => send('status', { at: new Date().toISOString(), cron: listCronJobs().map((j) => ({ id: j.id, status: j.status, runCount: j.runCount, updatedAt: j.updatedAt })) }), 5000);
  req.on('close', () => clearInterval(timer));
});

app.get('/api/skills', asyncHandler(async (req, res) => res.json(await getSkillsApi())));
app.put('/api/skills/toggle', asyncHandler(async (req, res) => res.json(await toggleSkill(req.body?.name, req.body?.enabled))));
app.get('/api/tools/toolsets', asyncHandler(async (req, res) => res.json(await getToolsetsApi())));

app.get('/api/memory', (req, res) => res.json(getMemory()));
app.put('/api/memory', (req, res) => res.json(updateMemory(req.body || {})));
app.post('/api/memory/facts', (req, res) => res.json(addMemoryFact(req.body?.text || '')));

app.get('/api/commands', (req, res) => res.json(listCommands()));
app.put('/api/commands', (req, res) => res.json(saveCommands(Array.isArray(req.body) ? req.body : [])));

app.get('/api/files', asyncHandler((req, res) => res.json(listDir(req.query.path || '.'))));
app.get('/api/files/read', asyncHandler((req, res) => res.json(readFile(req.query.path))));
app.post('/api/files/write', asyncHandler((req, res) => res.json(writeFile(req.body.path, req.body.content || ''))));
app.post('/api/files/mkdir', asyncHandler((req, res) => res.json(makeDir(req.body.path))));
app.delete('/api/files', asyncHandler((req, res) => res.json(deletePath(req.query.path))));
app.post('/api/files/upload', uploadMiddleware, asyncHandler((req, res) => res.json(handleUpload(req.file, req.body.path || '.'))));

app.post('/api/upload', chatUploadMiddleware, asyncHandler(async (req, res) => {
  const { files, context } = extractChatFiles(req.files || []);
  res.json({ ok: true, message: req.body?.message || '', files, context });
}));

app.post('/api/chat', asyncHandler(async (req, res) => {
  const { sessionId, message, model, skillPrompt, enabledSkills, fileContext, attachedFiles } = req.body;
  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: '会话不存在。' });

  const contentWithSkills = [
    skillPrompt ? `【已启用技能】\n${String(skillPrompt)}` : '',
    Array.isArray(enabledSkills) && enabledSkills.length ? `【技能列表】${enabledSkills.map((s) => s.title || s.id).join('、')}` : '',
    fileContext ? `【用户上传文件内容】\n${String(fileContext)}` : '',
    Array.isArray(attachedFiles) && attachedFiles.length ? `【附件列表】${attachedFiles.map((f) => `${f.name || 'file'} (${f.size || 0} bytes)`).join('、')}` : '',
    String(message || '')
  ].filter(Boolean).join('\n\n');

  const userMessage = {
    id: newId('msg'),
    role: 'user',
    content: contentWithSkills,
    createdAt: new Date().toISOString()
  };
  session.messages.push(userMessage);
  // Chat send should use the session's explicitly selected model. Do not let a
  // transient client fallback overwrite it; model changes are persisted through
  // the session update endpoint when the user saves/tests/selects a model.
  if (!session.model && model) session.model = model;
  session.updatedAt = new Date().toISOString();
  updateSession(session.id, session);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let assistantText = '';
  let usage = { prompt: 0, completion: 0, total: 0 };
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    send('start', { ok: true, runtime: 'openai-compatible-streaming-tools' });

    let latest = getSession(session.id) || session;
    let turns = 0;
    const maxToolTurns = 2;

    const plannedTool = planPowerShellFromUserMessage(message);
    if (plannedTool) {
      const plannedCall = { tool: 'powershell', command: plannedTool.command, reason: plannedTool.reason || '根据用户请求自动规划 PowerShell 查询' };
      send('tool', { tool: plannedCall.tool, command: plannedCall.command, reason: plannedCall.reason, cwd: EXEC_ROOT, planned: true });
      const toolResult = await runPowerShellCommand(plannedCall.command, { cwd: EXEC_ROOT, timeoutMs: 20000 });
      send('tool-result', {
        ok: toolResult.ok,
        code: toolResult.code ?? null,
        command: plannedCall.command,
        cwd: toolResult.cwd,
        needsConfirmation: Boolean(toolResult.needsConfirmation),
        blocked: Boolean(toolResult.blocked),
        output: toolResult.output || '',
        error: toolResult.error || '',
        planned: true
      });
      latest.messages.push({
        id: newId('msg'),
        role: 'user',
        content: toolResultPrompt({ toolCall: plannedCall, toolResult }),
        createdAt: new Date().toISOString(),
        internal: true
      });
      latest.updatedAt = new Date().toISOString();
      updateSession(latest.id, latest);
    }

    while (turns <= maxToolTurns) {
      const currentText = await streamAssistantOnce({
        session: latest,
        model: latest.model,
        send,
        onUsage: (nextUsage) => { usage = nextUsage || usage; }
      });
      assistantText += currentText;

      if (!currentText.trim()) {
        throw new Error('模型接口没有返回任何内容。请检查右侧“模型配置”的 Base URL、API Key 和模型名，或更换支持标准 OpenAI-compatible streaming 的接口。');
      }

      const toolCall = extractHermesToolCall(currentText);
      if (!toolCall || turns >= maxToolTurns) break;

      send('assistant-replace', { text: stripHermesToolCall(currentText).trim() });
      send('tool', { tool: toolCall.tool, command: toolCall.command, reason: toolCall.reason, cwd: EXEC_ROOT });
      const toolResult = await runPowerShellCommand(toolCall.command, { cwd: EXEC_ROOT, timeoutMs: 20000 });
      send('tool-result', {
        ok: toolResult.ok,
        code: toolResult.code ?? null,
        command: toolCall.command,
        cwd: toolResult.cwd,
        needsConfirmation: Boolean(toolResult.needsConfirmation),
        blocked: Boolean(toolResult.blocked),
        output: toolResult.output || '',
        error: toolResult.error || ''
      });

      latest.messages.push({
        id: newId('msg'),
        role: 'user',
        content: toolResultPrompt({ toolCall, toolResult }),
        createdAt: new Date().toISOString(),
        internal: true
      });
      latest.updatedAt = new Date().toISOString();
      updateSession(latest.id, latest);
      turns += 1;
    }

    latest = getSession(session.id) || latest;
    latest.messages.push({
      id: newId('msg'),
      role: 'assistant',
      content: stripHermesToolCall(assistantText) || assistantText,
      usage,
      runtime: 'openai-compatible-streaming-tools',
      createdAt: new Date().toISOString()
    });
    latest.tokenUsage = usageFromMessages(latest.messages);
    latest.updatedAt = new Date().toISOString();
    updateSession(latest.id, latest);
    send('done', { message: latest.messages.at(-1), tokenUsage: latest.tokenUsage, runtime: 'openai-compatible-streaming-tools' });
  } catch (error) {
    const text = `⚠️ 系统通知：${error.message || 'AI 请求失败，请检查网络或 API Key。'}`;
    const latest = getSession(session.id) || session;
    latest.messages.push({ id: newId('msg'), role: 'system-note', content: text, createdAt: new Date().toISOString() });
    latest.updatedAt = new Date().toISOString();
    updateSession(latest.id, latest);
    send('error', { error: text });
  } finally {
    res.end();
  }
}));

io.on('connection', (socket) => {
  socket.on('logs:subscribe', (options = {}) => startLiveLogStream(socket, options));
  socket.on('logs:unsubscribe', () => clearLiveLogTimer(socket));
  socket.on('disconnect', () => clearLiveLogTimer(socket));

  socket.on('terminal:inspect', ({ command }) => {
    socket.emit('terminal:inspection', inspectCommand(command));
  });

  socket.on('terminal:run', ({ command, confirmedHighRisk }) => {
    const inspection = inspectCommand(command);
    if (inspection.isBlocked) {
      socket.emit('terminal:error', inspection.message);
      return;
    }
    if (inspection.isHighRisk && !confirmedHighRisk) {
      socket.emit('terminal:needs-confirmation', inspection);
      return;
    }

    socket.emit('terminal:start', { command, cwd: EXEC_ROOT, inspection });
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      cwd: EXEC_ROOT,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '1' }
    });

    child.stdout.on('data', (data) => socket.emit('terminal:output', data.toString()));
    child.stderr.on('data', (data) => socket.emit('terminal:output', data.toString()));
    child.on('error', (err) => socket.emit('terminal:error', err.message));
    child.on('close', (code) => socket.emit('terminal:exit', { code }));

    socket.on('terminal:stop', () => child.kill('SIGTERM'));
  });
});

app.use(express.static(DIST_DIR));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || '服务器内部错误。' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Hermes Agent Web listening on http://127.0.0.1:${PORT}`);
  console.log(`Serving UI from: ${DIST_DIR}`);
  console.log(`Workspace: ${WORKSPACE_DIR}`);
});
