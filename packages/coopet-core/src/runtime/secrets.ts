/**
 * 扩展 World 的密钥（WorldContext 的 secret / storeSecret）：存在 `~/.config/coopet/secrets.json`，
 * 内容是 `{ 名字: 值 }`，权限 600，先写临时文件再改名。
 *
 * 规则照 Cortico 的 storeSecret：名字必须是环境变量名的样子，值不能为空、不能含空白。
 * 读不到的名字返回空字符串；同名环境变量优先（方便临时覆盖），和 Cortico 读部署 .env 的做法一致。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class SecretStore {
  constructor(private readonly file: string, private readonly env: NodeJS.ProcessEnv = process.env) {}

  get(name: string): string {
    const fromEnv = this.env[name];
    if (typeof fromEnv === 'string' && fromEnv) return fromEnv;
    const value = this.read()[name];
    return typeof value === 'string' ? value : '';
  }

  set(name: string, value: string): void {
    if (!NAME.test(name)) throw new Error(`密钥名必须是环境变量名的样子：${name}`);
    if (!value || /\s/.test(value)) throw new Error(`密钥 ${name} 的值不能为空或含空白`);
    const all = { ...this.read(), [name]: value };
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  private read(): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
}
