/**
 * 配置的读取与回写。
 *
 * 文件 `~/.config/coopet/config.json` 只保存**改过的项**（覆盖层），不写入默认值，
 * 这样上游改了默认值也能生效。运行时的配置 = 默认值 ← 本项目的默认值 ← 文件覆盖层。
 *
 * `cfg.pet` 交给桌宠 World 后，桌宠每次用到配置时才读它，所以它必须一直是同一个对象：
 * 回写时在原对象上合并，不替换。
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DeepPartial } from 'cortico/world.ts';
import type { Logger, LogLevel } from 'cortico/core/types.ts';
import { DESKTOP_PET_DEFAULTS, type DesktopPetConfigSection } from 'cortico-world-desktop-pet';

/** 经 coopet-adapter 插件连接（协议 v0，docs/PROTOCOL.md）。身份和 Bot 名字由插件下发。 */
export interface PluginLinkConfig {
  /** 插件的 WS 地址，例如 `ws://<MaiBot 主机>:18100/ws` */
  url: string;
  /** 插件 token 文件的绝对路径 */
  tokenFile: string;
}

/** 经 maim_message 旧版 WS 连接（阶段 1 的临时通道，保留作备选）。 */
export interface MaimLinkConfig {
  /** 例如 `ws://<NAS 地址>:<WebUI 端口>/maim/<Bot ID>/ws` */
  url: string;
  /** maim_message token 文件的绝对路径 */
  tokenFile: string;
  /** 麦麦在 coopet 平台上的账号，须与 MaiBot 的 bot.platforms 一致 */
  botAccount: string;
  /** 使用者在 coopet 平台上的 user_id */
  userId: string;
  /** 麦麦怎么称呼使用者 */
  userNickname: string;
}

export type LinkKind = 'plugin' | 'maim';

export interface LinkConfig {
  /** 用哪种连接 */
  kind: LinkKind;
  plugin: PluginLinkConfig;
  maim: MaimLinkConfig;
}

export interface LogConfig {
  /** 最低记录级别；排查问题时改成 debug */
  level: LogLevel;
  /** 是否同时写到 `<root>/logs/coopet-YYYY-MM-DD.log`（保留 7 天） */
  file: boolean;
}

export interface CoopetConfig {
  /** 桌宠菜单、提示里显示的麦麦的名字（连上插件后以 MaiBot 设置里的为准） */
  botName: string;
  log: LogConfig;
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
  /** 日志文件 */
  logs: string;
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
    logs: join(root, 'logs'),
  };
}

/**
 * 默认值里不放任何个人信息：MaiBot 的地址、名字、你的昵称都写在本地的 config.json 里。
 * 两种连接的 url 都没有默认值，必须在配置里填。插件部署好之前默认用 maim。
 */
export function defaultLinkConfig(dirs: CoopetDirs): LinkConfig {
  return {
    kind: 'maim',
    plugin: { url: '', tokenFile: join(dirs.root, 'plugin-token') },
    maim: {
      url: '',
      tokenFile: join(dirs.root, 'token'),
      botAccount: 'coopet-maibot',
      userId: 'owner',
      userNickname: '主人',
    },
  };
}

/** 旧格式里直接写在 link 下的 maim 字段（阶段 1）。 */
const LEGACY_MAIM_KEYS = ['url', 'tokenFile', 'botAccount', 'userId', 'userNickname'] as const;

/** 把旧格式 `link.{url,…}` 挪进 `link.maim`；在原对象上修改。 */
export function migrateLinkSection(link: Record<string, unknown>): void {
  const moved: Record<string, unknown> = {};
  for (const key of LEGACY_MAIM_KEYS) {
    if (key in link) {
      moved[key] = link[key];
      delete link[key];
    }
  }
  if (Object.keys(moved).length === 0) return;
  const maim = isPlainObject(link.maim) ? link.maim : {};
  link.maim = { ...moved, ...maim };
}

