import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, WORKSPACE_DIR } from './storage.js';

export const HIGH_RISK_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bdel\s+\/s\b/i,
  /\brmdir\s+\/s\b/i,
  /format\s+[a-z]:/i,
  /Remove-Item\s+/i,
  /\bdel\b/i,
  /\berase\b/i,
  /\brm\b/i,
  /\brmdir\b/i,
  /\bRemove-Item\b/i,
  /\bshutdown\b/i,
  /\breg\s+delete\b/i,
  /\bdiskpart\b/i,
  /\bmkfs\b/i
];

export const BLOCKED_PATTERNS = [
  /powershell\s+.*Set-ExecutionPolicy\s+Unrestricted/i,
  /curl\s+.*\|\s*(sh|bash|powershell)/i,
  /Invoke-WebRequest\s+.*\|\s*Invoke-Expression/i,
  /\biex\s*\(/i
];

const COMMAND_RULES = [
  { level: 'auto', title: '只读命令自动执行', desc: 'Get-ChildItem、Get-Content、Select-String、Test-Path、git status/log/diff/show 等只读查询可自动执行。' },
  { level: 'confirm', title: '普通写入需确认', desc: '非只读命令默认不会自动执行，需用户确认或由界面明确触发。' },
  { level: 'confirm', title: '高风险命令强制确认', desc: '删除、递归移除、注册表删除、关机、磁盘操作等命令会被标记为高风险。' },
  { level: 'blocked', title: '远程脚本管道与放宽执行策略禁止', desc: 'curl | sh、Invoke-WebRequest | Invoke-Expression、iex(...)、Set-ExecutionPolicy Unrestricted 被直接阻断。' }
];

const FILE_BOUNDARIES = [
  { scope: 'allow', title: '工作区目录', path: WORKSPACE_DIR, desc: '文件浏览、读写、上传和删除接口被限制在此目录内。' },
  { scope: 'confirm', title: 'Hermes 配置目录', path: path.join(process.env.USERPROFILE || process.env.HOME || '', '.hermes'), desc: '可能包含 API Key；诊断/模型配置只显示脱敏状态，不在前端暴露明文。' },
  { scope: 'confirm', title: '项目源码目录', path: process.cwd(), desc: '允许开发修改，但构建、安装依赖、重启服务应有日志记录。' },
  { scope: 'blocked', title: '工作区逃逸访问', path: '.. / 绝对路径逃逸', desc: 'safeResolveWorkspace 会阻止通过 ../ 或绝对路径访问工作区外文件。' }
];

function securityLogFile() {
  return path.join(DATA_DIR, 'security-log.jsonl');
}

export function appendSecurityLog(event = {}) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = {
      id: `sec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      time: new Date().toISOString(),
      ...event
    };
    fs.appendFileSync(securityLogFile(), `${JSON.stringify(payload)}\n`, 'utf8');
    return payload;
  } catch {
    return null;
  }
}

export function readSecurityLogs(limit = 40) {
  try {
    const file = securityLogFile();
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-Math.max(1, Number(limit) || 40))
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean)
      .reverse();
  } catch {
    return [];
  }
}

export function inspectCommand(command = '') {
  const text = String(command).trim();
  const isBlocked = BLOCKED_PATTERNS.some((rx) => rx.test(text));
  const isHighRisk = HIGH_RISK_PATTERNS.some((rx) => rx.test(text));
  return {
    command: text,
    isBlocked,
    isHighRisk,
    riskLevel: isBlocked ? 'blocked' : isHighRisk ? 'high' : 'normal',
    message: isBlocked
      ? '命令包含被禁止的远程脚本执行或系统策略修改模式。'
      : isHighRisk
        ? '命令可能删除文件、修改系统或关闭机器，需要二次确认。'
        : '命令风险较低，仍需用户确认后执行。'
  };
}

export function getSecurityStatus() {
  const logs = readSecurityLogs(80);
  const highRiskCount = logs.filter((item) => item.riskLevel === 'high' || item.riskLevel === 'blocked').length;
  const blockedCount = logs.filter((item) => item.riskLevel === 'blocked' || item.blocked).length;
  const confirmationCount = logs.filter((item) => item.needsConfirmation).length;

  return {
    ok: blockedCount === 0,
    generatedAt: new Date().toISOString(),
    overview: {
      riskLevel: highRiskCount ? 'attention' : 'guarded',
      riskLabel: highRiskCount ? '需要关注' : '防护正常',
      autoReadOnly: true,
      workspaceSandbox: true,
      blockedPatterns: BLOCKED_PATTERNS.length,
      highRiskPatterns: HIGH_RISK_PATTERNS.length,
      recentLogs: logs.length,
      highRiskCount,
      blockedCount,
      confirmationCount
    },
    commandRules: COMMAND_RULES,
    fileBoundaries: FILE_BOUNDARIES,
    recentLogs: logs.slice(0, 30)
  };
}
