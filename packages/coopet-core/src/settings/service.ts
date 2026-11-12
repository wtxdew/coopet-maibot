/**
 * 配置窗背后的服务（在核心里运行，外壳经 IPC 转发请求过来）。
 *
 * - get：当前设置。桌宠以外的部分手写；桌宠的部分按它自带的配置说明书（desktopPetConfigGroups）给出，
 *   配置窗据此生成表单。token 只告诉有没有设置，不传出去。
 * - save：先检查（类型、范围、选项），再保存。桌宠里标了 x-hot 的项改配置对象后 refresh，马上生效；
 *   其余的、连接和日志要重启核心，结果里 restartNeeded 为 true。
 * - saveToken：写 token 文件（权限 600）。
 * - testConnection：用给的地址和 token 临时连一次，报告成败、握手耗时和 Bot 名字。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ConfigGroup, ConfigProperty } from 'cortico/core/config-schema.ts';
import type { DeepPartial } from 'cortico/world.ts';
import type { Logger } from 'cortico/core/types.ts';
import { desktopPetConfigGroups, type DesktopPetConfigSection } from 'cortico-world-desktop-pet';
import type { AppPatch, CoopetConfig, LinkKind } from '../runtime/config.ts';
import type { Link, LinkState } from '../link/types.ts';

/** 说明书里键的前缀：`worlds.desktop-pet.window.scale` → cfg.pet.window.scale */
const PET_PREFIX = 'worlds.desktop-pet.';

/** 在配置窗里隐藏的桌宠设置：改了容易出问题、我们用不到，或功能还没接（语音识别）。 */
const HIDDEN_PET_KEYS = new Set(['port', 'window.enabled', 'window.electronFile', 'window.exportOverlay', 'user']);
const HIDDEN_PET_GROUP_SUFFIXES = [':asr'];

export interface WorldSettings {
  id: string;
  label: string;
  /** 能否在配置窗里停用；桌宠是客户端本身，不能停用 */
  canDisable: boolean;
  enabled: boolean;
  groups: ConfigGroup[];
  /** 说明书里每个键的当前值 */
  values: Record<string, unknown>;
}

export interface SettingsSnapshot {
  app: {
    botName: string;
    log: CoopetConfig['log'];
    link: {
      kind: LinkKind;
      plugin: { url: string; tokenSet: boolean };
      maim: { url: string; tokenSet: boolean; botAccount: string; userId: string; userNickname: string };
    };
  };
  worlds: WorldSettings[];
}

export interface SavePatch {
  app?: AppPatch;
  /** worldId → { 说明书里的键: 新值 } */
  worlds?: Record<string, Record<string, unknown>>;
}

export interface SaveResult {
  restartNeeded: boolean;
}

export interface TestRequest {
  kind: LinkKind;
  url: string;
  /** 不给时用已保存的 token 文件 */
  token?: string;
}

export interface TestResult {
  ok: boolean;
  ms: number;
  botName?: string;
  reason?: string;
}

export interface SettingsDeps {
  cfg: CoopetConfig;
  persist(patch: AppPatch): void;
  persistPet(patch: DeepPartial<DesktopPetConfigSection>): void;
  pet: { refresh(): void };
  log: Logger;
  /** 按请求造一个临时连接（测试连接用） */
  makeTestLink(req: TestRequest & { tokenFile: string }): Link;
  /** 测试连接的超时，默认 8 秒 */
  testTimeoutMs?: number;
}

export class SettingsService {
  constructor(private readonly deps: SettingsDeps) {}

  /** 配置窗里显示的桌宠说明书：去掉隐藏的组和键。 */
  petGroups(): ConfigGroup[] {
    return desktopPetConfigGroups('zh')
      .filter((g) => !HIDDEN_PET_GROUP_SUFFIXES.some((s) => g.id.endsWith(s)))
      .map((g) => ({
        ...g,
        schema: {
          ...g.schema,
          properties: Object.fromEntries(Object.entries(g.schema.properties)
            .filter(([key, prop]) => key.startsWith(PET_PREFIX) && !HIDDEN_PET_KEYS.has(key.slice(PET_PREFIX.length)) && editable(prop))),
        },
      }))
      .filter((g) => Object.keys(g.schema.properties).length > 0);
  }

  get(): SettingsSnapshot {
    const { cfg } = this.deps;
    const groups = this.petGroups();
    const values: Record<string, unknown> = {};
    for (const g of groups) {
      for (const key of Object.keys(g.schema.properties)) values[key] = getPath(cfg.pet, key.slice(PET_PREFIX.length));
    }
    return {
      app: {
        botName: cfg.botName,
        log: { ...cfg.log },
        link: {
          kind: cfg.link.kind,
          plugin: { url: cfg.link.plugin.url, tokenSet: tokenSet(cfg.link.plugin.tokenFile) },
          maim: {
            url: cfg.link.maim.url,
            tokenSet: tokenSet(cfg.link.maim.tokenFile),
            botAccount: cfg.link.maim.botAccount,
            userId: cfg.link.maim.userId,
            userNickname: cfg.link.maim.userNickname,
          },
        },
      },
      worlds: [{ id: 'desktop-pet', label: '桌宠', canDisable: false, enabled: true, groups, values }],
    };
  }

