/**
 * WorldHost 实现：桌宠 World 启动时拿到的宿主对象。
 *
 * 在 Cortico 里，事件先排队、按批送给模型；这里没有模型，也没有队列：
 * 要处理的事件存进事件库后，马上交给 `onEvent`（也就是 Conductor）。
 * 所以 `withdrawPending` / `promotePending` 一律如实返回 false（"不在队列中"）。
 *
 * 桌宠只用到 log、store、modelFacts、pushEvent、withdrawPending、promotePending、blob；
 * 其余成员按接口要求给出空实现。
 */

import type {
  EventEnvelope,
  Logger,
  ModelFacts,
  PushOptions,
  TriggerMode,
  WorldHost,
} from 'cortico/core/types.ts';
import type { MemoryEventStore } from './event-store.ts';

/** 交给 Conductor 的事件，带上 World 指定的触发方式。 */
export interface HostedEvent {
  event: EventEnvelope;
  /** World 没指定时为 undefined（Cortico 里外部事件缺省按 debounce 处理） */
  trigger?: TriggerMode;
}

export interface WorldHostOptions {
  store: MemoryEventStore;
  log: Logger;
  modelFacts: ModelFacts;
  /** 要处理的事件。在 pushEvent 返回之后才调用，World 先把自己的后续处理做完。 */
  onEvent: (e: HostedEvent) => void;
}

/** 阶段 1 的"模型"能力：不接收任何附件，所以桌宠不会往事件里放图片。 */
export const MAIBOT_MODEL_FACTS: ModelFacts = {
  model: () => 'maibot',
  accepts: () => false,
  contextWindow: () => undefined,
};

export function createWorldHost(opts: WorldHostOptions): WorldHost {
  const { store, log, onEvent } = opts;

  const dispatch = (hosted: HostedEvent): void => {
    try {
      onEvent(hosted);
    } catch (err) {
      log.error(`处理事件 #${hosted.event.cursor}（${hosted.event.type}）时出错`, err);
    }
  };

  return {
    async pushEvent(e, pushOpts?: PushOptions) {
      const { blobs, origin, ...rest } = e;
      if (blobs?.length) log.warn(`事件 ${e.type} 带了 ${blobs.length} 个附件，阶段 1 不保存附件，已丢弃`);
      const deliver = pushOpts?.deliver !== false;
      const saved = store.append({
        ...rest,
        origin: origin ?? 'external',
        contextDelivery: deliver ? 'deliver' : 'archive-only',
      });
      if (deliver) {
        const hosted: HostedEvent = { event: saved, trigger: pushOpts?.trigger };
        setImmediate(() => dispatch(hosted));
      }
      return saved;
    },

    pushDeferred(e) {
      log.debug(`忽略延迟事件 ${e.type}：没有投递批次`);
    },

    store,

    async drainPendingEvents() {
      return [];
    },

    async withdrawPending() {
      return false;
    },

    async promotePending() {
      return false;
    },

    modelFacts: opts.modelFacts,

    blob() {
      return null;
    },

    reportUsage() {},

    log,
  };
}