/** 本机的设备 id：首次调用时生成并保存在 `<root>/device-id`，之后一直用同一个。 */
export function deviceId(dirs: CoopetDirs): string {
  const file = join(dirs.root, 'device-id');
  try {
    const saved = readFileSync(file, 'utf8').trim();
    if (saved) return saved;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const id = randomUUID();
  writeAtomic(file, `${id}\n`);
  return id;
}

/** 本项目在桌宠默认值上的改动：阶段 1 关掉语音识别，免得去下载语音模型。 */
export const COOPET_PET_DEFAULTS: DeepPartial<DesktopPetConfigSection> = {
  asr: { enabled: false },
};

interface FileShape {
  botName?: string;
  link?: Record<string, unknown>;
  pet?: DeepPartial<DesktopPetConfigSection>;
  /** 其他顶层字段原样保留，回写时不丢 */
  [key: string]: unknown;
}

/** 桌宠以外、可以在配置窗里改的部分。 */
export interface AppPatch {
  botName?: string;
  log?: Partial<LogConfig>;
  link?: DeepPartial<LinkConfig>;
}

export interface LoadedConfig {
  cfg: CoopetConfig;
  /** 桌宠的 `persist`：合并进 `cfg.pet`（原对象）和覆盖层，稍后写回文件。 */
  persistPet(patch: DeepPartial<DesktopPetConfigSection>): void;
  /**
   * 改桌宠以外的配置：先按同样的规则检查合并后的结果，不合格就抛错、什么都不改；
   * 合格才合并进 cfg 和覆盖层，稍后写回文件。连接和日志的改动要重启核心才生效。
   */
  persist(patch: AppPatch): void;
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
  // 覆盖层就是文件内容本身：回写时整个写回，文件里的其他字段不会丢
  const overrides: FileShape = { ...file, link: isPlainObject(file.link) ? file.link : {}, pet: file.pet ?? {} };
  migrateLinkSection(overrides.link!);

  const pet = structuredClone(DESKTOP_PET_DEFAULTS);
  mergeInPlace(pet, COOPET_PET_DEFAULTS);
  mergeInPlace(pet, overrides.pet);
  const cfg: CoopetConfig = {
    botName: typeof file.botName === 'string' && file.botName.trim() ? file.botName : 'MaiBot',
    log: logFrom(file.log),
    link: linkFrom(dirs, overrides.link!),
    pet,
  };

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

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(write, debounceMs);
  };

  return {
    cfg,
    persistPet(patch) {
      mergeInPlace(cfg.pet, patch);
      overrides.pet = overrides.pet ?? {};
      mergeInPlace(overrides.pet, patch);
      schedule();
    },
    persist(patch) {
      if (patch.botName !== undefined && (typeof patch.botName !== 'string' || !patch.botName.trim())) {
        throw new Error('botName 必须是非空字符串');
      }
      // 先在副本上合并、检查，不合格就不动原配置
      const nextLogRaw = structuredClone(isPlainObject(overrides.log) ? overrides.log : {});
      mergeInPlace(nextLogRaw, patch.log);
      const nextLinkRaw = structuredClone(overrides.link ?? {});
      mergeInPlace(nextLinkRaw, patch.link);
      const nextLog = logFrom(nextLogRaw);
      const nextLink = linkFrom(dirs, nextLinkRaw);

      if (patch.botName !== undefined) {
        overrides.botName = patch.botName;
        cfg.botName = patch.botName;
      }
      if (patch.log) overrides.log = nextLogRaw;
      if (patch.link) overrides.link = nextLinkRaw;
      cfg.log = nextLog;
      cfg.link = nextLink;
      schedule();
    },
    flush() {
      if (!timer) return;
      clearTimeout(timer);
      write();
    },
  };
}

const LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];

function logFrom(raw: unknown): LogConfig {
  const log: LogConfig = { level: 'info', file: true };
  mergeInPlace(log, raw);
  if (!LEVELS.includes(log.level)) throw new Error(`log.level 只能是 ${LEVELS.join('、')}，收到：${String(log.level)}`);
  if (typeof log.file !== 'boolean') throw new Error('log.file 必须是 true 或 false');
  return log;
}

function linkFrom(dirs: CoopetDirs, overrides: Record<string, unknown>): LinkConfig {
  const link = defaultLinkConfig(dirs);
  mergeInPlace(link, overrides);
  if (link.kind !== 'plugin' && link.kind !== 'maim') throw new Error(`link.kind 只能是 plugin 或 maim，收到：${String(link.kind)}`);
  return link;
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
