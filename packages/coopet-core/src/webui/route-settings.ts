/**
 * 每个扩展 World 一组「Coopet 怎么处理它的通知」：配置组 `coopet.route.<worldId>`，
 * 追加进那个 World 页的配置标签（extension-worlds.ts 的 extraConfig），值存在 config.json 的 routes.<worldId>。
 * 三项（含义见 runtime/config.ts 的 RouteSettings、conductor/routing.ts）：
 * - 处理方式：桌宠 / 麦麦 / 规则 / 关闭；
 * - 认不得的通知：只记录 / 桌宠念开头 / 交给麦麦；
 * - 最多念多少字。
 * 两个下拉框的选项文字来自 `/api/config/options/coopet.route-mode`、`coopet.route-unknown`。
 */

import type { ConfigGroup, ConfigValues } from 'cortico/core/config-schema.ts';
import { baseLanguage, type Language } from 'cortico/core/language.ts';
import {
  MAX_CHARS_RANGE, ROUTE_DEFAULTS, ROUTE_MODES, UNKNOWN_MODES,
  type AppPatch, type CoopetConfig, type RouteMode, type RouteSettings, type UnknownMode,
} from '../runtime/config.ts';

export const ROUTE_PREFIX = 'coopet.route.';
export const ROUTE_OPTIONS = 'coopet.route-mode';
export const UNKNOWN_OPTIONS = 'coopet.route-unknown';
const KEYS = { mode: 'route.mode', unknown: 'route.unknown', maxChars: 'route.maxChars' } as const;

const TEXT = {
  zh: {
    title: 'Coopet 怎么处理它的通知',
    mode: '处理方式',
    modeHint: 'Coopet 认得的通知（例如 Coding Agent 完成）送到哪里。「规则」按扩展自己的分类走（例如 ntfy 每个话题的设置）；扩展没有分类时按「桌宠」。「麦麦」把通知交给麦麦，由她决定要不要说；要 MaiBot 插件 0.2.1 以上，没连上或插件太旧时由桌宠说。',
    modes: { pet: '桌宠', maibot: '麦麦', rule: '规则', off: '关闭' } as Record<RouteMode, string>,
    unknown: '认不得的通知',
    unknownHint: '扩展的通知原本是写给模型看的，Coopet 认不得的念出来多半不通顺。',
    unknowns: { record: '只记录', pet: '桌宠念开头', maibot: '交给麦麦' } as Record<UnknownMode, string>,
    maxChars: '最多念多少字',
    maxCharsHint: `桌宠气泡里一条通知最多显示多少字（${MAX_CHARS_RANGE.min}–${MAX_CHARS_RANGE.max}），超出的截掉。交给麦麦的不受这个限制。`,
  },
  en: {
    title: 'How Coopet handles its notifications',
    mode: 'Handling',
    modeHint: 'Where notifications Coopet knows (such as a coding agent finishing) go. Rules follow the extension\'s own categories (such as each ntfy topic\'s setting); an extension without categories uses Pet. MaiBot hands them to MaiBot, who decides whether to say anything; it needs MaiBot plugin 0.2.1 or later, and the pet says them while not connected or with an older plugin.',
    modes: { pet: 'Pet', maibot: 'MaiBot', rule: 'Rules', off: 'Off' } as Record<RouteMode, string>,
    unknown: 'Unknown notifications',
    unknownHint: 'Extension notifications are written for a model; read out as they are, the ones Coopet does not know rarely sound right.',
    unknowns: { record: 'Only record', pet: 'Pet reads the start', maibot: 'Hand to MaiBot' } as Record<UnknownMode, string>,
    maxChars: 'Longest notification',
    maxCharsHint: `How many characters of a notification the pet's bubble shows at most (${MAX_CHARS_RANGE.min}–${MAX_CHARS_RANGE.max}); the rest is cut. Notifications handed to MaiBot are not limited by this.`,
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
        [KEYS.mode]: { type: 'string', title: t.mode, description: t.modeHint, enum: [...ROUTE_MODES], 'x-options': ROUTE_OPTIONS, 'x-hot': true },
        [KEYS.unknown]: { type: 'string', title: t.unknown, description: t.unknownHint, enum: [...UNKNOWN_MODES], 'x-options': UNKNOWN_OPTIONS, 'x-hot': true },
        [KEYS.maxChars]: { type: 'integer', title: t.maxChars, description: t.maxCharsHint, minimum: MAX_CHARS_RANGE.min, maximum: MAX_CHARS_RANGE.max, 'x-hot': true },
      },
    },
  };
}

/** 两个下拉框的选项；不是这里的返回 null */
export function routeOptions(kind: string, language: Language): Array<{ value: string; label: string }> | null {
  const t = TEXT[baseLanguage(language)];
  if (kind === ROUTE_OPTIONS) return ROUTE_MODES.map((value) => ({ value, label: t.modes[value] }));
  if (kind === UNKNOWN_OPTIONS) return UNKNOWN_MODES.map((value) => ({ value, label: t.unknowns[value] }));
  return null;
}

export function routeSettings(cfg: CoopetConfig, worldId: string): RouteSettings {
  return cfg.routes[worldId] ?? ROUTE_DEFAULTS;
}

export function routeValues(cfg: CoopetConfig, worldId: string): ConfigValues {
  const r = routeSettings(cfg, worldId);
  return { [KEYS.mode]: r.mode, [KEYS.unknown]: r.unknown, [KEYS.maxChars]: r.maxChars };
}

/** 保存；返回有没有改动。值已经过 WebApp 的 coerceGroupValues 检查，范围再由 persist 检查 */
export function saveRoute(worldId: string, values: ConfigValues, deps: { cfg: CoopetConfig; persist(patch: AppPatch): void }): boolean {
  const now = routeSettings(deps.cfg, worldId);
  const patch: Partial<RouteSettings> = {};
  const mode = values[KEYS.mode] as RouteMode | undefined;
  const unknown = values[KEYS.unknown] as UnknownMode | undefined;
  const maxChars = values[KEYS.maxChars] as number | undefined;
  if (mode !== undefined && mode !== now.mode) patch.mode = mode;
  if (unknown !== undefined && unknown !== now.unknown) patch.unknown = unknown;
  if (maxChars !== undefined && maxChars !== now.maxChars) patch.maxChars = maxChars;
  if (Object.keys(patch).length === 0) return false;
  deps.persist({ routes: { [worldId]: patch } });
  return true;
}
