import { describe, expect, it } from 'vitest';
import { TurnStats } from '../src/conductor/stats.ts';

describe('TurnStats', () => {
  it('records the steps of a turn in ms from the input, once each', () => {
    let t = 1000;
    const s = new TurnStats(() => t);
    s.start(7, 'typed');
    t = 1080; s.mark('acked');
    t = 1500; s.mark('thinking');
    t = 3200; s.mark('reply');
    t = 3300; s.mark('reply');
    t = 3350; s.mark('bubble');
    s.end('replied');
    const snap = s.snapshot();
    expect(snap.turns).toBe(1);
    expect(snap.last).toMatchObject({ cursor: 7, via: 'typed', outcome: 'replied' });
    expect(snap.last!.steps).toEqual([{ step: 'acked', ms: 80 }, { step: 'thinking', ms: 500 }, { step: 'reply', ms: 2200 }, { step: 'bubble', ms: 2350 }]);
    expect(snap.recent).toEqual({ replied: 1, medianReplyMs: 2200, maxReplyMs: 2200 });
  });

  it('keeps the median and the slowest of recent replies; turns without a reply do not count', () => {
    let t = 0;
    const s = new TurnStats(() => t);
    for (const [i, ms] of [1000, 3000, 2000, 4000].entries()) {
      t = i * 100_000; s.start(i, 'voice');
      t += ms; s.mark('reply'); s.end('replied');
    }
    s.start(9, 'typed'); s.end('not-sent');
    expect(s.snapshot().recent).toEqual({ replied: 4, medianReplyMs: 2500, maxReplyMs: 4000 });
    expect(s.snapshot()).toMatchObject({ turns: 5, last: { cursor: 9, outcome: 'not-sent', steps: [] } });
  });

  it('ends an unfinished turn as no reply when the next one starts, and ignores marks between turns', () => {
    const s = new TurnStats(() => 0);
    s.mark('reply');
    expect(s.snapshot()).toMatchObject({ turns: 0, last: null });
    s.start(1, 'typed');
    s.start(2, 'typed');
    s.end('replied');
    s.mark('bubble');
    expect(s.snapshot().last).toMatchObject({ cursor: 2, outcome: 'replied', steps: [] });
  });
});
