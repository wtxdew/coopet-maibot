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
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, posix, win32 } from 'node:path';
import type { DeepPartial } from 'cortico/world.ts';
import type { Logger, LogLevel } from 'cortico/core/types.ts';
import { isLanguage, systemLanguage, type Language } from 'cortico/core/language.ts';
import { DESKTOP_PET_DEFAULTS, type DesktopPetConfigSection } from 'cortico-world-desktop-pet';

/** 经 coopet-adapter 插件连接（协议 v0，https://github.com/wtxdew/maibot-coopet-adapter/blob/master/PROTOCOL.md）。身份和 Bot 名字由插件下发。 */
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

/**
 * 扩展 World 的通知怎么处理（Conductor 的路由，conductor/routing.ts），每个扩展一份：
 * - mode：认得的通知（Coopet 有专门说法的）送到哪：pet 桌宠说、maibot 交给麦麦、
 *   rule 按扩展在事件里带的分类去向（meta.route），off 全部不处理（只记进事件流）；
 * - unknown：认不得的通知：record 只记录、pet 桌宠念开头、maibot 交给麦麦；
 * - maxChars：桌宠最多念多少字。
 * 「交给麦麦」要等 World 扩展第二步（协议加 notice），在那之前先由桌宠说。
 */
export type RouteMode = 'pet' | 'maibot' | 'rule' | 'off';
export const ROUTE_MODES: readonly RouteMode[] = ['pet', 'maibot', 'rule', 'off'];
export type UnknownMode = 'record' | 'pet' | 'maibot';
export const UNKNOWN_MODES: readonly UnknownMode[] = ['record', 'pet', 'maibot'];
export interface RouteSettings { mode: RouteMode; unknown: UnknownMode; maxChars: number }
export const ROUTE_DEFAULTS: Readonly<RouteSettings> = { mode: 'pet', unknown: 'record', maxChars: 80 };
export const MAX_CHARS_RANGE = { min: 10, max: 500 } as const;

export interface CoopetConfig {
  /** 界面语言：设置窗、桌宠、托盘。没设置过时跟系统语言；MaiBot 用什么语言回复不受它影响 */
  language: Language;
  /** 桌宠菜单、提示里显示的麦麦的名字（连上插件后以 MaiBot 设置里的为准） */
  botName: string;
  log: LogConfig;
  link: LinkConfig;
  pet: DesktopPetConfigSection;
  /** 按 World id 的路由设置；没写的按 ROUTE_DEFAULTS */
  routes: Record<string, RouteSettings>;
  /** 自动更新（只有能自己装更新的版本用到，见 webui/update-settings.ts）；默认开 */
  update: UpdateConfig;
}

export interface UpdateConfig {
  auto: boolean;
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
  /** 事件记录（对话页的历史） */
  events: string;
}

/** 打包之前用的数据目录；第一次在新位置启动时从这里拷贝（migrateLegacyData） */
export const LEGACY_DATA_ROOT = join(homedir(), '.config', 'coopet');

/**
 * 数据目录：设了 COOPET_DATA_DIR 就用它；否则按各系统的惯例——
 * macOS `~/Library/Application Support/Coopet`，Windows `%APPDATA%\Coopet`，其他 `$XDG_CONFIG_HOME/coopet`（默认 ~/.config/coopet）。
 * 外壳的 paths.cjs 和 scripts/ext.mjs 各有一份同样的写法（coopet-app 的测试核对三处一致）。
 */
export function defaultDataRoot(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (env.COOPET_DATA_DIR) return env.COOPET_DATA_DIR;
  // 按目标系统的路径规则拼（Windows 用 \\），和在哪台机器上算无关
  const { join: j } = platform === 'win32' ? win32 : posix;
  if (platform === 'darwin') return j(home, 'Library', 'Application Support', 'Coopet');
  if (platform === 'win32') return j(env.APPDATA || j(home, 'AppData', 'Roaming'), 'Coopet');
  return j(env.XDG_CONFIG_HOME || j(home, '.config'), 'coopet');
}

/**
 * 第一次在新的数据目录启动时，把旧目录（~/.config/coopet）的内容拷贝过来：只拷贝、不移动、不删除。
 * 条件：两个目录不同、新目录还没有 config.json、旧目录有。不拷 electron/（Chromium 的配置，里面有套接字文件）
 * 和 data/webui/（每次启动重新生成）。返回拷没拷。
 */
