# Upstream sources

Code under `packages/` and `vendor/` comes from upstream projects and is kept close to the original
so that upstream changes can be merged. Record every sync here.

| Path | Upstream | Commit | Synced | License |
|---|---|---|---|---|
| `packages/cortico-world-desktop-pet` | [Pal-AI-Lab/Coopanion](https://github.com/Pal-AI-Lab/Coopanion) `packages/cortico-world-desktop-pet` | `18631752c14d981512fc41cbfaa97a0ba68dd1de` (2026-11-10) | 2026-11-12 | AGPL-3.0-or-later |
| `packages/cortico-provider-coo` | [Pal-AI-Lab/Coopanion](https://github.com/Pal-AI-Lab/Coopanion) `packages/cortico-provider-coo` | `18631752c14d981512fc41cbfaa97a0ba68dd1de` (2026-11-10) | 2026-11-12 | AGPL-3.0-or-later |
| `shared/ui` | [Pal-AI-Lab/Coopanion](https://github.com/Pal-AI-Lab/Coopanion) `shared/ui` (imported by the pet's WebUI panels) | `18631752c14d981512fc41cbfaa97a0ba68dd1de` (2026-11-10) | 2026-11-12 | AGPL-3.0-or-later |
| `console` | [Pal-AI-Lab/Coopanion](https://github.com/Pal-AI-Lab/Coopanion) `console` (the settings window front end) | `18631752c14d981512fc41cbfaa97a0ba68dd1de` (2026-11-10) | 2026-11-13 | AGPL-3.0-or-later |
| `vendor/cortico` (git submodule) | [Pal-AI-Lab/Cortico](https://github.com/Pal-AI-Lab/Cortico) | `fd2cbcccac394a09d1dee2ce4eae710bd9f7458a` (0.2.14, the commit Coopanion pins) | 2026-11-12 | MIT |

Local changes to vendored code (each marked `Coopet 本地修改` in the source):

- `console/features/home/index.ts`: the 「连接 MaiBot」 card (`console/coopet/connection-card.ts`) takes the 「连接模型」 card's place, and the pet preview's height follows it (Coopet's model lives in MaiBot).
- `console/features/pet/index.ts` (习惯): no 称呼, Coo 的名字, 使用统计, 回应模式, 自主配置权限 rows, and no 电脑操作 or 其他 sections (MaiBot decides these, or they steer a model Coopet does not run).
- `console/rail/index.ts`: the 「高级模式」 toggle is not shown (Coopet has no backend for the advanced pages).

Coopet's own code next to vendored code: `console/coopet/` (the settings window entry, the connection card).
