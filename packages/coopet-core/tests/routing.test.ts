import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from 'cortico/core/types.ts';
import { plain, route } from '../src/conductor/routing.ts';
import { ROUTE_DEFAULTS, type RouteSettings } from '../src/runtime/config.ts';

const R = (over: Partial<RouteSettings> = {}): RouteSettings => ({ ...ROUTE_DEFAULTS, ...over });

const ev = (type: string, text: string, meta?: Record<string, unknown>): EventEnvelope =>
  ({ cursor: 1, type, source: 'x', origin: 'external', ts: '2026-11-13T10:00:00+08:00', text, ...(meta ? { meta } : {}) }) as EventEnvelope;

/** agent-notify 1.2.0 推出的正文格式 */
const completed = (summary: string, extra: Record<string, unknown> = {}) => ev('coding-agent.completed',
  ['Claude Code 已完成一轮任务。请将它的最终结论总结成一两句话，并用 pet_say 通知用户。', '项目："/Users/me/work/coopet"', '最终结论：', summary].join('\n'),
  { agent: 'claude', workspace: '/Users/me/work/coopet', sessionId: 's', test: false, ...extra });

describe('route', () => {
  it('says a coding agent completion as agent, project and the first sentence of the conclusion', () => {
    expect(route(completed('已把 **设置窗** 换成新版。另外修了两个测试。'), R(), 'zh')).toEqual({ say: 'Claude Code 完成了 · coopet：已把 设置窗 换成新版。', to: 'pet' });
    expect(route(completed('Done. Tests pass.'), R(), 'en')).toEqual({ say: 'Claude Code finished · coopet：Done.', to: 'pet' });
  });

  it('cuts a long conclusion and confirms a test report briefly', () => {
    const long = '这是一句非常非常长的结论'.repeat(10);
    const said = (route(completed(long), R(), 'zh') as { say: string }).say;
    // 结论先截到 60 字，整条再截到 maxChars（默认 80）
    expect([...said].length).toBe(81);
    expect(said.endsWith('…')).toBe(true);
    expect(route(completed('x', { test: true }), R(), 'zh')).toEqual({ say: 'Claude Code 的完成通知通了', to: 'pet' });
  });

  it('cuts what it says to the configured length', () => {
    const said = (route(completed('这是一句很长的结论，'.repeat(5) + '。'), R({ maxChars: 20 }), 'zh') as { say: string }).say;
    expect([...said].length).toBe(21);
    expect(said.endsWith('…')).toBe(true);
  });

  it('sends known notifications where the mode says, and nowhere when off', () => {
    expect(route(completed('好。'), R({ mode: 'maibot' }), 'zh')).toMatchObject({ to: 'maibot' });
    expect(route(completed('好。'), R({ mode: 'off' }), 'zh')).toEqual({ skip: 'off' });
  });

  it('follows the category the extension gives on rules, and the pet without one', () => {
    expect(route(completed('好。', { route: 'maibot' }), R({ mode: 'rule' }), 'zh')).toMatchObject({ to: 'maibot' });
    expect(route(completed('好。', { route: 'off' }), R({ mode: 'rule' }), 'zh')).toEqual({ skip: 'rule-off' });
    expect(route(completed('好。'), R({ mode: 'rule' }), 'zh')).toMatchObject({ to: 'pet' });
    // 不是 rule 模式时不看事件里的分类
    expect(route(completed('好。', { route: 'off' }), R({ mode: 'pet' }), 'zh')).toMatchObject({ to: 'pet' });
  });

  it('says an ntfy notice as label, title and message, and follows the topic route on rules', () => {
    const n = (meta: Record<string, unknown>) => ev('ntfy.message', 'ntfy 话题收到一条通知……', { topic: 'build_x', label: 'build', route: 'off', ...meta });
    expect(route(n({ title: 'CI', message: '构建 **完成**' }), R(), 'zh')).toEqual({ say: 'build：CI：构建 完成', to: 'pet' });
    expect(route(n({ message: '好了' }), R(), 'zh')).toEqual({ say: 'build：好了', to: 'pet' });
    expect(route(n({ message: '好了' }), R({ mode: 'rule' }), 'zh')).toEqual({ skip: 'rule-off' });
    expect(route(n({ message: '' }), R(), 'zh')).toEqual({ skip: 'empty' });
  });

  it('handles unknown notifications by their own setting', () => {
    const other = ev('rss.new_items', '请总结以下新文章并用 pet_say 告诉用户：' + 'x'.repeat(200));
    expect(route(other, R(), 'zh')).toEqual({ skip: 'no-renderer' });
    const said = route(other, R({ unknown: 'pet' }), 'zh') as { say: string; to: string };
    expect(said.say.startsWith('请总结以下新文章')).toBe(true);
    expect([...said.say].length).toBe(81);
    expect(said.to).toBe('pet');
    expect(route(other, R({ unknown: 'maibot', mode: 'pet' }), 'zh')).toMatchObject({ to: 'maibot' });
    expect(route(other, R({ unknown: 'pet', mode: 'off' }), 'zh')).toEqual({ skip: 'off' });
  });
});

describe('plain', () => {
  it('drops markdown and swaps brackets the pet script would treat as action markers', () => {
    expect(plain('# 标题\n`code` 【开心】 <smile> ＜b＞ [链接](http://x)\n```\nblock\n```')).toBe('标题 code 〖开心〗 ‹smile> ﹤b＞ 链接');
  });
});
