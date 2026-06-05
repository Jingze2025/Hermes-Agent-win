import dotenv from 'dotenv';

// 项目本地 .env 优先，避免 Windows 全局/父进程环境变量覆盖 Hermes Web 的模型密钥配置。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', 'data', '.env'), override: true });
