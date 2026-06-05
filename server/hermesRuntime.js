import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT = 30000;
const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
const HERMES_CONFIG = path.join(HERMES_HOME, 'config.yaml');

function normalizeOutput(result) {
  return `${result?.stdout || ''}${result?.stderr ? `\n${result.stderr}` : ''}`.trim();
}

function commandCandidates(cmd) {
  if (process.platform !== 'win32') return [cmd];
  if (/\.(cmd|exe|bat)$/i.test(cmd) || cmd.includes(path.sep)) return [cmd];
  const pathDirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const pathext = ['.cmd', '.exe', '.bat', ''];
  const found = [];
  for (const dir of pathDirs) {
    for (const ext of pathext) {
      const full = path.join(dir, cmd + ext);
      if (fs.existsSync(full)) found.push(full);
    }
  }
  return [...new Set([...found, cmd])];
}

async function run(cmd, args = [], options = {}) {
  if (process.platform === 'win32' && /^(npm|npx)$/i.test(cmd)) {
    try {
      const result = await execFileAsync('cmd.exe', ['/d', '/s', '/c', `${cmd} ${args.map((a) => String(a)).join(' ')}`], {
        timeout: options.timeout || DEFAULT_TIMEOUT,
        windowsHide: true,
        maxBuffer: options.maxBuffer || 1024 * 1024,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });
      return { ok: true, command: [cmd, ...args].join(' '), output: normalizeOutput(result) };
    } catch (error) {
      return {
        ok: false,
        command: [cmd, ...args].join(' '),
        output: `${error?.stdout || ''}${error?.stderr || ''}`.trim(),
        error: error?.message || String(error),
        code: error?.code ?? null
      };
    }
  }

  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)) {
    try {
      const result = await execFileAsync('cmd.exe', ['/d', '/s', '/c', `"${cmd}" ${args.map((a) => `"${String(a).replaceAll('"', '\\"')}"`).join(' ')}`], {
        timeout: options.timeout || DEFAULT_TIMEOUT,
        windowsHide: true,
        maxBuffer: options.maxBuffer || 1024 * 1024,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });
      return { ok: true, command: [cmd, ...args].join(' '), output: normalizeOutput(result) };
    } catch (error) {
      return {
        ok: false,
        command: [cmd, ...args].join(' '),
        output: `${error?.stdout || ''}${error?.stderr || ''}`.trim(),
        error: error?.message || String(error),
        code: error?.code ?? null
      };
    }
  }

  const candidates = commandCandidates(cmd);
  let last;
  for (const candidate of candidates) {
    try {
      const result = await execFileAsync(candidate, args, {
        timeout: options.timeout || DEFAULT_TIMEOUT,
        windowsHide: true,
        maxBuffer: options.maxBuffer || 1024 * 1024,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });
      return { ok: true, command: [candidate, ...args].join(' '), output: normalizeOutput(result) };
    } catch (error) {
      last = {
        ok: false,
        command: [candidate, ...args].join(' '),
        output: `${error?.stdout || ''}${error?.stderr || ''}`.trim(),
        error: error?.message || String(error),
        code: error?.code ?? null
      };
      if (error?.code !== 'ENOENT') return last;
    }
  }
  return last || { ok: false, command: [cmd, ...args].join(' '), output: '', error: 'Command not found.', code: 'ENOENT' };
}

async function commandVersion(cmd, args = ['--version']) {
  const result = await run(cmd, args, { timeout: 12000 });
  return { ok: result.ok, version: result.output.split(/\r?\n/).find(Boolean) || '', error: result.ok ? '' : (result.output || result.error) };
}

async function pipShow(packageName) {
  const result = await run('python', ['-m', 'pip', 'show', packageName], { timeout: 20000 });
  const fields = {};
  if (result.ok) {
    for (const line of result.output.split(/\r?\n/)) {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) fields[match[1].toLowerCase()] = match[2];
    }
  }
  return {
    ok: result.ok,
    name: fields.name || packageName,
    version: fields.version || '',
    location: fields.location || '',
    editableProjectLocation: fields['editable project location'] || '',
    error: result.ok ? '' : (result.output || result.error)
  };
}

async function pythonUserScriptsDir() {
  const code = "import site, os; print(os.path.join(site.USER_BASE, 'Scripts'))";
  const result = await run('python', ['-c', code], { timeout: 12000 });
  return result.ok ? result.output.split(/\r?\n/).find(Boolean) : '';
}

