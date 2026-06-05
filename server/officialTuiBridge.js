import os from 'node:os';
import { spawn } from 'node:child_process';
import { EXEC_ROOT } from './terminalTool.js';

const sessions = new Map();

function hermesCommand() {
  return process.platform === 'win32' ? 'hermes.exe' : 'hermes';
}

async function tryCreatePty({ args, cwd, cols, rows, env, onData, onExit, onError }) {
  try {
    const pty = await import('node-pty');
    const proc = pty.spawn(hermesCommand(), args, {
      name: process.platform === 'win32' ? 'xterm-256color' : 'xterm-color',
      cols,
      rows,
      cwd,
      env
    });
    proc.onData(onData);
    proc.onExit((event) => onExit(event.exitCode ?? 0, event.signal));
    return {
      kind: 'pty',
      write: (text) => proc.write(text),
      resize: (nextCols, nextRows) => proc.resize(nextCols, nextRows),
      kill: () => proc.kill()
    };
  } catch (error) {
    onError?.(new Error(`node-pty unavailable: ${error?.message || error}`));
    return null;
  }
}

function createPipeProcess({ args, cwd, env, onData, onExit, onError }) {
  let child;
  try {
    child = spawn(hermesCommand(), args, {
      cwd,
      shell: process.platform === 'win32',
      windowsHide: false,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (error) {
    onError?.(error);
    onExit(null, 'spawn-error');
    return { kind: 'pipe', write: () => {}, resize: () => {}, kill: () => {} };
  }
  child.stdout.on('data', (chunk) => onData(chunk.toString('utf8')));
  child.stderr.on('data', (chunk) => onData(chunk.toString('utf8')));
  child.on('error', (error) => onError?.(error));
  child.on('close', (code, signal) => onExit(code, signal));
  return {
    kind: 'pipe',
    write: (text) => child.stdin.write(text),
    resize: () => {},
    kill: () => child.kill('SIGTERM')
  };
}

export function attachOfficialTuiBridge(io) {
  io.on('connection', (socket) => {
    socket.on('official-tui:start', async (input = {}) => {
      if (sessions.has(socket.id)) {
        socket.emit('official-tui:error', { error: '已有官方 Chat 会话在运行，请先停止。' });
        return;
      }

      const mode = input.mode === 'classic' ? 'classic' : 'tui';
      const cols = Math.max(40, Number(input.cols || 120));
      const rows = Math.max(10, Number(input.rows || 32));
      const cwd = input.cwd || EXEC_ROOT;
      const args = [];
      if (mode === 'classic') {
        // no args: Hermes starts the classic interactive chat/REPL.
      } else {
        args.push('--tui');
      }
      if (input.model) args.push('--model', String(input.model));
      if (input.provider) args.push('--provider', String(input.provider));
      if (input.resume) args.push('--resume', String(input.resume));
      if (input.continueSession) args.push('--continue', String(input.continueSession));
      if (input.yolo) args.push('--yolo');

      const env = {
        ...process.env,
        FORCE_COLOR: '1',
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        PYTHONIOENCODING: 'utf-8',
        HERMES_WEB_TUI: '1'
      };

      const onData = (text) => socket.emit('official-tui:output', { text });
      const onExit = (code, signal) => {
        sessions.delete(socket.id);
        socket.emit('official-tui:exit', { code, signal });
      };
      const onError = (error) => socket.emit('official-tui:error', { error: error?.message || String(error) });

      let proc = null;
      if (input.preferPty !== false) proc = await tryCreatePty({ args, cwd, cols, rows, env, onData, onExit, onError });
      if (!proc) proc = createPipeProcess({ args: mode === 'tui' ? args : [], cwd, env, onData, onExit, onError });

      sessions.set(socket.id, proc);
      socket.emit('official-tui:status', {
        running: true,
        transport: proc.kind,
        mode,
        cwd,
        command: [hermesCommand(), ...args].join(' '),
        platform: `${os.platform()} ${os.release()}`,
        note: proc.kind === 'pty' ? '已通过 node-pty 启动官方 TUI。' : 'node-pty 不可用，已使用 pipe 兼容模式；TUI 可能降级为文本输出。'
      });
    });

    socket.on('official-tui:input', ({ text } = {}) => {
      const proc = sessions.get(socket.id);
      if (!proc) return socket.emit('official-tui:error', { error: '官方 Chat 会话未运行。' });
      proc.write(String(text ?? ''));
    });

    socket.on('official-tui:resize', ({ cols, rows } = {}) => {
      const proc = sessions.get(socket.id);
      if (!proc) return;
      proc.resize(Math.max(40, Number(cols || 120)), Math.max(10, Number(rows || 32)));
    });

    socket.on('official-tui:stop', () => {
      const proc = sessions.get(socket.id);
      if (!proc) return;
      proc.kill();
      sessions.delete(socket.id);
      socket.emit('official-tui:exit', { code: null, signal: 'stopped' });
    });

    socket.on('disconnect', () => {
      const proc = sessions.get(socket.id);
      if (proc) proc.kill();
      sessions.delete(socket.id);
    });
  });
}