export function migrateLegacyData(root: string, legacy = LEGACY_DATA_ROOT): boolean {
  if (root === legacy || existsSync(join(root, 'config.json')) || !existsSync(join(legacy, 'config.json'))) return false;
  const skip = new Set([join(legacy, 'electron'), join(legacy, 'data', 'webui')]);
  mkdirSync(root, { recursive: true });
  cpSync(legacy, root, { recursive: true, verbatimSymlinks: true, filter: (src) => !skip.has(src) });
  return true;
}

export function coopetDirs(root = defaultDataRoot()): CoopetDirs {
  const data = join(root, 'data');
  return {
    root,
    configFile: join(root, 'config.json'),
    data,
    figures: join(data, 'figures'),
    runtimes: join(data, 'runtimes'),
    models: join(data, 'models'),
    logs: join(root, 'logs'),
    events: join(root, 'events'),
  };
}

/**
 * 默认值里不放任何个人信息：MaiBot 的地址、名字、你的昵称都写在本地的 config.json 里。
 * 两种连接的 url 都没有默认值，必须在配置里填。默认用插件（maim_message 是旧版备选）。
 */
export function defaultLinkConfig(dirs: CoopetDirs): LinkConfig {
  return {
    kind: 'plugin',
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

/** 把旧格式 `link.{url,…}` 挪进 `link.maim`，并写明 kind 为 maim；在原对象上修改。 */
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
  // 旧格式只有 maim_message 一种连接；默认改成插件之后，它要明确写上 maim，才不会换成没填地址的插件
  if (!('kind' in link)) link.kind = 'maim';
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

/** 写 token 文件（权限 600，先写临时文件再改名）；首尾空白去掉，空的不接受。 */
export function writeToken(file: string, token: string): void {
  const value = token.trim();
  if (!value) throw new Error('token 不能为空');
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, value, { mode: 0o600 });
  renameSync(tmp, file);
}

/** token 文件存在且不是空的 */
export function tokenSet(file: string): boolean {
  try {
    return readFileSync(file, 'utf8').trim().length > 0;
  } catch {
    return false;
  }
}

/** 本项目在桌宠默认值上的改动：语音输入默认关着，要用的人在「语音输入」页自己打开、下载模型（约 230 MB）。 */
export const COOPET_PET_DEFAULTS: DeepPartial<DesktopPetConfigSection> = {
  asr: { enabled: false },
};

interface FileShape {
  language?: string;
  botName?: string;
  link?: Record<string, unknown>;
  pet?: DeepPartial<DesktopPetConfigSection>;
  /** 扩展 World 的配置覆盖层：worlds.<id>，只存改过的项 */
  worlds?: Record<string, Record<string, unknown>>;
  /** 其他顶层字段原样保留，回写时不丢 */
  [key: string]: unknown;
}

/** 桌宠以外、可以在配置窗里改的部分。 */
export interface AppPatch {
  language?: Language;
  routes?: Record<string, Partial<RouteSettings>>;
  botName?: string;
  log?: Partial<LogConfig>;
  link?: DeepPartial<LinkConfig>;
  update?: Partial<UpdateConfig>;
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
  /**
   * 扩展 World 的配置段：默认值 ← worlds.<id> 覆盖层。同一个 id 每次返回同一个活对象，
   * World 每次用到配置时读它（和桌宠的 cfg.pet 一样）。
   */
  worldSection<S extends object>(id: string, defaults: S): S;
  /** 合并进 worldSection(id) 的活对象和覆盖层，稍后写回文件（数组整体替换）。 */
  persistWorld(id: string, patch: Record<string, unknown>): void;
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
    language: isLanguage(file.language) ? file.language : systemLanguage(),
    routes: routesFrom(file.routes),
    botName: typeof file.botName === 'string' && file.botName.trim() ? file.botName : 'MaiBot',
    log: logFrom(file.log),
    link: linkFrom(dirs, overrides.link!),
    pet,
    update: updateFrom(file.update),
  };

  /** 扩展 World 的活配置对象，按 id */
  const sections = new Map<string, object>();
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
      for (const [id, route] of Object.entries(patch.routes ?? {})) checkRoute(id, route);
      if (patch.language !== undefined && !isLanguage(patch.language)) {
        throw new Error(`language 不是支持的语言：${String(patch.language)}`);
      }
      // 先在副本上合并、检查，不合格就不动原配置
      const nextLogRaw = structuredClone(isPlainObject(overrides.log) ? overrides.log : {});
      mergeInPlace(nextLogRaw, patch.log);
      const nextLinkRaw = structuredClone(overrides.link ?? {});
      mergeInPlace(nextLinkRaw, patch.link);
      const nextUpdateRaw = structuredClone(isPlainObject(overrides.update) ? overrides.update : {});
      mergeInPlace(nextUpdateRaw, patch.update);
      const nextLog = logFrom(nextLogRaw);
      const nextLink = linkFrom(dirs, nextLinkRaw);
      const nextUpdate = updateFrom(nextUpdateRaw);

      if (patch.botName !== undefined) {
        overrides.botName = patch.botName;
        cfg.botName = patch.botName;
      }
      if (patch.language !== undefined) {
        overrides.language = patch.language;
        cfg.language = patch.language;
      }
      if (patch.routes !== undefined) {
        const next = routesFrom(overrides.routes);
        for (const [id, route] of Object.entries(patch.routes)) next[id] = { ...(next[id] ?? ROUTE_DEFAULTS), ...route };
        overrides.routes = next;
        cfg.routes = next;
      }
      if (patch.log) overrides.log = nextLogRaw;
      if (patch.link) overrides.link = nextLinkRaw;
      if (patch.update) overrides.update = nextUpdateRaw;
      cfg.log = nextLog;
      cfg.link = nextLink;
      cfg.update = nextUpdate;
      schedule();
    },
    worldSection<S extends object>(id: string, defaults: S): S {
      const known = sections.get(id);
      if (known) return known as S;
      const section = structuredClone(defaults);
      const worlds = isPlainObject(overrides.worlds) ? overrides.worlds : {};
      mergeInPlace(section, worlds[id]);
      sections.set(id, section);
      return section;
    },
    persistWorld(id, patch) {
      const section = sections.get(id);
      if (section) mergeInPlace(section, patch);
      if (!isPlainObject(overrides.worlds)) overrides.worlds = {};
      const worlds = overrides.worlds as Record<string, Record<string, unknown>>;
      if (!isPlainObject(worlds[id])) worlds[id] = {};
      mergeInPlace(worlds[id], patch);
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

/**
 * 文件里的 routes。不合格的项换成默认值。旧版只有 mode（auto / pet / off）：
 * auto → 桌宠说、认不得的只记录；pet（当时的意思是全部让桌宠说）→ 桌宠说、认不得的念开头。
 */
function routesFrom(raw: unknown): Record<string, RouteSettings> {
  const out: Record<string, RouteSettings> = {};
  if (!isPlainObject(raw)) return out;
  for (const [id, route] of Object.entries(raw)) {
    if (!isPlainObject(route)) continue;
    const legacy = !('unknown' in route) && !('maxChars' in route);
    const mode = route.mode === 'auto' ? 'pet' : route.mode;
    const unknown = legacy ? (route.mode === 'pet' ? 'pet' : 'record') : route.unknown;
    const maxChars = route.maxChars;
    out[id] = {
      mode: ROUTE_MODES.includes(mode as RouteMode) ? mode as RouteMode : ROUTE_DEFAULTS.mode,
      unknown: UNKNOWN_MODES.includes(unknown as UnknownMode) ? unknown as UnknownMode : ROUTE_DEFAULTS.unknown,
      maxChars: validMaxChars(maxChars) ? maxChars : ROUTE_DEFAULTS.maxChars,
    };
  }
  return out;
}

function validMaxChars(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= MAX_CHARS_RANGE.min && (n as number) <= MAX_CHARS_RANGE.max;
}

function checkRoute(id: string, route: Partial<RouteSettings> | undefined): void {
  if (!route) return;
  if (route.mode !== undefined && !ROUTE_MODES.includes(route.mode)) throw new Error(`routes.${id}.mode 只能是 ${ROUTE_MODES.join('、')}，收到：${String(route.mode)}`);
  if (route.unknown !== undefined && !UNKNOWN_MODES.includes(route.unknown)) throw new Error(`routes.${id}.unknown 只能是 ${UNKNOWN_MODES.join('、')}，收到：${String(route.unknown)}`);
  if (route.maxChars !== undefined && !validMaxChars(route.maxChars)) throw new Error(`routes.${id}.maxChars 要是 ${MAX_CHARS_RANGE.min}–${MAX_CHARS_RANGE.max} 的整数，收到：${String(route.maxChars)}`);
}

function logFrom(raw: unknown): LogConfig {
  const log: LogConfig = { level: 'info', file: true };
  mergeInPlace(log, raw);
  if (!LEVELS.includes(log.level)) throw new Error(`log.level 只能是 ${LEVELS.join('、')}，收到：${String(log.level)}`);
  if (typeof log.file !== 'boolean') throw new Error('log.file 必须是 true 或 false');
  return log;
}

function updateFrom(raw: unknown): UpdateConfig {
  const update: UpdateConfig = { auto: true };
  mergeInPlace(update, raw);
  if (typeof update.auto !== 'boolean') throw new Error('update.auto 必须是 true 或 false');
  return update;
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
