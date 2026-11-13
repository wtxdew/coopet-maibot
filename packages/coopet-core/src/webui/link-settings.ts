/**
 * 「连接 MaiBot」卡（console/coopet/connection-card.ts）读写的配置组 `coopet.link`，走 `/api/config`。
 *
 * - 键就是配置里的路径：`link.kind`、`link.plugin.url`、`link.maim.botAccount`……
 * - 两个 token 键只写不读：读的时候永远是空字符串，"有没有设置"放在 `/api/status` 的 link.tokenSet；
 *   写的时候空字符串表示不改，非空就写 token 文件（权限 600）。
 * - 地址必须是 ws:// 或 wss:// 开头（可以留空：留空时用占位连接，不连）。
 * - 写完后由调用方换上新连接（main.ts 的 applyLink），不用重启核心。
 */

import type { ConfigGroup, ConfigProperty, ConfigValues } from 'cortico/core/config-schema.ts';
import { baseLanguage, type Language } from 'cortico/core/language.ts';
import { tokenSet, writeToken, type AppPatch, type CoopetConfig, type LinkKind } from '../runtime/config.ts';

export const LINK_GROUP = 'coopet.link';

const TEXT = {
  zh: {
    title: '连接 MaiBot',
    kind: '连接方式', plugin: { url: '插件地址', token: '插件 token' },
    maim: { url: 'maim_message 地址', token: 'maim_message token', botAccount: 'Bot 账号', userId: '你的 user_id', userNickname: '你的昵称' },
    badUrl: (key: string) => `${key} 要以 ws:// 或 wss:// 开头`,
  },
  en: {
    title: 'Connect to MaiBot',
    kind: 'Connection', plugin: { url: 'Plugin address', token: 'Plugin token' },
    maim: { url: 'maim_message address', token: 'maim_message token', botAccount: 'Bot account', userId: 'Your user_id', userNickname: 'Your nickname' },
    badUrl: (key: string) => `${key} must start with ws:// or wss://`,
  },
} as const;

const text = (language: Language) => TEXT[baseLanguage(language)];
const str = (title: string): ConfigProperty => ({ type: 'string', title });

export function linkGroup(language: Language): ConfigGroup {
  const t = text(language);
  return {
    id: LINK_GROUP,
    owner: 'core',
    schema: {
      type: 'object',
      title: t.title,
      properties: {
        'link.kind': { type: 'string', title: t.kind, enum: ['plugin', 'maim'] },
        'link.plugin.url': str(t.plugin.url),
        'link.plugin.token': str(t.plugin.token),
        'link.maim.url': str(t.maim.url),
        'link.maim.token': str(t.maim.token),
        'link.maim.botAccount': str(t.maim.botAccount),
        'link.maim.userId': str(t.maim.userId),
        'link.maim.userNickname': str(t.maim.userNickname),
      },
    },
  };
}

/** 当前值；token 永远是空字符串 */
export function linkValues(cfg: CoopetConfig): ConfigValues {
  const { kind, plugin, maim } = cfg.link;
  return {
    'link.kind': kind,
    'link.plugin.url': plugin.url,
    'link.plugin.token': '',
    'link.maim.url': maim.url,
    'link.maim.token': '',
    'link.maim.botAccount': maim.botAccount,
    'link.maim.userId': maim.userId,
    'link.maim.userNickname': maim.userNickname,
  };
}

/** 两种连接的 token 有没有设置 */
export function linkTokens(cfg: CoopetConfig): Record<LinkKind, boolean> {
  return { plugin: tokenSet(cfg.link.plugin.tokenFile), maim: tokenSet(cfg.link.maim.tokenFile) };
}

/**
 * 保存：先全部检查，再写 token 文件和 config.json。返回有没有改动。
 * 值已经过 WebApp 的 coerceGroupValues（只有声明过的键、都是字符串、kind 在选项里）。
 */
export function saveLinkValues(values: ConfigValues, deps: { cfg: CoopetConfig; persist(patch: AppPatch): void }, language: Language): boolean {
  const t = text(language);
  const v = values as Record<string, string | undefined>;
  for (const key of ['link.plugin.url', 'link.maim.url']) {
    const url = v[key]?.trim();
    if (url && !/^wss?:\/\//.test(url)) throw new Error(t.badUrl(key === 'link.plugin.url' ? t.plugin.url : t.maim.url));
  }
  const patch: NonNullable<AppPatch['link']> = {};
  if (v['link.kind'] !== undefined) patch.kind = v['link.kind'] as LinkKind;
  const plugin: Record<string, string> = {};
  if (v['link.plugin.url'] !== undefined) plugin.url = v['link.plugin.url'].trim();
  const maim: Record<string, string> = {};
  for (const k of ['url', 'botAccount', 'userId', 'userNickname'] as const) {
    const value = v[`link.maim.${k}`];
    if (value !== undefined) maim[k] = value.trim();
  }
  if (Object.keys(plugin).length) patch.plugin = plugin;
  if (Object.keys(maim).length) patch.maim = maim;

  const pluginToken = v['link.plugin.token']?.trim();
  const maimToken = v['link.maim.token']?.trim();
  if (pluginToken) writeToken(deps.cfg.link.plugin.tokenFile, pluginToken);
  if (maimToken) writeToken(deps.cfg.link.maim.tokenFile, maimToken);
  if (Object.keys(patch).length) deps.persist({ link: patch });
  return Object.keys(patch).length > 0 || !!pluginToken || !!maimToken;
}
