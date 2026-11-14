/**
 * 设置窗的后端：把 Coopet 的状态、桌宠配置、页面交给 Cortico 的 WebApp（vendor/cortico/src/web/server.ts），
 * 由它按 Cortico WebUI 的格式提供接口。设置窗是 Coopanion 的前端（console/），本来就讲这套接口。
 *
 * 这里给的（其余 WebApp 功能不给，相应接口回 503 加说明）：
 * - getStatus：`/api/status`。页面读 displayName（侧边栏的名字）、loop.paused（侧边栏的运行键）；
 *   另加 Coopet 自己的 link（MaiBot 连接：方式、状态、关闭原因、Bot 名字、两种 token 有没有设置）
 *   和 pet（桌宠是否在桌面上），连接卡用；运行诊断另读 version、startedAt、runId、events、log、conversation（对话统计）。
 * - config：`/api/config`。桌宠的配置说明书（desktopPetConfigGroups），只去掉语音识别和电脑操作两组；
 *   哪些项显示由页面自己决定（Coopanion 的「习惯」页只发它显示的键）。写入前 WebApp 已用 coerceGroupValues
 *   检查过类型和范围，这里写回 config.json 后 refresh，标了 x-hot 的项马上生效。
 * - config 里另有 `companion` 组，只有 `language`（界面语言）：组名和键是 Coopanion「习惯」页写死的；
 *   选项来自 `/api/config/options/coopanion.language`（Cortico 的语言名表）。改了之后桌宠刷新，并经 onLanguage 告诉外壳。
 * - config 里还有 `coopet.link` 组（连接 MaiBot，见 link-settings.ts）：写完后经 applyLink 换上新连接，不重启。
 * - config 里还有 `coopet.log` 组（日志级别、写不写文本日志，见 log-settings.ts），「运行诊断 → 配置」用。
 * - debug（调试通道 /ws/debug）：只给本次运行 id（运行日志页默认读它）、新日志和新事件的推送；
 *   模型会话相关的几项给空（Coopet 没有模型会话）。
 * - worlds：`/api/worlds`，桌宠加上扩展 World（extension-worlds.ts）；worldActivation 接 World 列表的启用开关
 *   （桌宠不能停用）。扩展 World 的页面、配置组也一并交给 WebApp。
 * - webUiPageSources：页面清单里桌宠的那一页，用 Cortico 自己的 ioPageContribution 生成；
 *   面板调用（`/api/webui/providers/...`）和数据流（`/ws/providers/...`，对话页）都经它转给桌宠。
 *   去掉 promptDocs：那是给模型看的环境说明，MaiBot 不用，页面也就不显示「提示词」标签；
 *   去掉「语音输入」面板（语音识别还没接）。
 * - botDir：配色（theme.json）和头像（avatar.png）存放的目录，即 ~/.config/coopet。
 * - webDistDir：面板脚本所在目录（见 assets.ts）。
 */

import { join } from 'node:path';
import type { ConfigGroup, ConfigValues } from 'cortico/core/config-schema.ts';
import { baseLanguage, LANGUAGE_NAMES, LANGUAGES, type Language } from 'cortico/core/language.ts';
import type { EventEnvelope, EventStoreReader, Logger, LogRecord, World } from 'cortico/core/types.ts';
import type { DeepPartial } from 'cortico/world.ts';
import type { WebAppDeps, WebUiWorldInfo } from 'cortico/web/server.ts';
import type { WebUiPageSource } from 'cortico/web/webui-pages.ts';
import { ioPageContribution } from 'cortico/bot.ts';
import { desktopPetConfigGroups, type DesktopPetConfigSection } from 'cortico-world-desktop-pet';
import type { AppPatch, CoopetConfig, CoopetDirs } from '../runtime/config.ts';
import type { PetHandle } from '../runtime/pet.ts';
import type { LinkState } from '../link/types.ts';
import { LINK_GROUP, linkGroup, linkTokens, linkValues, saveLinkValues } from './link-settings.ts';
import { LOG_GROUP, logGroup, logValues, saveLogValues } from './log-settings.ts';
import { AUTO_UPDATE_KEY, autoUpdateProperties, saveUpdateValues, updateValues } from './update-settings.ts';
import type { ConversationStats } from '../conductor/stats.ts';
import type { extensionWorlds } from './extension-worlds.ts';
import { ROUTE_PREFIX, routeGroup, routeOptions, routeValues, saveRoute } from './route-settings.ts';

