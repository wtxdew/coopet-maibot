/**
 * 每个扩展 World 一组「Coopet 怎么处理它的通知」：配置组 `coopet.route.<worldId>`，
 * 追加进那个 World 页的配置标签（extension-worlds.ts 的 extraConfig），值存在 config.json 的 routes.<worldId>。
 * 选项的文字来自 `/api/config/options/coopet.route-mode`。
 */

import type { ConfigGroup, ConfigValues } from 'cortico/core/config-schema.ts';
import { baseLanguage, type Language } from 'cortico/core/language.ts';
import { ROUTE_MODES, type AppPatch, type CoopetConfig, type RouteMode } from '../runtime/config.ts';

export const ROUTE_PREFIX = 'coopet.route.';
export const ROUTE_OPTIONS = 'coopet.route-mode';
const KEY = 'route.mode';

const TEXT = {
  zh: {
    title: 'Coopet 怎么处理它的通知',
    mode: '处理方式',
    hint: '扩展 World 的通知原本是写给模型看的。「自动」只说 Coopet 认得的通知（例如 Coding Agent 完成），其余只记进事件流；「全部让桌宠说」会念出认不得的通知的开头。',
    options: { auto: '自动（推荐）', pet: '全部让桌宠说', off: '不处理' } as Record<RouteMode, string>,
  },
  en: {
    title: 'How Coopet handles its notifications',
    mode: 'Handling',
    hint: 'Extension World notifications are written for a model. Auto says only the ones Coopet knows (such as a coding agent finishing) and keeps the rest in the event stream; Let the pet say all reads out the start of unknown ones.',
    options: { auto: 'Auto (recommended)', pet: 'Let the pet say all', off: 'Ignore' } as Record<RouteMode, string>,
  },
} as const;

export function routeGroup(worldId: string, language: Language): ConfigGroup {
  const t = TEXT[baseLanguage(language)];
  return {
    id: `${ROUTE_PREFIX}${worldId}`,
    owner: `world:${worldId}`,
    schema: {
      type: 'object',
      title: t.title,
      properties: {
        [KEY]: { type: 'string', title: t.mode, description: t.hint, enum: [...ROUTE_MODES], 'x-options': ROUTE_OPTIONS, 'x-hot': true },
      },
    },
  };
}

export function routeOptions(language: Language): Array<{ value: string; label: string }> {
  const t = TEXT[baseLanguage(language)];
  return ROUTE_MODES.map((value) => ({ value, label: t.options[value] }));
}

export function routeMode(cfg: CoopetConfig, worldId: string): RouteMode {
  return cfg.routes[worldId]?.mode ?? 'auto';
}

export function routeValues(cfg: CoopetConfig, worldId: string): ConfigValues {
  return { [KEY]: routeMode(cfg, worldId) };
}

/** 保存；返回有没有改动 */
export function saveRoute(worldId: string, values: ConfigValues, deps: { cfg: CoopetConfig; persist(patch: AppPatch): void }): boolean {
  const mode = values[KEY] as RouteMode | undefined;
  if (!mode || mode === routeMode(deps.cfg, worldId)) return false;
  deps.persist({ routes: { [worldId]: { mode } } });
  return true;
}
