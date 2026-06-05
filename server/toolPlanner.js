export function planPowerShellFromUserMessage(message = '') {
  const text = String(message || '').trim();
  if (!text) return null;

  const lower = text.toLowerCase();

  // Explicit fenced/single-line PowerShell command requests.
  const explicit = text.match(/(?:执行|运行|调用|run)\s*(?:powershell|终端|terminal|命令)?[:：]?\s*`?([^`\n]+)`?/i);
  if (explicit?.[1]) {
    const command = explicit[1].trim();
    if (command && !/^(一下|这个|它|命令)$/i.test(command)) {
      return { command, reason: '用户明确要求执行命令' };
    }
  }

  const pathMatches = [
    ...text.matchAll(/"\s*([A-Za-z]:\\[^"\n]+?)\s*"/g),
    ...text.matchAll(/'\s*([A-Za-z]:\\[^'\n]+?)\s*'/g)
  ];
  const requestedPath = pathMatches.at(-1)?.[1];
  if (requestedPath && /(删除|移除|清理|删掉|去掉|remove|delete)/i.test(text)) {
    const safePath = requestedPath.replaceAll("'", "''");
    return {
      command: `$p='${safePath}'; $trash=Join-Path (Get-Location) 'workspace\\.hermes-trash'; New-Item -ItemType Directory -Path $trash -Force | Out-Null; if (Test-Path -LiteralPath $p) { $name=[IO.Path]::GetFileName($p); $stamp=Get-Date -Format 'yyyyMMdd_HHmmss'; $dest=Join-Path $trash ($stamp + '_' + $name); Move-Item -LiteralPath $p -Destination $dest -Force; Write-Output \"MOVED_TO_TRASH: $dest\" } else { Write-Output \"NOT_FOUND: $p\" }`,
      reason: `用户要求删除指定文件，改为移入 Hermes 回收站以便恢复：${requestedPath}`
    };
  }

  if ((/package\.json/i.test(text) && /(读取|查看|分析|总结|启动|scripts?|依赖|内容)/i.test(text)) || /(项目.*启动方式|启动方式.*项目)/i.test(text)) {
    return {
      command: 'Get-Content .\\package.json -Raw',
      reason: '读取项目 package.json 以分析 scripts、依赖和启动方式'
    };
  }

  if (/(查看|列出|读取|显示).*(当前)?(目录|文件列表|项目结构)|当前目录|项目目录|\b(list|show|view)\b.*\b(current\s+)?(directory|dir|folder|files?)\b|\b(current\s+)?(directory|dir|folder)\b/i.test(text)) {
    return {
      command: 'Get-ChildItem -Force',
      reason: '列出当前项目根目录内容'
    };
  }

  if (/git\s*status|git状态|仓库状态|代码状态|改动状态/i.test(lower)) {
    return {
      command: 'git status --short',
      reason: '查看 Git 工作区状态'
    };
  }

  if (/npm\s*(scripts?|脚本)|查看.*scripts?|有哪些.*脚本/i.test(lower)) {
    return {
      command: "node -e \"const p=require('./package.json'); console.log(JSON.stringify(p.scripts||{}, null, 2))\"",
      reason: '查看 package.json scripts'
    };
  }

  if (/node\s*(版本|version)|node\.js.*版本/i.test(lower)) {
    return { command: 'node --version', reason: '查看 Node.js 版本' };
  }

  if (/npm\s*(版本|version)/i.test(lower)) {
    return { command: 'npm --version', reason: '查看 npm 版本' };
  }

  return null;
}
