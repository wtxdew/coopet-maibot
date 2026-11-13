/**
 * 设置窗里的扩展 World（runtime/worlds.ts 托管的那些）：World 列表的条目、页面清单里的页、配置组。
 * 桌宠不在这里（surface.ts 单独处理）。
 *
 * - 列表：运行中的是 active（带状态灯、徽标、链接、工具名）；启用了但没能启动、或没启用的是 inactive（带原因）；
 *   扩展包没能加载的是 missing（带加载器给的原因）。
 * - 页面：每个运行中的 World 一页，用 Cortico 的 ioPageContribution 生成（面板调用、数据流都转给它）；
 *   去掉 promptDocs（给模型看的，Coopet 没有模型）。extraConfig 给的配置组（Coopet 的路由设置）追加进这一页的配置标签。
 * - 配置组：运行中的 World 在页面声明里给的组（键是 `worlds.<id>.…`），值从它的活配置读，写入走 persistWorld。
 */

import type { ConfigGroup, ConfigValues } from 'cortico/core/config-schema.ts';
import type { Language } from 'cortico/core/language.ts';
import type { World } from 'cortico/core/types.ts';
import type { ExtensionRecord } from 'cortico/extensions.ts';
import type { WebUiWorldInfo } from 'cortico/web/server.ts';
import type { WebUiPageSource } from 'cortico/web/webui-pages.ts';
import type { WorldSection } from 'cortico/world.ts';
import { ioPageContribution } from 'cortico/bot.ts';
import type { WorldSlotInfo } from '../runtime/worlds.ts';

export interface ExtensionWorldsDeps {
  runtime: {
    list(): WorldSlotInfo[];
    instance(id: string): World | null;
    section(id: string): WorldSection | undefined;
    configOptions(kind: string, language: Language): Array<{ value: string; label: string }>;
  };
  persistWorld(id: string, patch: Record<string, unknown>): void;
  /** 加载器的结果；没能加载的 World 扩展列成 missing */
  records: readonly ExtensionRecord[];
  /** 追加进某个 World 页配置标签的组（Coopet 的路由设置）；组本身也要出现在 /api/config 里 */
  extraConfig?(worldId: string, language: Language): ConfigGroup[];
}

const prefixOf = (id: string) => `worlds.${id}.`;

export function extensionWorlds(d: ExtensionWorldsDeps) {
  const declOf = (id: string, language: Language) => {
    try {
      return d.runtime.instance(id)?.webUi?.(language) ?? null;
    } catch {
      return null;
    }
  };

  const infos = (language: Language): WebUiWorldInfo[] => {
    const slots = d.runtime.list().map((slot): WebUiWorldInfo => {
      const decl = slot.running ? declOf(slot.id, language) : null;
      const label = decl?.label ?? slot.label;
      if (!slot.running) {
        return { id: slot.id, status: 'inactive', label, declared: false, ...(slot.failure ? { reason: slot.failure } : {}) };
      }
      return {
        id: slot.id,
        status: 'active',
        label,
        declared: false,
        visible: true,
        envPrompt: '',
        workspace: `worlds/${slot.id}`,
        tools: (d.runtime.instance(slot.id)?.tools() ?? []).map((t) => t.name),
        ...(decl?.lamps?.length ? { lamps: decl.lamps } : {}),
        ...(decl?.badges ? { badges: decl.badges } : {}),
        ...(decl?.links ? { links: decl.links } : {}),
      };
    });
    const missing = d.records
      .filter((r) => (r.kind === 'world' || r.kind === undefined) && !r.loaded)
      .map((r): WebUiWorldInfo => ({
        id: r.worldId ?? r.name,
        status: 'missing',
        label: r.label ?? r.name,
        declared: false,
        reason: r.reason?.(language) ?? '',
      }));
    return [...slots, ...missing];
  };

  const pages = (): WebUiPageSource[] => d.runtime.list().filter((s) => s.running).map((slot) => ({
    id: `world:${slot.id}`,
    contribute(language) {
      const world = d.runtime.instance(slot.id);
      if (!world) return null;
      const info = infos(language).find((i) => i.id === slot.id);
      const page = ioPageContribution(slot.id, slot.label, info && info.status === 'active' ? { ...info, prefixDrifted: false } : undefined, world, language);
      delete page.promptDocs;
      const extra = d.extraConfig?.(slot.id, language) ?? [];
      if (extra.length) page.config = [...(page.config ?? []), ...extra];
      return page;
    },
  }));

  /** 运行中的 World 在页面声明里给的配置组 */
  const groups = (language: Language): ConfigGroup[] => d.runtime.list()
    .filter((s) => s.running)
    .flatMap((s) => (declOf(s.id, language)?.config ?? []) as ConfigGroup[]);

  const configGroups = (language: Language): Array<{ group: ConfigGroup; values: ConfigValues }> => d.runtime.list()
    .filter((s) => s.running)
    .flatMap((s) => {
      const section = d.runtime.section(s.id) ?? {};
      const prefix = prefixOf(s.id);
      return ((declOf(s.id, language)?.config ?? []) as ConfigGroup[]).map((group) => {
        const values: ConfigValues = {};
        for (const key of Object.keys(group.schema.properties)) {
          if (key.startsWith(prefix)) values[key] = getPath(section, key.slice(prefix.length)) as ConfigValues[string];
        }
        return { group, values };
      });
    });

  /** 写一个扩展 World 的配置组；不是扩展 World 的组返回 null */
  const setConfig = (groupId: string, values: ConfigValues, language: Language): string | null => {
    const group = groups(language).find((g) => g.id === groupId);
    if (!group) return null;
    const worldId = group.owner.startsWith('world:') ? group.owner.slice('world:'.length) : '';
    const prefix = prefixOf(worldId);
    const patch: Record<string, unknown> = {};
    let hot = true;
    for (const [key, value] of Object.entries(values)) {
      if (!worldId || !key.startsWith(prefix)) throw new Error(`不是这个 World 的设置：${key}`);
      setPath(patch, key.slice(prefix.length), value);
      if (group.schema.properties[key]?.['x-hot'] !== true) hot = false;
    }
    if (Object.keys(patch).length === 0) return '没有改动';
    d.persistWorld(worldId, patch);
    return hot ? '已保存' : '已保存，部分设置要重启这个 World 后生效';
  };

  /** 正在运行的扩展 World 的 id */
  const runningIds = (): string[] => d.runtime.list().filter((s) => s.running).map((s) => s.id);

  return { infos, pages, configGroups, setConfig, runningIds, options: d.runtime.configOptions.bind(d.runtime) };
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
