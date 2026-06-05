import { spawn } from 'node:child_process';
import path from 'node:path';
import { getHermesStatus } from './hermesRuntime.js';
import { resolveModelRuntime } from './modelConfig.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.HERMES_AGENT_LOOP_TIMEOUT_MS || 180000);

function sanitizeForHermes(text = '') {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
}

function messageTranscript(messages = [], limit = 18) {
  const recent = messages.slice(-limit);
  return recent
    .map((m) => {
      const role = m.role === 'assistant' ? 'Assistant' : m.role === 'user' ? 'User' : 'System';
      return `${role}: ${sanitizeForHermes(m.content || '')}`;
    })
    .filter((line) => line.trim())
    .join('\n\n');
}

function buildHermesPrompt({ session, userMessage, skillPrompt, enabledSkills, fileContext, attachedFiles }) {
  const transcript = messageTranscript((session?.messages || []).slice(0, -1));
  const parts = [
    '你现在作为官方 Hermes Agent Runtime 在网页端中运行。',
    '请用中文优先回答，保持简洁、准确、可执行。',
    '如果需要使用工具，请使用官方 Hermes Agent Loop 自带工具；不要假装执行。',
    transcript ? `【当前网页会话历史】\n${transcript}` : '',
    skillPrompt ? `【网页端启用技能提示】\n${sanitizeForHermes(skillPrompt)}` : '',
    Array.isArray(enabledSkills) && enabledSkills.length ? `【网页端启用技能列表】\n${enabledSkills.map((s) => s.title || s.id).join('、')}` : '',
    fileContext ? `【用户上传文件内容】\n${sanitizeForHermes(fileContext)}` : '',
    Array.isArray(attachedFiles) && attachedFiles.length ? `【附件列表】\n${attachedFiles.map((f) => `${f.name || 'file'} (${f.size || 0} bytes)`).join('、')}` : '',
    `【用户最新消息】\n${sanitizeForHermes(userMessage)}`
  ];
  return parts.filter(Boolean).join('\n\n');
}

function runtimeToHermesArgs(runtime = {}) {
  const args = [];
  const env = {};
  const model = runtime.apiModel || runtime.id;
  if (model) args.push('--model', model);

  if (runtime.provider === 'anthropic') {
    args.push('--provider', 'anthropic');
    if (runtime.apiKey) env.ANTHROPIC_API_KEY = runtime.apiKey;
  } else {
    args.push('--provider', 'custom');
    if (runtime.baseUrl) env.OPENAI_BASE_URL = runtime.baseUrl;
    if (runtime.apiKey) env.OPENAI_API_KEY = runtime.apiKey;
  }
  return { args, env };
}

function friendlyHermesError(errorText = '') {
  const text = String(errorText || '');
  if (/No inference provider configured|No LLM provider configured|Run `hermes model`|OPENAI_API_KEY contained/i.test(text)) {
    return [
      '模型 API 未正确配置。当前网页端已清空所有默认模型，请在右侧“模型配置”重新填写 Provider、Base URL、API Key 和 Model。',
      '注意：API Key 不能保留“把这里替换成...”这类中文占位符。',
      '',
      text
    ].join('\n');
  }
  return '';
}

export async function runHermesAgentLoop({ session, message, model, skillPrompt, enabledSkills, fileContext, attachedFiles, cwd }) {
  const status = await getHermesStatus();
  if (!status?.hermes?.ok || !status.hermes.command) {
    return {
      ok: false,
      error: '官方 Hermes CLI 不可用。请先运行 INSTALL-HERMES.bat；如果只需修复模型/Runtime，请运行 runtime/setup-hermes-runtime.ps1 和 CONFIGURE-MODEL.bat。',
      status
    };
  }

  const runtime = resolveModelRuntime(model || session?.model);
  const { args: modelArgs, env: runtimeEnv } = runtimeToHermesArgs(runtime);
  const prompt = buildHermesPrompt({ session, userMessage: message, skillPrompt, enabledSkills, fileContext, attachedFiles });
  const hermesArgs = ['-z', prompt, ...modelArgs];
  const commandText = [status.hermes.command, ...hermesArgs.map((a) => (String(a).includes(' ') ? `"${String(a).slice(0, 80)}..."` : a))].join(' ');

  return await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(status.hermes.command, hermesArgs, {
      cwd: cwd || process.cwd(),
      windowsHide: true,
      env: {
        ...process.env,
        ...runtimeEnv,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        HERMES_ACCEPT_HOOKS: '1'
      }
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch {}
      resolve({ ok: false, command: commandText, output: stdout.trim(), error: `Hermes Agent Loop 超时（${DEFAULT_TIMEOUT_MS}ms）。\n${stderr.trim()}`.trim() });
    }, DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', (data) => { stdout += data.toString('utf8'); });
    child.stderr.on('data', (data) => { stderr += data.toString('utf8'); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, command: commandText, output: stdout.trim(), error: error.message || String(error) });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = stdout.trim();
      const combinedError = stderr.trim() || `Hermes Agent Loop exited with code ${code}`;
      if (code === 0 && !output) {
        resolve({
          ok: false,
          code,
          command: commandText,
          output,
          error: `Hermes Agent Loop 正常退出但没有返回任何内容。可能原因：模型接口无响应、Hermes CLI 吞掉了上游错误，或当前 provider/model 配置不兼容。${stderr.trim() ? `\n${stderr.trim()}` : ''}`
        });
        return;
      }
      const friendly = code === 0 ? '' : friendlyHermesError(combinedError);
      resolve({
        ok: code === 0,
        code,
        command: commandText,
        output,
        error: code === 0 ? '' : (friendly || combinedError)
      });
    });
  });
}
