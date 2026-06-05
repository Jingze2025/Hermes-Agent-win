import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { memoryAsSystemText } from './memory.js';
import { getDefaultModelId, getPublicModels, resolveModelRuntime } from './modelConfig.js';

export const DEFAULT_MODEL = getDefaultModelId();
export const MODELS = getPublicModels();

function estimateTokens(text = '') {
  // 简易估算：中英文混排下约 1 token ~= 3 字符，实际用量以后端返回 usage 为准。
  return Math.ceil(String(text).length / 3);
}

function normalizeMessages(messages = []) {
  return messages
    .filter((m) => ['user', 'assistant'].includes(m.role))
    .slice(-30)
    .map((m) => ({ role: m.role, content: String(m.content || '') }));
}

function providerFor(model) {
  return resolveModelRuntime(model)?.provider || 'openai';
}

function buildSystemPrompt(runtime = {}) {
  const modelIdentity = [
    `当前实际调用模型显示名：${runtime.label || runtime.id || '未命名模型'}`,
    `当前实际调用模型名/API model：${runtime.apiModel || '未知'}`,
    runtime.baseUrl ? `当前模型连接地址/Base URL：${runtime.baseUrl}` : '',
    runtime.provider ? `当前模型协议/Provider：${runtime.provider}` : ''
  ].filter(Boolean).join('\n');

  return [
    '你是爱马仕AI（Hermes Agent Web）的智能体内核。',
    modelIdentity ? `【运行时模型身份】\n${modelIdentity}\n当用户询问“你是什么模型 / 当前用的什么模型 / 模型编号”时，必须基于以上运行时模型身份直接回答，不要说你无法看到后端配置。` : '',
    '你运行在 Windows 11 网页应用中，具备对话、长期记忆、文件操作、终端/PowerShell 调用等能力。',
    '如果用户要求你查看目录、读取文件、检查项目、运行 PowerShell/终端命令、删除/清理/移动文件，不要口头询问确认；请直接发起 Hermes 内部工具调用。',,
    '工具调用格式必须是唯一的 fenced code block，且不要夹杂解释：',
    '```hermes-tool',
    '{"tool":"powershell","command":"Get-ChildItem","reason":"列出当前目录"}',
    '```',
    '只能在确实需要执行终端/PowerShell 时使用工具调用。',
    '低风险只读命令会自动执行；高风险命令（例如 Remove-Item 删除文件）会由系统拦截并显示给用户确认，不要说你没有 PowerShell 工具，也不要只让用户自己去 PowerShell 执行。',,
    '优先使用只读、低风险命令，例如 Get-ChildItem、Get-Content、Select-String、Test-Path、git status。',
    '不要主动执行删除、格式化、关闭系统、修改执行策略、远程脚本管道等危险命令；如果用户明确要求删除文件，可以发起 Remove-Item 工具调用，系统会拦截为需要确认。',,
    '工具执行结果会由系统返回给你，你再基于结果给用户最终回答。',
    '回答偏向可操作、模块化、清晰。',
    memoryAsSystemText()
  ].join('\n\n');
}

function friendlyModelError(error) {
  const raw = String(error?.message || error || '');
  if (/no available channel|503/i.test(raw)) {
    return '当前模型通道不可用。请在右侧“模型配置”中更换 Base URL、API Key 或模型名。';
  }
  if (/insufficient account balance|balance|quota|billing|403/i.test(raw)) {
    return '当前模型接口返回 403：账号余额不足或额度不可用。请在右侧“模型配置”中更换连接网址、密钥或模型名。';
  }
  if (/401|unauthorized|api key/i.test(raw)) {
    return '模型接口认证失败：API Key 无效或未配置。请检查右侧“模型配置”。';
  }
  if (/429|rate limit/i.test(raw)) {
    return '模型接口限流：请求过快或额度达到速率限制，请稍后再试。';
  }
  return raw || 'AI 请求失败，请检查网络、Base URL 或 API Key。';
}

async function* streamOpenAI({ model, messages, onUsage }) {
  const runtime = resolveModelRuntime(model);
  if (!runtime.apiKey) {
    yield '⚠️ 未配置当前 OpenAI-compatible 模型的 API Key。请在右侧“模型配置”中填写连接网址、密钥和模型名。';
    onUsage?.({ prompt: 0, completion: 0, total: 0 });
    return;
  }

  const client = new OpenAI({
    apiKey: runtime.apiKey,
    baseURL: runtime.baseUrl || undefined
  });

  let response;
  try {
    response = await client.chat.completions.create({
      model: runtime.apiModel,
      stream: true,
      messages: [{ role: 'system', content: buildSystemPrompt(runtime) }, ...normalizeMessages(messages)]
    });
  } catch (error) {
    yield `⚠️ ${friendlyModelError(error)}`;
    onUsage?.({ prompt: 0, completion: 0, total: 0 });
    return;
  }

  let completion = '';
  for await (const chunk of response) {
    const delta = chunk.choices?.[0]?.delta?.content || '';
    if (delta) {
      completion += delta;
      yield delta;
    }
  }
  const promptText = messages.map((m) => m.content).join('\n');
  const usage = {
    prompt: estimateTokens(promptText),
    completion: estimateTokens(completion),
    total: estimateTokens(promptText) + estimateTokens(completion)
  };
  onUsage?.(usage);
}

async function* streamAnthropic({ model, messages, onUsage }) {
  const runtime = resolveModelRuntime(model);
  if (!runtime.apiKey) {
    yield '⚠️ 未配置 ANTHROPIC_API_KEY。请在右侧“模型配置”中切换到 OpenAI-compatible 模型，或配置 Anthropic Key。';
    onUsage?.({ prompt: 0, completion: 0, total: 0 });
    return;
  }

  const client = new Anthropic({ apiKey: runtime.apiKey });
  const normalized = normalizeMessages(messages);
  let stream;
  try {
    stream = await client.messages.create({
      model: runtime.apiModel,
      max_tokens: 4096,
      system: buildSystemPrompt(runtime),
      messages: normalized,
      stream: true
    });
  } catch (error) {
    yield `⚠️ ${friendlyModelError(error)}`;
    onUsage?.({ prompt: 0, completion: 0, total: 0 });
    return;
  }

  let completion = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.text) {
      completion += event.delta.text;
      yield event.delta.text;
    }
  }
  const promptText = normalized.map((m) => m.content).join('\n');
  const usage = {
    prompt: estimateTokens(promptText),
    completion: estimateTokens(completion),
    total: estimateTokens(promptText) + estimateTokens(completion)
  };
  onUsage?.(usage);
}

export async function* streamChat({ model, messages, onUsage }) {
  const provider = providerFor(model);
  if (provider === 'anthropic') {
    yield* streamAnthropic({ model, messages, onUsage });
    return;
  }
  yield* streamOpenAI({ model, messages, onUsage });
}

export function usageFromMessages(messages = []) {
  return messages.reduce(
    (acc, m) => {
      const usage = m.usage || { prompt: 0, completion: 0, total: estimateTokens(m.content) };
      acc.prompt += usage.prompt || 0;
      acc.completion += usage.completion || 0;
      acc.total += usage.total || 0;
      return acc;
    },
    { prompt: 0, completion: 0, total: 0 }
  );
}
