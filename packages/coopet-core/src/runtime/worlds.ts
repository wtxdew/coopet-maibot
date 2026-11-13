/**
 * 托管扩展 World（Cortico 契约：WorldDefinition → World）。桌宠不在这里，它继续由 pet.ts 单独托管。
 *
 * - 配置：每个 World 一段 `config.json` 的 worlds.<id>（默认值来自定义的 defaults()，默认关闭）。
 * - 上下文（WorldContext）：活的配置、persist 写回、密钥（secrets.json）、数据目录 `<data>/worlds/<id>/`、restart。
 * - 宿主（WorldHost）：每个 World 一个，事件存进事件库后交给 onEvent（Conductor 按来源路由）。
 * - 启用、停用、重启：按 cfg.enabled 启动或停止实例，不重启核心；启动失败记下原因（设置窗显示），不影响其他 World。
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Language } from 'cortico/core/language.ts';
import type { Logger, World, WorldHost } from 'cortico/core/types.ts';
import type { WorldContext, WorldDefinition, WorldSection } from 'cortico/world.ts';
import type { CoopetDirs } from './config.ts';
import type { MemoryEventStore } from './event-store.ts';
import type { SecretStore } from './secrets.ts';
import { createWorldHost, MAIBOT_MODEL_FACTS, type HostedEvent } from './world-host.ts';

export interface WorldRuntimeDeps {
  definitions: readonly WorldDefinition<WorldSection>[];
  config: {
    worldSection<S extends object>(id: string, defaults: S): S;
    persistWorld(id: string, patch: Record<string, unknown>): void;
  };
  secrets: Pick<SecretStore, 'get' | 'set'>;
  dirs: CoopetDirs;
  store: MemoryEventStore;
  log: Logger;
  botName(): string;
  timezone?: string;
  /** 扩展 World 推出的、要处理的事件 */
  onEvent(worldId: string, e: HostedEvent): void;
}

/** 一个扩展 World 此刻的状态（设置窗的 World 列表用） */
export interface WorldSlotInfo {
  id: string;
  label: string;
  enabled: boolean;
  /** 正在运行 */
  running: boolean;
  /** 没能启动的原因 */
  failure?: string;
}

interface Slot {
  def: WorldDefinition<WorldSection>;
  cfg: WorldSection;
  instance: World | null;
  failure?: string;
  /** 同一个 World 的启停排队执行 */
  queue: Promise<void>;
}

export class WorldRuntime {
  private readonly slots = new Map<string, Slot>();
  private readonly timezone: string;

  constructor(private readonly deps: WorldRuntimeDeps) {
    this.timezone = deps.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    for (const def of deps.definitions) {
      const cfg = deps.config.worldSection(def.id, def.defaults());
      this.slots.set(def.id, { def, cfg, instance: null, queue: Promise.resolve() });
    }
  }

  /** 启动所有已启用的 World；一个失败不影响其他。 */
  async startAll(): Promise<void> {
    await Promise.all([...this.slots.keys()].map((id) => this.sync(id)));
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.slots.values()].map((slot) => this.enqueue(slot, () => this.stopSlot(slot))));
  }

  /** 启用或停用：写回配置，再按配置启动或停止。返回一句结果说明。 */
  async set(id: string, enabled: boolean): Promise<string> {
    const slot = this.slotOf(id);
    this.deps.config.persistWorld(id, { enabled });
    await this.sync(id);
    if (enabled && slot.failure) throw new Error(slot.failure);
    return `${slot.def.label} ${enabled ? '已启用' : '已停用'}`;
  }

  /** 停下、按定义重建、再按配置启动 */
  async restart(id: string): Promise<string> {
    const slot = this.slotOf(id);
    await this.enqueue(slot, async () => {
      await this.stopSlot(slot);
      if (slot.cfg.enabled) await this.startSlot(slot);
    });
    if (slot.failure) throw new Error(slot.failure);
    return `${slot.def.label} 已重启`;
  }

  list(): WorldSlotInfo[] {
    return [...this.slots.values()].map((s) => ({
      id: s.def.id,
      label: s.def.label,
      enabled: s.cfg.enabled === true,
      running: s.instance !== null,
      ...(s.failure ? { failure: s.failure } : {}),
    }));
  }

  /** 正在运行的实例；没有或没启动时为 null */
  instance(id: string): World | null {
    return this.slots.get(id)?.instance ?? null;
  }

  definition(id: string): WorldDefinition<WorldSection> | undefined {
    return this.slots.get(id)?.def;
  }

  /** x-options 的选项：问每个定义，第一个给出非空表的为准 */
  configOptions(kind: string, language: Language): Array<{ value: string; label: string }> {
    for (const slot of this.slots.values()) {
      const options = slot.def.configOptions?.(kind, language);
      if (options?.length) return options;
    }
    return [];
  }

  private slotOf(id: string): Slot {
    const slot = this.slots.get(id);
    if (!slot) throw new Error(`没有这个 World：${id}`);
    return slot;
  }

  private sync(id: string): Promise<void> {
    const slot = this.slotOf(id);
    return this.enqueue(slot, async () => {
      if (slot.cfg.enabled && !slot.instance) await this.startSlot(slot);
      else if (!slot.cfg.enabled && slot.instance) await this.stopSlot(slot);
    });
  }

  private enqueue(slot: Slot, step: () => Promise<void>): Promise<void> {
    const next = slot.queue.then(step, step);
    slot.queue = next.catch(() => {});
    return next;
  }

  private async startSlot(slot: Slot): Promise<void> {
    const { def } = slot;
    const log = this.deps.log.child(def.id);
    try {
      const ctx = this.context(slot);
      def.preflight?.(ctx);
      const instance = def.create(ctx);
      await instance.start(this.host(def.id, log));
      slot.instance = instance;
      delete slot.failure;
      log.info(`World 已启动：${def.label}`);
    } catch (err) {
      slot.instance = null;
      slot.failure = err instanceof Error ? err.message : String(err);
      log.error(`World 没能启动：${def.label}`, err);
    }
  }

  private async stopSlot(slot: Slot): Promise<void> {
    const instance = slot.instance;
    if (!instance) return;
    slot.instance = null;
    try {
      await instance.stop();
      this.deps.log.child(slot.def.id).info(`World 已停止：${slot.def.label}`);
    } catch (err) {
      this.deps.log.child(slot.def.id).warn(`World 停止时出错：${slot.def.label}`, err);
    }
  }

  private host(id: string, log: Logger): WorldHost {
    return createWorldHost({
      store: this.deps.store,
      log,
      modelFacts: MAIBOT_MODEL_FACTS,
      onEvent: (e) => this.deps.onEvent(id, e),
    });
  }

  private context(slot: Slot): WorldContext<WorldSection> {
    const { deps } = this;
    const id = slot.def.id;
    const dataDir = join(deps.dirs.data, 'worlds', id);
    mkdirSync(dataDir, { recursive: true });
    return {
      id,
      cfg: slot.cfg,
      timezone: this.timezone,
      get botName() { return deps.botName(); },
      botDir: deps.dirs.root,
      packageDir: deps.dirs.root,
      dataDir,
      repoRoot: deps.dirs.root,
      secret: (name) => deps.secrets.get(name),
      storeSecret: (name, value) => deps.secrets.set(name, value),
      persist: (patch) => deps.config.persistWorld(id, patch as Record<string, unknown>),
      restart: async () => { await this.restart(id).catch(() => {}); },
    };
  }
}
