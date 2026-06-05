import { SESSIONS_FILE, readJson, writeJson, newId } from './storage.js';
import { DEFAULT_MODEL } from './ai.js';

function defaultSession() {
  const now = new Date().toISOString();
  return {
    id: newId('sess'),
    title: '新的 Hermes 会话',
    model: DEFAULT_MODEL,
    messages: [
      {
        id: newId('msg'),
        role: 'system-note',
        content: '欢迎使用爱马仕AI。所有错误会在这里显示，不会弹窗阻塞。',
        createdAt: now
      }
    ],
    tokenUsage: { prompt: 0, completion: 0, total: 0 },
    createdAt: now,
    updatedAt: now
  };
}

export function listSessions() {
  let sessions = readJson(SESSIONS_FILE, null);
  if (!sessions || !Array.isArray(sessions) || sessions.length === 0) {
    sessions = [defaultSession()];
    writeJson(SESSIONS_FILE, sessions);
  }
  return sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export function listSessionsPage({ limit = 20, offset = 0, q = '' } = {}) {
  const query = String(q || '').trim().toLowerCase();
  const all = listSessions();
  const filtered = query
    ? all.filter((session) => {
        const haystack = [
          session.title,
          session.model,
          ...(session.messages || []).map((m) => `${m.role || ''} ${m.content || ''}`)
        ].join('\n').toLowerCase();
        return haystack.includes(query);
      })
    : all;
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
  const safeOffset = Math.max(0, Number(offset) || 0);
  return {
    total: filtered.length,
    limit: safeLimit,
    offset: safeOffset,
    query,
    sessions: filtered.slice(safeOffset, safeOffset + safeLimit)
  };
}

export function searchSessions(q = '', limit = 20) {
  return listSessionsPage({ q, limit, offset: 0 }).sessions.map((session) => {
    const query = String(q || '').trim().toLowerCase();
    const hit = (session.messages || []).find((m) => String(m.content || '').toLowerCase().includes(query));
    return {
      id: session.id,
      title: session.title,
      model: session.model,
      updatedAt: session.updatedAt,
      messageCount: session.messages?.length || 0,
      snippet: hit ? String(hit.content || '').slice(0, 220) : String(session.title || '').slice(0, 220)
    };
  }).slice(0, Math.max(1, Math.min(Number(limit) || 20, 100)));
}

export function getSessionMessages(id) {
  const session = getSession(id);
  if (!session) return null;
  return { sessionId: id, messages: session.messages || [] };
}

export function sessionSummary(session = {}) {
  const messages = session.messages || [];
  const last = messages[messages.length - 1];
  return {
    id: session.id,
    title: session.title,
    model: session.model,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: messages.length,
    tokenUsage: session.tokenUsage || { prompt: 0, completion: 0, total: 0 },
    preview: last?.content ? String(last.content).slice(0, 160) : '',
    source: 'local-web'
  };
}

export function saveSessions(sessions) {
  writeJson(SESSIONS_FILE, sessions);
  return sessions;
}

export function getSession(id) {
  return listSessions().find((s) => s.id === id);
}

export function createSession(title = '新的 Hermes 会话') {
  const sessions = listSessions();
  const session = { ...defaultSession(), title };
  sessions.unshift(session);
  saveSessions(sessions);
  return session;
}

export function updateSession(id, patch) {
  const sessions = listSessions();
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  sessions[idx] = { ...sessions[idx], ...patch, updatedAt: new Date().toISOString() };
  saveSessions(sessions);
  return sessions[idx];
}

export function deleteSession(id) {
  let sessions = listSessions().filter((s) => s.id !== id);
  if (sessions.length === 0) sessions = [defaultSession()];
  saveSessions(sessions);
  return sessions;
}

export function importSessions(imported) {
  const sessions = Array.isArray(imported) ? imported : imported.sessions;
  if (!Array.isArray(sessions)) {
    const error = new Error('导入失败：备份文件中没有 sessions 数组。');
    error.status = 400;
    throw error;
  }
  const normalized = sessions.map((s) => ({
    id: s.id || newId('sess'),
    title: s.title || '导入会话',
    model: s.model || DEFAULT_MODEL,
    messages: Array.isArray(s.messages) ? s.messages : [],
    tokenUsage: s.tokenUsage || { prompt: 0, completion: 0, total: 0 },
    createdAt: s.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
  const merged = [...normalized, ...listSessions()];
  saveSessions(merged);
  return merged;
}

export function addMessage(sessionId, message) {
  const session = getSession(sessionId);
  if (!session) return null;
  session.messages.push({ id: newId('msg'), createdAt: new Date().toISOString(), ...message });
  session.updatedAt = new Date().toISOString();
  updateSession(sessionId, session);
  return session;
}
