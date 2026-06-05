import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { appendSecurityLog } from './security.js';
import { safeResolveWorkspace, toWorkspaceRelative, WORKSPACE_DIR } from './storage.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
export const uploadMiddleware = upload.single('file');

const CHAT_ALLOWED_EXTS = new Set(['.txt', '.md', '.json', '.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css', '.csv']);
const CHAT_DISPLAY_ALLOWED_EXTS = new Set([...CHAT_ALLOWED_EXTS, '.pdf', '.docx']);
const CHAT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const CHAT_MAX_TOTAL_SIZE = 30 * 1024 * 1024;
export const chatUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CHAT_MAX_FILE_SIZE, files: 5 }
}).array('files', 5);

export function extractChatFiles(files = []) {
  if (!Array.isArray(files) || files.length === 0) return { files: [], context: '' };
  if (files.length > 5) {
    const err = new Error('最多一次上传 5 个文件。');
    err.status = 400;
    throw err;
  }
  const total = files.reduce((sum, file) => sum + (file.size || 0), 0);
  if (total > CHAT_MAX_TOTAL_SIZE) {
    const err = new Error('文件总大小不能超过 30MB。');
    err.status = 413;
    throw err;
  }

  const extracted = files.map((file) => {
    const safeName = file.originalname.replace(/[<>:"|?*]/g, '_');
    const ext = path.extname(safeName).toLowerCase();
    if (!CHAT_DISPLAY_ALLOWED_EXTS.has(ext)) {
      const err = new Error(`不支持的文件类型：${safeName}。支持 txt/md/json/js/py/html/css/pdf/docx。`);
      err.status = 415;
      throw err;
    }
    if ((file.size || 0) > CHAT_MAX_FILE_SIZE) {
      const err = new Error(`文件超过 10MB：${safeName}`);
      err.status = 413;
      throw err;
    }
    if (ext === '.pdf' || ext === '.docx') {
      const err = new Error(`${safeName} 是 ${ext.toUpperCase()} 文件，当前未安装解析库，暂不能提取内容。请先转为 txt/md 后上传。`);
      err.status = 415;
      throw err;
    }
    const text = file.buffer.toString('utf-8');
    return {
      name: safeName,
      size: file.size,
      type: file.mimetype || 'text/plain',
      ext,
      content: text.slice(0, 200000),
      truncated: text.length > 200000
    };
  });

  const context = extracted.map((file, index) => (
    `## 文件 ${index + 1}: ${file.name}\n` +
    `- 类型: ${file.type}\n` +
    `- 大小: ${file.size} bytes\n` +
    `- 是否截断: ${file.truncated ? '是，仅保留前 200000 字符' : '否'}\n\n` +
    '```text\n' + file.content + '\n```'
  )).join('\n\n');

  return { files: extracted.map(({ content, ...meta }) => meta), context };
}

export function listDir(relativePath = '.') {
  const dir = safeResolveWorkspace(relativePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) {
    const err = new Error('目标不是文件夹。');
    err.status = 400;
    throw err;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true }).map((entry) => {
    const abs = path.join(dir, entry.name);
    const st = fs.statSync(abs);
    return {
      name: entry.name,
      path: toWorkspaceRelative(abs),
      type: entry.isDirectory() ? 'directory' : 'file',
      size: st.size,
      updatedAt: st.mtime.toISOString()
    };
  });
  return {
    root: WORKSPACE_DIR,
    path: toWorkspaceRelative(dir) || '.',
    parent: dir === WORKSPACE_DIR ? null : toWorkspaceRelative(path.dirname(dir)) || '.',
    entries: entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1))
  };
}

export function readFile(relativePath) {
  const file = safeResolveWorkspace(relativePath);
  const stat = fs.statSync(file);
  if (stat.isDirectory()) {
    const err = new Error('请选择文件而不是文件夹。');
    err.status = 400;
    throw err;
  }
  if (stat.size > 2 * 1024 * 1024) {
    const err = new Error('文件超过 2MB，建议下载或分片处理。');
    err.status = 413;
    throw err;
  }
  const result = { path: toWorkspaceRelative(file), content: fs.readFileSync(file, 'utf-8') };
  appendSecurityLog({ type: 'file', action: 'read', path: result.path, riskLevel: 'normal', ok: true });
  return result;
}

export function writeFile(relativePath, content = '') {
  const file = safeResolveWorkspace(relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
  const result = { path: toWorkspaceRelative(file), size: Buffer.byteLength(content, 'utf-8') };
  appendSecurityLog({ type: 'file', action: 'write', path: result.path, size: result.size, riskLevel: 'normal', ok: true });
  return result;
}

export function makeDir(relativePath) {
  const dir = safeResolveWorkspace(relativePath);
  fs.mkdirSync(dir, { recursive: true });
  return { path: toWorkspaceRelative(dir) || '.' };
}

export function deletePath(relativePath) {
  const target = safeResolveWorkspace(relativePath);
  if (target === WORKSPACE_DIR) {
    const err = new Error('禁止删除工作目录根。');
    err.status = 403;
    throw err;
  }
  fs.rmSync(target, { recursive: true, force: true });
  const result = { path: relativePath, deleted: true };
  appendSecurityLog({ type: 'file', action: 'delete', path: relativePath, riskLevel: 'high', ok: true });
  return result;
}

export function handleUpload(file, targetPath = '.') {
  if (!file) {
    const err = new Error('未收到上传文件。');
    err.status = 400;
    throw err;
  }
  const dir = safeResolveWorkspace(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const safeName = file.originalname.replace(/[<>:"|?*]/g, '_');
  const dest = path.join(dir, safeName);
  fs.writeFileSync(dest, file.buffer);
  let preview = '';
  const ext = path.extname(safeName).toLowerCase();
  if (['.txt', '.md', '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.html', '.py', '.csv'].includes(ext)) {
    preview = file.buffer.toString('utf-8').slice(0, 12000);
  }
  const result = { path: toWorkspaceRelative(dest), size: file.size, preview };
  appendSecurityLog({ type: 'file', action: 'upload', path: result.path, size: result.size, riskLevel: 'normal', ok: true });
  return result;
}
