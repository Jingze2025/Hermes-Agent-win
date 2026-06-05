import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import Database from 'better-sqlite3';

const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
const STATE_DB = path.join(HERMES_HOME, 'state.db');

function hermesCommand() {
  return process.platform === 'win32' ? 'hermes.exe' : 'hermes';
}

function runHermes(args = [], timeout = 30000) {
  return new Promise((resolve) => {
    execFile(hermesCommand(), args, { timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (error, stdout, stderr) => {
      resolve({ ok: !error, code: error?.code ?? 0, output: `${stdout || ''}${stderr ? `\n${stderr}` : ''}`.trim(), error: error?.message || '' });
    });
  });
}

function ts(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return new Date(n > 10_000_000_000 ? n : n * 1000).toISOString();
}

function previewText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').slice(0, 260);
}

function parseMaybeJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function normalizeContent(row) {
  const parsed = parseMaybeJson(row.content);
  if (typeof parsed === 'string') return parsed;
  if (Array.isArray(parsed)) return parsed.map((item) => typeof item === 'string' ? item : item?.text || item?.content || JSON.stringify(item)).join('\n');
  if (parsed && typeof parsed === 'object') return parsed.text || parsed.content || JSON.stringify(parsed, null, 2);
  return row.content || row.reasoning_content || row.reasoning || row.tool_calls || '';
}

function openDb() {
  if (!fs.existsSync(STATE_DB)) return null;
  return new Database(STATE_DB, { readonly: true, fileMustExist: true });
}

export function getOfficialSessionDbInfo() {
  return { path: STATE_DB, exists: fs.existsSync(STATE_DB) };
}

export async function listOfficialSessions({ limit = 50, source = '', q = '', offset = 0 } = {}) {
  try {
    const db = openDb();
    if (!db) return { ok: false, source: 'sqlite', path: STATE_DB, error: 'state.db not found', sessions: [] };
    const safeLimit = Math.min(500, Math.max(1, Number(limit || 50)));
    const safeOffset = Math.max(0, Number(offset || 0));
    const where = [];
    const params = {};
    if (source) { where.push('s.source = @source'); params.source = String(source); }
    if (q) { where.push('(s.title LIKE @q OR s.model LIKE @q OR EXISTS (SELECT 1 FROM messages m WHERE m.session_id = s.id AND m.content LIKE @q))'); params.q = `%${String(q)}%`; }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM sessions s ${whereSql}`).get(params)?.n || 0;
    const rows = db.prepare(`
      SELECT s.*, (
        SELECT content FROM messages m WHERE m.session_id = s.id AND COALESCE(m.content, '') <> '' ORDER BY m.timestamp DESC LIMIT 1
      ) AS last_content
      FROM sessions s
      ${whereSql}
      ORDER BY COALESCE(s.ended_at, s.started_at) DESC
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit: safeLimit, offset: safeOffset });
    db.close();
    return {
      ok: true,
      source: 'sqlite',
      path: STATE_DB,
      total,
      sessions: rows.map((row) => ({
        id: row.id,
        title: row.title || row.id,
        preview: previewText(row.last_content || row.system_prompt || row.end_reason || row.id),
        source: 'official-hermes',
        hermesSource: row.source,
        model: row.model || row.billing_provider || 'official',
        messageCount: row.message_count || 0,
        toolCallCount: row.tool_call_count || 0,
        apiCallCount: row.api_call_count || 0,
        tokenUsage: {
          prompt: row.input_tokens || 0,
          completion: row.output_tokens || 0,
          total: (row.input_tokens || 0) + (row.output_tokens || 0),
          reasoning: row.reasoning_tokens || 0,
          cacheRead: row.cache_read_tokens || 0,
          cacheWrite: row.cache_write_tokens || 0
        },
        cost: row.actual_cost_usd ?? row.estimated_cost_usd ?? null,
        costStatus: row.cost_status || '',
        startedAt: ts(row.started_at),
        updatedAt: ts(row.ended_at || row.started_at),
        endedAt: ts(row.ended_at),
        endReason: row.end_reason || '',
        official: true
      }))
    };
  } catch (error) {
    const fallback = await listOfficialSessionsCli({ limit, source });
    return { ...fallback, sqliteError: error.message, source: 'cli-fallback' };
  }
}

function parseListOutput(output = '') {
  const lines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    if (/^(id|session|title)\b/i.test(line) || /^[-=]{3,}/.test(line) || /View and manage/i.test(line)) continue;
    const id = line.match(/([0-9a-f]{8,}|sess[_-][\w-]+|[\w-]{16,})/i)?.[1] || '';
    const date = line.match(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?/)?.[0] || '';
    const title = line.replace(id, '').replace(date, '').replace(/[│|]+/g, ' ').replace(/\s{2,}/g, ' ').trim() || line;
    rows.push({ id: id || `official-${rows.length}`, title: title || id || 'Hermes session', preview: line, source: 'official-hermes', model: 'official', messageCount: null, tokenUsage: { total: 0 }, updatedAt: date ? new Date(date).toISOString() : null, raw: line, official: true });
  }
  return rows;
}

async function listOfficialSessionsCli({ limit = 50, source = '' } = {}) {
  const args = ['sessions', 'list', '--limit', String(limit)];
  if (source) args.push('--source', source);
  const result = await runHermes(args);
  return { ...result, source: 'cli', sessions: result.ok ? parseListOutput(result.output) : [], total: result.ok ? parseListOutput(result.output).length : 0 };
}

export async function exportOfficialSession(id) {
  if (!id) return { ok: false, error: 'session id required', messages: [] };
  try {
    const db = openDb();
    if (!db) return { ok: false, error: 'state.db not found', messages: [] };
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(String(id));
    if (!session) { db.close(); return { ok: false, error: 'official session not found', messages: [] }; }
    const rows = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC, id ASC').all(String(id));
    db.close();
    return {
      ok: true,
      source: 'sqlite',
      session: { id: session.id, title: session.title, source: session.source, model: session.model, startedAt: ts(session.started_at), endedAt: ts(session.ended_at) },
      messages: rows.map((row) => ({
        id: String(row.id),
        role: row.role || 'message',
        content: normalizeContent(row),
        toolCallId: row.tool_call_id || '',
        toolCalls: row.tool_calls ? parseMaybeJson(row.tool_calls) || row.tool_calls : null,
        toolName: row.tool_name || '',
        tokenCount: row.token_count || 0,
        finishReason: row.finish_reason || '',
        reasoning: row.reasoning_content || row.reasoning || '',
        createdAt: ts(row.timestamp)
      }))
    };
  } catch (error) {
    const result = await runHermes(['sessions', 'export', String(id)], 60000);
    const messages = [];
    for (const line of String(result.output || '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        messages.push({ id: item.id || `${item.role || 'msg'}-${messages.length}`, role: item.role || item.type || 'message', content: item.content || item.text || JSON.stringify(item, null, 2), createdAt: item.created_at || item.createdAt || item.timestamp });
      } catch {
        messages.push({ id: `raw-${messages.length}`, role: 'raw', content: line });
      }
    }
    return { ...result, source: 'cli-fallback', sqliteError: error.message, messages };
  }
}
