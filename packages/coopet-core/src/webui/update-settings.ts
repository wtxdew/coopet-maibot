/**
 * 「习惯」页的「自动更新」开关：键 `companion.autoUpdate`，和 Coopanion 的一样，放在界面语言所在的配置组 `companion` 里
 * （surface.ts 的 languageGroup；console/features/pet/index.ts 读这个组，值是布尔时才显示那一行）。
 * 照 Coopanion 的 core/update-settings.ts。
 *
 * 只有能自己装更新的版本（Windows 安装版）才有这个开关：外壳启动核心时带上 COOPET_SELF_UPDATE=1。
 * 值存在 config.json 的 update.auto；启动时和改了时告诉外壳（main.ts），外壳据此开关更新器（updater.cjs）。
 */

import type { ConfigGroup, ConfigValues } from 'cortico/core/config-schema.ts';
import { baseLanguage, type Language } from 'cortico/core/language.ts';
import type { AppPatch, CoopetConfig } from '../runtime/config.ts';

export const AUTO_UPDATE_KEY = 'companion.autoUpdate';
export const AUTO_UPDATE_DEFAULT = true;

const TEXT = {
  zh: {
    auto: '自动更新',
    hint: '有新版本时在后台下载，退出 Coopet 时静默安装（也可以在桌宠气泡里点「现在重启」）。',
  },
  en: {
    auto: 'Automatic updates',
    hint: 'Download new versions in the background and install them quietly when Coopet quits (or click Restart now in the pet\'s bubble).',
  },
} as const;

/** 这个版本能不能自己装更新（外壳告诉的） */
export function canSelfUpdate(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.COOPET_SELF_UPDATE === '1';
}

/** 加进 `companion` 组的属性；不能自己装更新的版本没有这个开关 */
export function autoUpdateProperties(language: Language, selfUpdate = canSelfUpdate()): ConfigGroup['schema']['properties'] {
  if (!selfUpdate) return {};
  const t = TEXT[baseLanguage(language)];
  return { [AUTO_UPDATE_KEY]: { type: 'boolean', title: t.auto, description: t.hint, 'x-hot': true } };
}

export function updateValues(cfg: CoopetConfig, selfUpdate = canSelfUpdate()): ConfigValues {
  return selfUpdate ? { [AUTO_UPDATE_KEY]: cfg.update.auto } : {};
}

/** 保存；返回有没有改动 */
export function saveUpdateValues(values: ConfigValues, deps: { cfg: CoopetConfig; persist(patch: AppPatch): void }): boolean {
  const auto = values[AUTO_UPDATE_KEY] as boolean | undefined;
  if (auto === undefined || auto === deps.cfg.update.auto) return false;
  deps.persist({ update: { auto } });
  return true;
}