async function findHermesExecutable() {
  const candidates = [];
  if (process.env.HERMES_EXE) candidates.push(process.env.HERMES_EXE);
  candidates.push('hermes');

  const scriptsDir = await pythonUserScriptsDir();
  if (scriptsDir) {
    candidates.push(path.join(scriptsDir, 'hermes.exe'), path.join(scriptsDir, 'hermes'));
    if (/AppData\\Roaming\\Python\\Scripts/i.test(scriptsDir)) {
      const localPackagesScripts = scriptsDir.replace(/AppData\\Roaming\\Python\\Scripts/i, 'AppData\\Local\\Packages\\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\\LocalCache\\local-packages\\Python313\\Scripts');
      candidates.push(path.join(localPackagesScripts, 'hermes.exe'), path.join(localPackagesScripts, 'hermes'));
    }
  }

  const pip = await pipShow('hermes-agent');
  if (pip.location) {
    const localPackages = pip.location;
    const parts = localPackages.split(path.sep);
    const scriptsIndex = parts.findIndex((p) => /^Python\d+/i.test(p));
    if (scriptsIndex >= 0) {
      const prefix = parts.slice(0, scriptsIndex + 1).join(path.sep);
      candidates.push(path.join(prefix, 'Scripts', 'hermes.exe'));
    }
  }

  const tried = [];
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    tried.push(candidate);
    if (candidate.includes(path.sep) && !fs.existsSync(candidate)) continue;
    const probe = await run(candidate, ['--version'], { timeout: 12000 });
    if (probe.ok) {
      return { ok: true, command: candidate, version: probe.output.split(/\r?\n/).find(Boolean) || '', tried };
    }
    const helpProbe = await run(candidate, ['--help'], { timeout: 12000 });
    if (helpProbe.ok) {
      return { ok: true, command: candidate, version: '', tried };
    }
    if (/No module named 'hermes_cli'|No module named hermes_cli/i.test(`${probe.output}\n${probe.error}\n${helpProbe.output}\n${helpProbe.error}`)) {
      return { ok: false, command: candidate, version: '', tried, repairHint: 'Hermes launcher exists but Python module hermes_cli is missing. Run runtime/setup-hermes-runtime.ps1 or reinstall the official Hermes source/package.' };
    }
  }
  return { ok: false, command: '', version: '', tried };
}

