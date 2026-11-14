# Upstream sources

Code under `packages/` and `vendor/` comes from upstream projects and is kept close to the original
so that upstream changes can be merged. Record every sync here.

| Path | Upstream | Commit | Synced | License |
|---|---|---|---|---|
| `packages/cortico-world-desktop-pet` | [Pal-AI-Lab/Coopanion](https://github.com/Pal-AI-Lab/Coopanion) `packages/cortico-world-desktop-pet` | `8829fd4fd0916f2c65f824daa63e503eff042b8a` (2026-11-13) | 2026-11-14 | AGPL-3.0-or-later |
| `packages/cortico-provider-coo` | [Pal-AI-Lab/Coopanion](https://github.com/Pal-AI-Lab/Coopanion) `packages/cortico-provider-coo` | `8829fd4fd0916f2c65f824daa63e503eff042b8a` (2026-11-13) | 2026-11-14 | AGPL-3.0-or-later |
| `shared/ui` | [Pal-AI-Lab/Coopanion](https://github.com/Pal-AI-Lab/Coopanion) `shared/ui` (imported by the pet's WebUI panels) | `8829fd4fd0916f2c65f824daa63e503eff042b8a` (2026-11-13) | 2026-11-14 | AGPL-3.0-or-later |
| `console` | [Pal-AI-Lab/Coopanion](https://github.com/Pal-AI-Lab/Coopanion) `console` (the settings window front end) | `8829fd4fd0916f2c65f824daa63e503eff042b8a` (2026-11-13) | 2026-11-14 | AGPL-3.0-or-later |
| `cortico-world-coding-agent-notify` (npm dependency, bundled as a built-in World extension, unchanged; not copied into this repo) | [ThermalEng/coopanion-agent-notify-world](https://github.com/ThermalEng/coopanion-agent-notify-world), npm `cortico-world-coding-agent-notify` | `1.2.0` (pinned) | 2026-11-13 | AGPL-3.0-or-later |
| `packages/coopet-app/updater.cjs`, `packages/coopet-app/tests/updater.test.ts` (copied files; only the release address and test import paths changed) | [Pal-AI-Lab/Coopanion](https://github.com/Pal-AI-Lab/Coopanion) `app/updater.cjs`, `tests/updater.test.js` | `9b814fd` | 2026-11-14 | AGPL-3.0-or-later |
| `packages/coopet-core/src/runtime/system-proxy.ts`, `packages/coopet-app/core-env.cjs` and their tests `packages/coopet-core/tests/system-proxy.test.ts`, `packages/coopet-app/tests/core-env.test.ts` (copied files) | [Pal-AI-Lab/Coopanion](https://github.com/Pal-AI-Lab/Coopanion) `core/system-proxy.ts`, `app/core-env.cjs`, `tests/system-proxy.test.ts`, `tests/core-env.test.ts` | `8829fd4fd0916f2c65f824daa63e503eff042b8a` (2026-11-13) | 2026-11-14 | AGPL-3.0-or-later |
| `vendor/cortico` (git submodule) | [Pal-AI-Lab/Cortico](https://github.com/Pal-AI-Lab/Cortico) | `83623831133a01679db5b5459eea7d11be590988` (0.2.15, the commit Coopanion pins) | 2026-11-14 | MIT |

Local changes to vendored code (each marked `Coopet 本地修改` in the source):

- `console/features/home/index.ts`: the 「连接 MaiBot」 card (`console/coopet/connection-card.ts`) takes the 「连接模型」 card's place, and the pet preview's height follows it (Coopet's model lives in MaiBot).
- `packages/cortico-world-desktop-pet/src/webui/client.ts`: no window runtime install button while an external window program (`CORTICO_DESKTOP_PET_HOST`) is in use.
- `console/features/pet/index.ts` (习惯): no 称呼, Coo 的名字, 使用统计, 回应模式, 自主配置权限 rows, no 电脑操作 section, and 其他 holds only the OBS overlay, without the Chat page's context ring (MaiBot decides these, or they steer a model Coopet does not run); the section tabs under the title have no 电脑操作 tab.
- `console/features/home/index.ts`: no 使用向导 (the guide is the embedding app's; Coopet has none).
- `console/features/chat/index.ts`: no 控制台 link (that page is not mounted); without an avatar the bot's initial shows instead of a broken image.
- `console/rail/index.ts`: no 「高级模式」 toggle (Coopet has no backend for the advanced pages), no pause key or run state (Cortico's model session pause), and the name is read-only (it is MaiBot's bot name).
- `console/rail/brand.ts`: the Coopet wordmark (`console/coopet/brand.ts`, drawn in the Coopanion wordmark's strokes) in place of Coopanion's.
- `console/titlebar.ts`: the version and update status come from `console/coopet/release.ts` (Coopanion's `features/release.ts` with Coopet's repository and words; the original file is untouched).
- `console/advanced/features/worlds/index.ts`: no uninstall key without the extension surface (Coopet's World is built in).
- `system-proxy.ts` / `core-env.cjs`: the IPC message is `proxy` (Coopanion's `companion:proxy`) and the variable `COOPET_SYSTEM_PROXY` (Coopanion's `COOPANION_SYSTEM_PROXY`); `core-env.cjs` has JSDoc parameter types for the shell's type check. The copied runtime test only asks that requests fail without the quit proxy once it is gone, not that they fail on DNS: a DNS that resolves `.test` names (mihomo's fake-ip) makes them time out instead. That test also gets a 30 s timeout (Coopanion's vitest config sets 20 s for every test; Coopet's keeps the 5 s default).

Coopet's own code next to vendored code: `console/coopet/` (the settings window entry and page, the connection card, the wordmark, the title bar's version and update status, extra styles).