export const PET_WORLD_ID = 'desktop-pet';
/** 说明书里键的前缀：`worlds.desktop-pet.window.scale` → cfg.pet.window.scale */
const PET_PREFIX = `worlds.${PET_WORLD_ID}.`;
/** 不交给设置窗的组：电脑操作（阶段 5，有风险，默认关闭） */
const HIDDEN_GROUP_SUFFIXES = [':cua'];

export interface SurfaceDeps {
  /** 活的配置对象 */
  cfg: CoopetConfig;
  persist(patch: AppPatch): void;
  persistPet(patch: DeepPartial<DesktopPetConfigSection>): void;
  /** 界面语言改了（已保存、桌宠已刷新）：告诉外壳 */
  onLanguage?(language: Language): void;
  /** 「自动更新」改了（已保存）：告诉外壳 */
  onAutoUpdate?(enabled: boolean): void;
  pet: Pick<PetHandle, 'webUi' | 'toolNames' | 'refresh' | 'onDesktop' | 'origin'>;
  store: EventStoreReader & { subscribe(cb: (e: EventEnvelope) => void): void };
  /** 本次运行的结构化日志（runtime/runlog.ts） */
  runlog: { readonly runId: string; onWrite(cb: (record: LogRecord) => void): void };
  version: string;
  /** 核心启动时刻（ISO） */
  startedAt: string;
  /** 对话统计（Conductor.stats）；Conductor 还没建好时为 null */
  conversation(): ConversationStats | null;
  dirs: CoopetDirs;
  log: Logger;
  botName(): string;
  /** 当前连接：方式、状态、最近一次关闭的原因（'auth'、关闭码…）、Bot 名字 */
  link(): { kind: string; state: LinkState; reason?: string; botName?: string; since?: string };
  /** 按 cfg.link 换上新连接（连接设置保存后调用） */
  applyLink(): Promise<void>;
  /** 面板脚本目录（assets.ts 准备的） */
  webDistDir: string;
  /** 扩展 World（extension-worlds.ts）；没有时只有桌宠 */
  extensions?: ReturnType<typeof extensionWorlds>;
  /** 扩展 World 的启用、停用、重启（runtime/worlds.ts） */
  activation?: { set(id: string, enabled: boolean): Promise<string>; restart(id: string): Promise<string> };
}

/** Coopanion「习惯」页读写界面语言的组和键、选项来源 */
export const LANGUAGE_GROUP = 'companion';
const LANGUAGE_KEY = 'language';
const LANGUAGE_OPTIONS = 'coopanion.language';

function languageGroup(language: Language): ConfigGroup {
  const zh = baseLanguage(language) === 'zh';
  return {
    id: LANGUAGE_GROUP,
    owner: 'core',
    schema: {
      type: 'object',
      title: zh ? '通用' : 'General',
      properties: {
        [LANGUAGE_KEY]: { type: 'string', title: zh ? '语言' : 'Language', enum: [...LANGUAGES], 'x-options': LANGUAGE_OPTIONS, 'x-hot': true },
        ...autoUpdateProperties(language),
      },
    },
  };
}

/** 交给设置窗的桌宠配置组 */
export function petConfigGroups(language: Language): ConfigGroup[] {
  return desktopPetConfigGroups(language).filter((g) => !HIDDEN_GROUP_SUFFIXES.some((s) => g.id.endsWith(s)));
}

