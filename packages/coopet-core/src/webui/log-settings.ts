/**
 * 「运行诊断 → 配置」里的日志设置：配置组 `coopet.log`，走 `/api/config`。
 * 两项都马上生效：logger 每写一条现读 cfg.log.level，文本日志文件的去处现读 cfg.log.file。
 */

import type { ConfigGroup, ConfigValues } from 'cortico/core/config-schema.ts';
import { baseLanguage, type Language } from 'cortico/core/language.ts';
import type { LogLevel } from 'cortico/core/types.ts';
import type { AppPatch, CoopetConfig } from '../runtime/config.ts';
import { LOG_LEVELS } from '../runtime/log.ts';

export const LOG_GROUP = 'coopet.log';

const TEXT = {
  zh: {
    title: '日志',
    level: '日志级别', levelHint: '记录到哪一级为止。排查问题时改成 debug，平时用 info。',
    file: '写日志文件', fileHint: '同时写一份按天分的文本日志（保留 7 天），托盘里「打开日志文件夹」能找到。运行日志页的记录不受影响。',
  },
  en: {
    title: 'Logs',
    level: 'Log level', levelHint: 'The lowest level recorded. Use debug while tracking down a problem, info otherwise.',
    file: 'Write log files', fileHint: 'Also write daily text logs (kept 7 days), found through Open the log folder in the tray. The run log page is not affected.',
  },
} as const;

export function logGroup(language: Language): ConfigGroup {
  const t = TEXT[baseLanguage(language)];
  return {
    id: LOG_GROUP,
    owner: 'core',
    schema: {
      type: 'object',
      title: t.title,
      properties: {
        'log.level': { type: 'string', title: t.level, description: t.levelHint, enum: [...LOG_LEVELS], 'x-hot': true },
        'log.file': { type: 'boolean', title: t.file, description: t.fileHint, 'x-hot': true },
      },
    },
  };
}

export function logValues(cfg: CoopetConfig): ConfigValues {
  return { 'log.level': cfg.log.level, 'log.file': cfg.log.file };
}

/** 保存；返回有没有改动。值已经过 WebApp 的 coerceGroupValues 检查。 */
export function saveLogValues(values: ConfigValues, deps: { cfg: CoopetConfig; persist(patch: AppPatch): void }): boolean {
  const patch: NonNullable<AppPatch['log']> = {};
  const level = values['log.level'] as LogLevel | undefined;
  const file = values['log.file'] as boolean | undefined;
  if (level !== undefined && level !== deps.cfg.log.level) patch.level = level;
  if (file !== undefined && file !== deps.cfg.log.file) patch.file = file;
  if (Object.keys(patch).length === 0) return false;
  deps.persist({ log: patch });
  return true;
}