  /** 全部检查通过才保存；任何一项不合格就抛错，什么都不改。 */
  save(patch: SavePatch): SaveResult {
    let restartNeeded = false;
    let petPatch: DeepPartial<DesktopPetConfigSection> | null = null;
    let petHot = true;

    for (const [worldId, values] of Object.entries(patch.worlds ?? {})) {
      if (worldId !== 'desktop-pet') throw new Error(`没有这个 World：${worldId}`);
      const props = new Map(this.petGroups().flatMap((g) => Object.entries(g.schema.properties)));
      petPatch = {};
      for (const [key, value] of Object.entries(values)) {
        const prop = props.get(key);
        if (!prop) throw new Error(`桌宠没有可以修改的设置：${key}`);
        checkValue(key, prop, value);
        setPath(petPatch as Record<string, unknown>, key.slice(PET_PREFIX.length), value);
        if (prop['x-hot'] !== true) petHot = false;
      }
    }

    // 先检查、后写：app 部分由 persist 自己检查，不合格会抛错，此时桌宠部分也还没写
    if (patch.app) {
      this.deps.persist(patch.app);
      if (patch.app.link !== undefined || patch.app.log !== undefined) restartNeeded = true;
    }
    if (petPatch && Object.keys(petPatch).length > 0) {
      this.deps.persistPet(petPatch);
      this.deps.pet.refresh();
      if (!petHot) restartNeeded = true;
    }
    return { restartNeeded };
  }

  /** 写 token 文件；空 token 不接受。 */
  saveToken(kind: LinkKind, token: string): SaveResult {
    const value = token.trim();
    if (!value) throw new Error('token 不能为空');
    const file = kind === 'plugin' ? this.deps.cfg.link.plugin.tokenFile : this.deps.cfg.link.maim.tokenFile;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, value, { mode: 0o600 });
    renameSync(tmp, file);
    this.deps.log.info(`已保存 ${kind === 'plugin' ? '插件' : 'maim_message'} 的 token`);
    return { restartNeeded: true };
  }

  /** 临时连一次；不影响正在用的连接。 */
  async testConnection(req: TestRequest): Promise<TestResult> {
    if (!req.url.trim()) return { ok: false, ms: 0, reason: '地址是空的' };
    const tokenFile = req.kind === 'plugin' ? this.deps.cfg.link.plugin.tokenFile : this.deps.cfg.link.maim.tokenFile;
    const link = this.deps.makeTestLink({ ...req, tokenFile });
    const started = Date.now();
    const timeoutMs = this.deps.testTimeoutMs ?? 8000;
    const outcome = await new Promise<{ state: LinkState; reason?: string }>((resolve) => {
      const timer = setTimeout(() => resolve({ state: 'closed', reason: `${timeoutMs / 1000} 秒内没连上` }), timeoutMs);
      link.onState((state, reason) => {
        // 一打开就算成功；任何一次关闭都算失败（不等它自己重连）
        if (state === 'open' || state === 'closed') {
          clearTimeout(timer);
          resolve({ state, ...(reason ? { reason } : {}) });
        }
      });
      link.start();
    });
    const ms = Date.now() - started;
    const botName = link.botName?.();
    await link.stop();
    if (outcome.state === 'open') return { ok: true, ms, ...(botName ? { botName } : {}) };
    return { ok: false, ms, reason: describeReason(outcome.reason) };
  }
}

/** 配置窗能编辑的类型；数组、对象和动态选项先不支持。 */
function editable(prop: ConfigProperty): boolean {
  return ['boolean', 'number', 'integer', 'string'].includes(prop.type) && !prop['x-options'];
}

function checkValue(key: string, prop: ConfigProperty, value: unknown): void {
  if (value === null && prop.nullable) return;
  const fail = (why: string) => { throw new Error(`${prop.title}（${key}）${why}`); };
  switch (prop.type) {
    case 'boolean':
      if (typeof value !== 'boolean') fail('必须是开或关');
      return;
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('必须是数字');
      const n = value as number;
      if (prop.type === 'integer' && !Number.isInteger(n)) fail('必须是整数');
      if (prop.minimum !== undefined && n < prop.minimum) fail(`不能小于 ${prop.minimum}`);
      if (prop.maximum !== undefined && n > prop.maximum) fail(`不能大于 ${prop.maximum}`);
      return;
    }
    case 'string':
      if (typeof value !== 'string') fail('必须是文字');
      if (prop.enum && !prop.enum.includes(value as string)) fail(`只能是 ${prop.enum.join('、')} 之一`);
      return;
    default:
      fail('不能在这里修改');
  }
}

function describeReason(reason: string | undefined): string {
  switch (reason) {
    case 'auth': return 'token 不对';
    case 'token': return '没有 token';
    case 'protocol': return '协议版本不一致';
    case 'replaced': return '被另一台设备顶替';
    default: return reason && /^\d+$/.test(reason) ? `连不上（关闭码 ${reason}）` : reason ?? '没连上';
  }
}

function tokenSet(file: string): boolean {
  try {
    return readFileSync(file, 'utf8').trim().length > 0;
  } catch {
    return false;
  }
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