export function createSurface(d: SurfaceDeps): WebAppDeps {
  const groupValues = (group: ConfigGroup): ConfigValues => {
    const values: ConfigValues = {};
    for (const key of Object.keys(group.schema.properties)) {
      if (key.startsWith(PET_PREFIX)) values[key] = getPath(d.cfg.pet, key.slice(PET_PREFIX.length)) as ConfigValues[string];
    }
    return values;
  };

  /**
   * 桌宠的页面声明，只留桌宠窗口和语音识别两盏状态灯：灯没有 id，桌宠按固定顺序给（窗口、语音识别、开了电脑操作时还有一盏），
   * 电脑操作没接，不显示。
   */
  const petDecl = (language: Language) => {
    const decl = d.pet.webUi(language);
    return decl.lamps?.length ? { ...decl, lamps: decl.lamps.slice(0, 2) } : decl;
  };

  const worldInfo = (language: Language): WebUiWorldInfo => {
    const decl = petDecl(language);
    return {
      id: PET_WORLD_ID,
      status: 'active',
      label: decl.label ?? '桌宠',
      declared: true,
      visible: true,
      envPrompt: '',
      workspace: `worlds/${PET_WORLD_ID}`,
      tools: d.pet.toolNames(),
      ...(decl.lamps?.length ? { lamps: decl.lamps } : {}),
      ...(decl.badges ? { badges: decl.badges } : {}),
      ...(decl.links ? { links: decl.links } : {}),
    };
  };

  const petPage: WebUiPageSource = {
    id: `world:${PET_WORLD_ID}`,
    contribute(language) {
      const info = worldInfo(language);
      if (info.status !== 'active') return null;
      // ioPageContribution 只用到 World 的 webUi()
      const world = { webUi: (lang?: Language) => petDecl(lang ?? language) } as unknown as World;
      const page = ioPageContribution(PET_WORLD_ID, info.label ?? PET_WORLD_ID, { ...info, prefixDrifted: false }, world, language);
      delete page.promptDocs;
      return page;
    },
  };

  return {
    store: d.store,
    dataDir: d.dirs.data,
    memoryDir: join(d.dirs.data, 'workspace'),
    botDir: d.dirs.root,
    language: 'zh',
    webDistDir: d.webDistDir,
    log: d.log,
    getStatus: () => ({
      displayName: d.botName(),
      version: d.version,
      startedAt: d.startedAt,
      runId: d.runlog.runId,
      loop: { paused: false },
      link: { ...d.link(), tokenSet: linkTokens(d.cfg) },
      pet: { onDesktop: d.pet.onDesktop(), url: d.pet.origin },
      events: { latest: d.store.latestCursor(), dir: d.dirs.events },
      log: { level: d.cfg.log.level, file: d.cfg.log.file, dir: d.dirs.logs },
      conversation: d.conversation(),
    }),
    debug: {
      runId: () => d.runlog.runId,
      onRunlog: (cb) => d.runlog.onWrite(cb),
      onEvent: (cb) => d.store.subscribe(cb),
      sessionMessages: () => [],
      onSessionAppend: () => {},
      onSessionReset: () => {},
      toolSchemas: () => [],
    },
    config: {
      groups: (language) => [
        { group: languageGroup(language), values: { [LANGUAGE_KEY]: d.cfg.language, ...updateValues(d.cfg) } },
        { group: linkGroup(language), values: linkValues(d.cfg) },
        { group: logGroup(language), values: logValues(d.cfg) },
        ...petConfigGroups(language).map((group) => ({ group, values: groupValues(group) })),
        ...(d.extensions?.configGroups(language) ?? []),
        ...(d.extensions?.runningIds() ?? []).map((id) => ({ group: routeGroup(id, language), values: routeValues(d.cfg, id) })),
      ],
      set: (groupId, values, language) => {
        if (groupId === LOG_GROUP) {
          if (!saveLogValues(values, d)) return baseLanguage(language) === 'zh' ? '没有改动' : 'No change';
          d.log.info(`设置窗改了日志设置：级别 ${d.cfg.log.level}，${d.cfg.log.file ? '写' : '不写'}文本日志`);
          return baseLanguage(language) === 'zh' ? '已保存' : 'Saved';
        }
        if (groupId === LINK_GROUP) {
          if (!saveLinkValues(values, d, language)) return baseLanguage(language) === 'zh' ? '没有改动' : 'No change';
          d.log.info(`设置窗改了连接设置（${d.cfg.link.kind}），换上新连接`);
          void d.applyLink().catch((err: unknown) => d.log.error(`换连接失败：${String(err)}`));
          return baseLanguage(language) === 'zh' ? '已保存，正在连接' : 'Saved, connecting';
        }
        if (groupId === LANGUAGE_GROUP && AUTO_UPDATE_KEY in values) {
          if (!saveUpdateValues(values, d)) return baseLanguage(language) === 'zh' ? '没有改动' : 'No change';
          d.log.info(`设置窗${d.cfg.update.auto ? '打开' : '关掉'}了自动更新`);
          d.onAutoUpdate?.(d.cfg.update.auto);
          return baseLanguage(language) === 'zh' ? '已保存' : 'Saved';
        }
        if (groupId === LANGUAGE_GROUP) {
          const next = values[LANGUAGE_KEY] as Language | undefined;
          if (!next || next === d.cfg.language) return '没有改动';
          d.persist({ language: next });
          d.pet.refresh();
          d.log.info(`界面语言改成 ${next}`);
          d.onLanguage?.(next);
          return baseLanguage(next) === 'zh' ? '已保存' : 'Saved';
        }
        if (groupId.startsWith(ROUTE_PREFIX)) {
          const worldId = groupId.slice(ROUTE_PREFIX.length);
          if (!d.extensions?.runningIds().includes(worldId)) throw new Error(`没有这个 World：${worldId}`);
          if (!saveRoute(worldId, values, d)) return baseLanguage(language) === 'zh' ? '没有改动' : 'No change';
          const r = d.cfg.routes[worldId];
          d.log.info(`设置窗改了 ${worldId} 的通知处理：${r?.mode}，认不得的 ${r?.unknown}，最多 ${r?.maxChars} 字`);
          return baseLanguage(language) === 'zh' ? '已保存' : 'Saved';
        }
        const fromExtension = d.extensions?.setConfig(groupId, values, language);
        if (fromExtension != null) {
          d.log.info(`设置窗改了 World 设置（${groupId}）：${Object.keys(values).join('、')}`);
          return fromExtension;
        }
        const group = petConfigGroups(language).find((g) => g.id === groupId);
        if (!group) throw new Error(`没有这个配置组：${groupId}`);
        const patch: Record<string, unknown> = {};
        let hot = true;
        for (const [key, value] of Object.entries(values)) {
          if (!key.startsWith(PET_PREFIX)) throw new Error(`不是桌宠的设置：${key}`);
          setPath(patch, key.slice(PET_PREFIX.length), value);
          if (group.schema.properties[key]?.['x-hot'] !== true) hot = false;
        }
        if (Object.keys(patch).length === 0) return '没有改动';
        d.persistPet(patch as DeepPartial<DesktopPetConfigSection>);
        d.pet.refresh();
        d.log.info(`设置窗改了桌宠设置：${Object.keys(values).join('、')}`);
        return hot ? '已保存' : '已保存，部分设置要重启 Coopet 后生效';
      },
      options: (kind, language) => (kind === LANGUAGE_OPTIONS
        ? LANGUAGES.map((value) => ({ value, label: LANGUAGE_NAMES[value] }))
        : routeOptions(kind, language) ?? d.extensions?.options(kind, language) ?? []),
    },
    worlds: (language) => [worldInfo(language), ...(d.extensions?.infos(language) ?? [])],
    webUiPageSources: () => [petPage, ...(d.extensions?.pages() ?? [])],
    ...(d.activation ? {
      worldActivation: {
        set: async (id, enabled) => {
          if (id === PET_WORLD_ID) throw new Error('桌宠是 Coopet 本身，不能停用');
          const result = await d.activation!.set(id, enabled);
          d.log.info(`设置窗${enabled ? '启用' : '停用'}了 World：${id}`);
          return result;
        },
        restart: async (id) => {
          if (id === PET_WORLD_ID) throw new Error('桌宠不能在这里重启，请重启 Coopet');
          return d.activation!.restart(id);
        },
      },
    } : {}),
  };
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (typeof o[k] !== 'object' || o[k] === null) o[k] = {};
    o = o[k] as Record<string, unknown>;
  }
  o[keys[keys.length - 1]] = value;
}
