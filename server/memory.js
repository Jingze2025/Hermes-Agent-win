import { MEMORY_FILE, readJson, writeJson, newId } from './storage.js';

const DEFAULT_MEMORY = {
  profile: '你是 Hermes Agent Web，运行在 Windows 11 上。你应该偏向给出可执行、稳健、安全的建议。',
  preferences: [
    '用户偏好中文界面和中文说明。',
    '执行终端命令前必须等待用户确认。',
    '不要使用弹窗阻塞界面；错误以聊天内系统消息展示。'
  ],
  facts: [],
  updatedAt: new Date().toISOString()
};

export function getMemory() {
  const memory = readJson(MEMORY_FILE, null);
  if (!memory) {
    writeJson(MEMORY_FILE, DEFAULT_MEMORY);
    return DEFAULT_MEMORY;
  }
  return memory;
}

export function updateMemory(patch) {
  const current = getMemory();
  const next = {
    ...current,
    ...patch,
    preferences: Array.isArray(patch.preferences) ? patch.preferences : current.preferences,
    facts: Array.isArray(patch.facts) ? patch.facts : current.facts,
    updatedAt: new Date().toISOString()
  };
  writeJson(MEMORY_FILE, next);
  return next;
}

export function addMemoryFact(text) {
  const memory = getMemory();
  const item = { id: newId('mem'), text, createdAt: new Date().toISOString() };
  memory.facts = [item, ...(memory.facts || [])].slice(0, 200);
  memory.updatedAt = new Date().toISOString();
  writeJson(MEMORY_FILE, memory);
  return item;
}

export function memoryAsSystemText() {
  const memory = getMemory();
  const prefs = (memory.preferences || []).map((x) => `- ${x}`).join('\n');
  const facts = (memory.facts || []).slice(0, 30).map((x) => `- ${x.text}`).join('\n');
  return [
    '长期记忆与偏好：',
    memory.profile ? `角色画像：${memory.profile}` : '',
    prefs ? `用户偏好：\n${prefs}` : '',
    facts ? `长期事实：\n${facts}` : ''
  ].filter(Boolean).join('\n\n');
}
