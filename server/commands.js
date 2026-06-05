import { COMMANDS_FILE, readJson, writeJson } from './storage.js';

const DEFAULT_COMMANDS = [
  {
    id: 'summarize',
    title: '总结当前文件',
    prompt: '请总结我刚刚上传或打开的文件，提取要点、风险和下一步建议。'
  },
  {
    id: 'write-tests',
    title: '生成测试',
    prompt: '请为当前代码生成单元测试，并说明如何运行。'
  },
  {
    id: 'explain-error',
    title: '解释报错',
    prompt: '请根据终端输出解释错误原因，并给出 Windows 11 下可执行的修复步骤。'
  },
  {
    id: 'refactor',
    title: '重构建议',
    prompt: '请审查当前代码结构，给出可落地的模块化和稳定性重构建议。'
  }
];

export function listCommands() {
  const commands = readJson(COMMANDS_FILE, null);
  if (!commands) {
    writeJson(COMMANDS_FILE, DEFAULT_COMMANDS);
    return DEFAULT_COMMANDS;
  }
  return commands;
}

export function saveCommands(commands) {
  writeJson(COMMANDS_FILE, commands);
  return commands;
}
