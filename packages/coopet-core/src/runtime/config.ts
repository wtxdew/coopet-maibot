/**
 * 配置的读取与回写。
 *
 * 文件 `~/.config/coopet/config.json` 只保存**改过的项**（覆盖层），不写入默认值，
 * 这样上游改了默认值也能生效。运行时的配置 = 默认值 ← 本项目的默认值 ← 文件覆盖层。
 *
 * `cfg.pet` 交给桌宠 World 后，桌宠每次用到配置时才读它，所以它必须一直是同一个对象：
 * 回写时在原对象上合并，不替换。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DeepPartial } from 'cortico/world.ts';
import type { Logger } from 'cortico/core/types.ts';
import { DESKTOP_PET_DEFAULTS, type DesktopPetConfigSection } from 'cortico-world-desktop-pet';

/** 与 MaiBot 的连接；具体字段在设计 link/ 时再定，这里先放已确定的。 */
export interface LinkConfig {
  /** maim_message 旧版 WS 地址 */
  url: string;
  /** token 文件的绝对路径 */
  tokenFile: string;
  /** 麦麦在 coopet 平台上的账号，须与 MaiBot 的 bot.platforms 一致 */
  botAccount: string;
  /** 使用者在 coopet 平台上的 user_id */
  userId: string;
  /** 麦麦怎么称呼使用者 */
  userNickname: string;
}

export interface CoopetConfig {
  link: LinkConfig;
  pet: DesktopPetConfigSection;
}

export interface CoopetDirs {
  /** 配置根目录 */
  root: string;
  configFile: string;
  /** 桌宠的数据目录 */
  data: string;
  /** 已安装的形象包 */
  figures: string;
  /** 语音等运行时 */
  runtimes: string;
  /** 语音模型 */
  models: string;
}

/** 阶段 1 先用 ~/.config/coopet，Mac 和 Windows 都可用；阶段 3 再换成各系统的惯例位置。 */
export function coopetDirs(root = join(homedir(), '.config', 'coopet')): CoopetDirs {
  const data = join(root, 'data');
  return {
    root,
    configFile: join(root, 'config.json'),
    data,
    figures: join(data, 'figures'),
    runtimes: join(data, 'runtimes'),
    models: join(data, 'models'),
  };
}

export function defaultLinkConfig(dirs: CoopetDirs): LinkConfig {
  return {
    url: 'ws://<NAS_IP>:18001/maim/<BOT_ID>/ws',
    tokenFile: join(dirs.root, 'token'),
    botAccount: 'coopet-maibot',
    userId: 'owner',
    userNickname: '主人',
  };
}

/** 本项目在桌宠默认值上的改动：阶段 1 关掉语音识别，免得去下载语音模型。 */
export const COOPET_PET_DEFAULTS: DeepPartial<DesktopPetConfigSection> = {
  asr: { enabled: false },
};

interface FileShape {
  link?: Partial<LinkConfig>;
  pet?: DeepPartial<DesktopPetConfigSection>;
}

export interface LoadedConfig {
  cfg: CoopetConfig;
  /** 桌宠的 `persist`：合并进 `cfg.pet`（原对象）和覆盖层，稍后写回文件。 */
  persistPet(patch: DeepPartial<DesktopPetConfigSection>): void;
  /** 立刻写出还没写的改动；退出前调用。 */
  flush(): void;
}

export interface LoadOptions {
  log?: Logger;
  /** 连续回写合并成一次写盘的等待时间，默认 300ms */
  debounceMs?: number;
}

/**
 * 读配置。文件不存在时用默认值，不创建文件；文件不是合法 JSON 时抛错，不覆盖它。
 */
export function loadConfig(dirs: CoopetDirs, opts: LoadOptions = {}): LoadedConfig {
  const file = readFile(dirs.configFile);
  const overrides: FileShape = { link: file.link ?? {}, pet: file.pet ?? {} };

  const pet = structuredClone(DESKTOP_PET_DEFAULTS);
  mergeInPlace(pet, COOPET_PET_DEFAULTS);
  mergeInPlace(pet, overrides.pet);
  const cfg: CoopetConfig = { link: { ...defaultLinkConfig(dirs), ...overrides.link }, pet };

  const debounceMs = opts.debounceMs ?? 300;
  let timer: NodeJS.Timeout | null = null;

  const write = (): void => {
    timer = null;
    try {
      writeAtomic(dirs.configFile, `${JSON.stringify(overrides, null, 2)}\n`);
    } catch (err) {
      opts.log?.warn(`配置没能写入 ${dirs.configFile}：${(err as Error).message}`);
    }
  };

  return {
    cfg,
    persistPet(patch) {
      mergeInPlace(cfg.pet, patch);
      overrides.pet = overrides.pet ?? {};
      mergeInPlace(overrides.pet, patch);
      if (timer) clearTimeout(timer);
      timer = setTimeout(write, debounceMs);
    },
    flush() {
      if (!timer) return;
      clearTimeout(timer);
      write();
    },
  };
}

function readFile(path: string): FileShape {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`配置文件 ${path} 不是合法的 JSON：${(err as Error).message}`);
  }
  if (!isPlainObject(parsed)) throw new Error(`配置文件 ${path} 的顶层必须是对象`);
  return parsed as FileShape;
}

/** 先写临时文件再改名，写到一半断电也不会留下损坏的配置。 */
function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

/**
 * 把 patch 合并进 target，在原对象上修改：对象逐层合并，数组和其他值整体替换；
 * patch 里值为 undefined 的键跳过。
 */
export function mergeInPlace(target: object, patch: unknown): void {
  if (!isPlainObject(patch)) return;
  const t = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = t[key];
    if (isPlainObject(value) && isPlainObject(current)) mergeInPlace(current, value);
    else t[key] = isPlainObject(value) || Array.isArray(value) ? structuredClone(value) : value;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
