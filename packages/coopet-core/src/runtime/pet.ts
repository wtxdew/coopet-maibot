/**
 * 托管桌宠 World：不经过 Cortico Core，直接构造 `DesktopPetWorld` 并启动。
 *
 * 绕过桌宠的 `definition.ts`（它从 Cortico 的 WorldContext 取配置、密钥、目录），
 * 这些都由这里直接给。启动后桌宠会在 127.0.0.1:<cfg.port> 提供页面，
 * 并自己启动一个 Electron 子进程显示窗口。
 *
 * 对外暴露：调用工具、三个主循环回调（驱动"思考中"等状态）给 Conductor；
 * 显示/隐藏窗口、页面地址给外壳；停止。
 */

import { mkdirSync } from 'node:fs';
import type { DeepPartial } from 'cortico/world.ts';
import type { EventEnvelope, Logger, RunPhase, ToolOutcome } from 'cortico/core/types.ts';
import { DesktopPetWorld, type DesktopPetConfigSection, type PetBotControls } from 'cortico-world-desktop-pet';
import type { CoopetDirs } from './config.ts';
import type { MemoryEventStore } from './event-store.ts';
import { createWorldHost, MAIBOT_MODEL_FACTS, type HostedEvent } from './world-host.ts';

export interface PetHostOptions {
  /** 活的桌宠配置对象（loadConfig 返回的 cfg.pet），桌宠每次用到时才读 */
  cfg: DesktopPetConfigSection;
  persist: (patch: DeepPartial<DesktopPetConfigSection>) => void;
  dirs: CoopetDirs;
  store: MemoryEventStore;
  log: Logger;
  /** 桌宠推出的、需要处理的事件（打字、语音、戳摸…） */
  onEvent: (e: HostedEvent) => void;
  /** 菜单、对话页上显示的名字；每次用到时读 */
  botName: () => string;
  /** 借给桌宠菜单的控制项（例如退出整个应用）；没有时菜单里不显示对应按钮 */
  controls?: PetBotControls;
  /** 桌宠窗口出现在桌面上或离开（显示/隐藏、打开/关闭）时调用 */
  onDesktopChange?: (onDesktop: boolean) => void;
}

export interface PetHandle {
  /** 调用桌宠的工具，如 pet_say、pet_act；工具不存在时抛错 */
  call(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string | ToolOutcome>;
  /** 转给 world.onRunPhase：驱动状态气泡（思考中…）和对话页的活动记录；enteredAt 由这里填当前时刻 */
  phase(p: Omit<RunPhase, 'enteredAt'>): void;
  /** 转给 world.onTurnEnded：一轮结束，重置触摸唤醒等 */
  turnEnded(): void;
  /** 转给 world.onEventsSettled：在对话页把这些消息标成已送达或已丢弃 */
  settled(events: readonly EventEnvelope[], outcome: 'delivered' | 'discarded'): void;
  /** 显示桌宠窗口（没开时打开） */
  show(): void;
  /** 隐藏桌宠窗口（和桌宠菜单里的"隐藏"一样，窗口保持连接） */
  hide(): Promise<void>;
  /** 桌宠页面的地址，例如 http://127.0.0.1:7797；换装页是 `${origin}/dress` */
  readonly origin: string;
  /** 停止：桌宠会保存窗口位置，关掉页面服务和 Electron 窗口 */
  stop(): Promise<void>;
}

export async function startPet(opts: PetHostOptions): Promise<PetHandle> {
  const { dirs, log } = opts;
  for (const dir of [dirs.figures, dirs.runtimes, dirs.models]) mkdirSync(dir, { recursive: true });

  const world = new DesktopPetWorld({
    cfg: opts.cfg,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    persist: opts.persist,
    runtimesRoot: () => dirs.runtimes,
    modelsDir: () => dirs.models,
    botName: opts.botName,
    packRoots: () => [dirs.figures],
    packDir: () => dirs.figures,
    language: () => 'zh',
    modelLanguage: () => 'zh',
    ...(opts.controls ? { controls: opts.controls } : {}),
    ...(opts.onDesktopChange ? { onDesktopChange: opts.onDesktopChange } : {}),
  });

  const host = createWorldHost({
    store: opts.store,
    log: log.child('desktop-pet'),
    modelFacts: MAIBOT_MODEL_FACTS,
    onEvent: opts.onEvent,
  });

  await world.start(host);
  log.info(`桌宠已启动：http://127.0.0.1:${opts.cfg.port}/`);

  let stopped = false;
  return {
    async call(tool, args, signal) {
      // 每次现取：工具表会随设置变化（例如打开电脑操作）
      const def = world.tools().find((t) => t.name === tool);
      if (!def) throw new Error(`桌宠没有工具 ${tool}`);
      return def.handler(args, { role: 'conductor', log: host.log, ...(signal ? { signal } : {}) });
    },
    phase: (p) => world.onRunPhase({ ...p, enteredAt: new Date().toISOString() }),
    turnEnded: () => world.onTurnEnded(),
    settled: (events, outcome) => world.onEventsSettled(events, outcome),
    show: () => world.openWindow(),
    // 隐藏没有单独的公开方法，走桌宠面板的公开调用入口（Coopanion 的设置窗也走这里）
    async hide() {
      await world.webUi('zh').invoke?.('pet', 'hideWindow', []);
    },
    origin: `http://127.0.0.1:${opts.cfg.port}`,
    async stop() {
      if (stopped) return;
      stopped = true;
      await world.stop();
      log.info('桌宠已停止');
    },
  };
}
