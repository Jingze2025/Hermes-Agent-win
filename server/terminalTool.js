import { spawn } from 'node:child_process';
import path from 'node:path';
import { inspectCommand, appendSecurityLog } from './security.js';

export const EXEC_ROOT = path.resolve(process.cwd());

const SAFE_READ_PATTERNS = [
  /^\s*(Get-ChildItem|gci|ls|dir)\b/i,
  /^\s*(Get-Content|gc|cat|type)\b/i,
  /^\s*(Select-String|sls)\b/i,
  /^\s*(Test-Path)\b/i,
  /^\s*(Get-Location|pwd)\b/i,
  /^\s*(Write-Output|echo)\b/i,
  /^\s*(node\s+--version|npm\s+--version|python\s+--version|git\s+status|git\s+log\b|git\s+diff\b|git\s+show\b)/i
];

export function extractHermesToolCall(text = '') {
  const source = String(text || '');
  const matches = [
    ...source.matchAll(/```hermes-tool\s*([\s\S]*?)```/gi),
    ...source.matchAll(/<hermes-tool>([\s\S]*?)<\/hermes-tool>/gi)
  ];
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed?.tool === 'powershell' && parsed.command) {
        return {
          tool: 'powershell',
          command: String(parsed.command),
          reason: String(parsed.reason || '')
        };
      }
    } catch {
      // ignore malformed model output
    }
  }
  return null;
}

export function stripHermesToolCall(text = '') {
  return String(text)
    .replace(/```hermes-tool\s*[\s\S]*?```/gi, '')
    .replace(/<hermes-tool>[\s\S]*?<\/hermes-tool>/gi, '')
    .trim();
}

export function isSafeAutoCommand(command = '') {
  return SAFE_READ_PATTERNS.some((rx) => rx.test(String(command).trim()));
}

export function runPowerShellCommand(command, { allowUnsafe = false, allowNormal = false, cwd = EXEC_ROOT, timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    const cleanCommand = String(command || '').trim();
    const inspection = inspectCommand(cleanCommand);
    const safeAuto = isSafeAutoCommand(cleanCommand);

    if (!cleanCommand) {
      resolve({ ok: false, output: '', error: '命令为空。', cwd });
      return;
    }
    if (inspection.isBlocked) {
      appendSecurityLog({ type: 'command', action: 'blocked', command: cleanCommand, riskLevel: 'blocked', blocked: true, message: inspection.message, cwd });
      resolve({ ok: false, blocked: true, inspection, output: '', error: inspection.message, cwd });
      return;
    }
    if (inspection.isHighRisk && !allowUnsafe) {
      appendSecurityLog({ type: 'command', action: 'needs-confirmation', command: cleanCommand, riskLevel: 'high', needsConfirmation: true, message: inspection.message, cwd });
      resolve({
        ok: false,
        needsConfirmation: true,
        inspection,
        output: '',
        error: `命令未自动执行：${inspection.message} 高风险命令需要人工确认。`,
        cwd
      });
      return;
    }
    if (!safeAuto && !allowNormal && !allowUnsafe) {
      appendSecurityLog({ type: 'command', action: 'needs-confirmation', command: cleanCommand, riskLevel: inspection.riskLevel, needsConfirmation: true, message: inspection.message, cwd });
      resolve({
        ok: false,
        needsConfirmation: true,
        inspection,
        output: '',
        error: `命令未自动执行：${inspection.message} 当前自动执行仅限只读/低风险命令。`,
        cwd
      });
      return;
    }

    const utf8Bootstrap = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding;';
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `${utf8Bootstrap} ${cleanCommand}`], {
      cwd,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '0', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    });

    let output = '';
    let error = '';
    const timer = setTimeout(() => {
      error += `\n命令超时（${timeoutMs}ms），已终止。`;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { error += data.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, inspection, output, error: err.message, cwd });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      appendSecurityLog({ type: 'command', action: 'executed', command: cleanCommand, riskLevel: inspection.riskLevel, ok: code === 0, code, cwd });
      resolve({ ok: code === 0, inspection, output, error, code, cwd });
    });
  });
}