function parseMcpServers(configText = '') {
  const servers = [];
  const lines = String(configText || '').split(/\r?\n/);
  let inMcp = false;
  let current = null;
  for (const line of lines) {
    if (/^mcp_servers\s*:/i.test(line.trim())) {
      inMcp = true;
      continue;
    }
    if (!inMcp) continue;
    const serverMatch = line.match(/^\s{2}([A-Za-z0-9_.-]+):\s*$/);
    if (serverMatch) {
      current = { name: serverMatch[1], enabled: null, command: '', args: [] };
      servers.push(current);
      continue;
    }
    if (!current) continue;
    const enabledMatch = line.match(/^\s{4}enabled:\s*(true|false)/i);
    if (enabledMatch) current.enabled = enabledMatch[1].toLowerCase() === 'true';
    const commandMatch = line.match(/^\s{4}command:\s*(.+)$/i);
    if (commandMatch) current.command = commandMatch[1].replace(/^['"]|['"]$/g, '');
    const argMatch = line.match(/^\s{6}-\s*['"]?(.+?)['"]?\s*$/);
    if (argMatch) current.args.push(argMatch[1]);
  }
  return servers;
}

export function getHermesPaths() {
  return { hermesHome: HERMES_HOME, configPath: HERMES_CONFIG };
}

export async function getHermesStatus() {
  const [node, npm, npx, python, pip, hermesPkg, mcpPkg, hermesExe] = await Promise.all([
    commandVersion('node'),
    commandVersion('npm'),
    commandVersion('npx'),
    commandVersion('python', ['--version']),
    commandVersion('python', ['-m', 'pip', '--version']),
    pipShow('hermes-agent'),
    pipShow('mcp'),
    findHermesExecutable()
  ]);

  const configExists = fs.existsSync(HERMES_CONFIG);
  const configText = configExists ? fs.readFileSync(HERMES_CONFIG, 'utf8').replace(/^\uFEFF/, '') : '';
  const mcpServers = parseMcpServers(configText);

  let mcpList = { ok: false, output: '', error: 'Hermes executable not available.' };
  if (hermesExe.ok) {
    mcpList = await run(hermesExe.command, ['mcp', 'list'], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  }

  return {
    ok: Boolean(node.ok && npm.ok && python.ok && pip.ok && hermesPkg.ok && mcpPkg.ok && hermesExe.ok),
    checkedAt: new Date().toISOString(),
    paths: getHermesPaths(),
    node,
    npm,
    npx,
    python,
    pip,
    packages: {
      hermesAgent: hermesPkg,
      mcp: mcpPkg
    },
    hermes: hermesExe,
    config: {
      exists: configExists,
      servers: mcpServers,
      text: configText
    },
    mcpList: {
      ok: mcpList.ok,
      output: mcpList.output || '',
      error: mcpList.ok ? '' : (mcpList.output || mcpList.error)
    }
  };
}

function buildDefaultMcpConfig() {
  const workspace = path.resolve(process.cwd(), 'workspace');
  const desktop = path.join(os.homedir(), 'Desktop');
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
  return [
    'mcp_servers:',
    '  filesystem:',
    '    command: npx',
    '    args:',
    "      - '-y'",
    "      - '@modelcontextprotocol/server-filesystem'",
    `      - ${q(workspace)}`,
    `      - ${q(desktop)}`,
    '    enabled: true',
    '  playwright:',
    '    command: npx',
    '    args:',
    "      - '-y'",
    "      - '@playwright/mcp@latest'",
    "      - '--browser'",
    "      - 'msedge'",
    "      - '--headless'",
    fs.existsSync(edge) ? "      - '--executable-path'" : '',
    fs.existsSync(edge) ? `      - ${q(edge)}` : '',
    '    enabled: false',
    ''
  ].filter((line) => line !== '').join('\n');
}

export function writeDefaultHermesConfig({ overwrite = false } = {}) {
  fs.mkdirSync(HERMES_HOME, { recursive: true });
  const defaultMcp = buildDefaultMcpConfig();
  if (fs.existsSync(HERMES_CONFIG) && !overwrite) {
    const existing = fs.readFileSync(HERMES_CONFIG, 'utf8').replace(/^\uFEFF/, '');
    if (/^mcp_servers\s*:/im.test(existing)) {
      return { ok: true, changed: false, path: HERMES_CONFIG, message: 'config.yaml already has mcp_servers.' };
    }
    const next = `${existing.replace(/\s*$/, '')}\n\n${defaultMcp}`;
    fs.writeFileSync(HERMES_CONFIG, next, 'utf8');
    return { ok: true, changed: true, path: HERMES_CONFIG, message: 'Default mcp_servers appended to existing config.yaml.' };
  }
  fs.writeFileSync(HERMES_CONFIG, defaultMcp, 'utf8');
  return { ok: true, changed: true, path: HERMES_CONFIG, message: 'Default Hermes MCP config written.' };
}

export function addHermesMcpServer(input = {}) {
  const name = String(input.name || '').trim();
  const command = String(input.command || 'npx').trim();
  const args = Array.isArray(input.args)
    ? input.args.map((arg) => String(arg).trim()).filter(Boolean)
    : String(input.args || '').split(/\r?\n|,/).map((arg) => arg.trim()).filter(Boolean);
  const enabled = input.enabled !== false;

  if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error('MCP server 名称只能包含字母、数字、下划线、点和短横线。');
  if (!command) throw new Error('请填写 MCP server 启动命令。');

  fs.mkdirSync(HERMES_HOME, { recursive: true });
  let existing = fs.existsSync(HERMES_CONFIG) ? fs.readFileSync(HERMES_CONFIG, 'utf8').replace(/^\uFEFF/, '') : '';
  if (new RegExp(`^\\s{2}${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*$`, 'im').test(existing)) {
    throw new Error(`MCP server 已存在：${name}`);
  }
  if (!/^mcp_servers\s*:/im.test(existing)) {
    existing = `${existing.replace(/\s*$/, '')}${existing.trim() ? '\n\n' : ''}mcp_servers:\n`;
  }
  const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const block = [
    `  ${name}:`,
    `    command: ${q(command)}`,
    '    args:',
    ...args.map((arg) => `      - ${q(arg)}`),
    `    enabled: ${enabled ? 'true' : 'false'}`,
    ''
  ].join('\n');
  const next = `${existing.replace(/\s*$/, '')}\n${block}`;
  fs.writeFileSync(HERMES_CONFIG, next, 'utf8');
  return { ok: true, changed: true, path: HERMES_CONFIG, server: { name, command, args, enabled } };
}

export async function runHermesMcpTest(serverName) {
  const safeName = String(serverName || '').trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(safeName)) throw new Error('MCP server name is invalid.');
  const hermesExe = await findHermesExecutable();
  if (!hermesExe.ok) {
    return { ok: false, server: safeName, error: 'Hermes executable not found.', hermes: hermesExe };
  }
  const result = await run(hermesExe.command, ['mcp', 'test', safeName], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  return { ok: result.ok, server: safeName, command: result.command, output: result.output, error: result.ok ? '' : (result.output || result.error) };
}

export async function runHermesMcpList() {
  const hermesExe = await findHermesExecutable();
  if (!hermesExe.ok) return { ok: false, error: 'Hermes executable not found.', hermes: hermesExe };
  const result = await run(hermesExe.command, ['mcp', 'list'], { timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  return { ok: result.ok, command: result.command, output: result.output, error: result.ok ? '' : (result.output || result.error) };
}

function summarizeRuntime(status) {
  const checks = [
    { key: 'node', ok: status.node?.ok, label: 'Node.js', repairable: false, detail: status.node?.version || status.node?.error },
    { key: 'npm', ok: status.npm?.ok, label: 'npm', repairable: false, detail: status.npm?.version || status.npm?.error },
    { key: 'python', ok: status.python?.ok, label: 'Python', repairable: false, detail: status.python?.version || status.python?.error },
    { key: 'pip', ok: status.pip?.ok, label: 'pip', repairable: true, detail: status.pip?.version || status.pip?.error },
    { key: 'hermes-agent', ok: status.packages?.hermesAgent?.ok, label: 'hermes-agent Python 包', repairable: true, detail: status.packages?.hermesAgent?.version || status.packages?.hermesAgent?.error },
    { key: 'mcp', ok: status.packages?.mcp?.ok, label: 'mcp Python 包', repairable: true, detail: status.packages?.mcp?.version || status.packages?.mcp?.error },
    { key: 'hermes-cli', ok: status.hermes?.ok, label: 'Hermes CLI', repairable: true, detail: status.hermes?.version || status.hermes?.repairHint || status.hermes?.error },
    { key: 'config', ok: status.config?.exists, label: 'Hermes config.yaml', repairable: true, detail: status.paths?.configPath },
    { key: 'mcp-servers', ok: (status.config?.servers || []).length > 0, label: 'MCP server 配置', repairable: true, detail: `${status.config?.servers?.length || 0} 个 server` }
  ];
  const failed = checks.filter((item) => !item.ok);
  return {
    ok: failed.length === 0,
    checkedAt: status.checkedAt,
    checks,
    failed,
    repairableCount: failed.filter((item) => item.repairable).length,
    manualCount: failed.filter((item) => !item.repairable).length,
    summary: failed.length
      ? `发现 ${failed.length} 项问题，其中 ${failed.filter((item) => item.repairable).length} 项可尝试自动修复。`
      : '全部核心检查通过。'
  };
}

export async function diagnoseHermesRuntime() {
  const status = await getHermesStatus();
  return { ok: status.ok, status, diagnosis: summarizeRuntime(status) };
}

export async function repairHermesRuntime({ writeConfig = true, runSetup = true } = {}) {
  const before = await diagnoseHermesRuntime();
  const actions = [];

  if (writeConfig && (!before.status.config?.exists || !(before.status.config?.servers || []).length)) {
    try {
      actions.push({ step: 'write-default-config', ...writeDefaultHermesConfig({ overwrite: false }) });
    } catch (error) {
      actions.push({ step: 'write-default-config', ok: false, error: error?.message || String(error) });
    }
  }

  if (runSetup) {
    actions.push(await run('python', ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'], {
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024
    }).then((result) => ({
      step: 'upgrade-pip-tooling',
      ok: result.ok,
      command: result.command,
      output: result.output,
      error: result.ok ? '' : (result.output || result.error)
    })));

    const officialSrc = path.resolve(process.cwd(), '..', 'hermes-agent');
    const hasBundledSource = fs.existsSync(path.join(officialSrc, 'pyproject.toml'));
    const installArgs = hasBundledSource
      ? ['-m', 'pip', 'install', '-e', `${officialSrc}[mcp,cli,web,acp]`]
      : ['-m', 'pip', 'install', '--upgrade', 'hermes-agent', 'mcp'];
    actions.push(await run('python', installArgs, {
      timeout: 240000,
      maxBuffer: 6 * 1024 * 1024
    }).then((result) => ({
      step: hasBundledSource ? 'install-bundled-hermes-runtime' : 'install-online-hermes-runtime',
      ok: result.ok,
      command: result.command,
      output: result.output,
      error: result.ok ? '' : (result.output || result.error)
    })));

    const scriptsDir = await pythonUserScriptsDir();
    actions.push({
      step: 'python-scripts-path-check',
      ok: Boolean(scriptsDir),
      changed: false,
      output: scriptsDir ? `Python user Scripts directory: ${scriptsDir}. If hermes is not on PATH, add this directory to the user PATH.` : 'Unable to determine Python Scripts directory.'
    });
  }

  const after = await diagnoseHermesRuntime();
  return {
    ok: after.ok,
    repairedAt: new Date().toISOString(),
    before: before.diagnosis,
    after: after.diagnosis,
    status: after.status,
    actions
  };
}
