import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from 'cortico/core/types.ts';
import { plain, route } from '../src/conductor/routing.ts';

const ev = (type: string, text: string, meta?: Record<string, unknown>): EventEnvelope =>
  ({ cursor: 1, type, source: 'x', origin: 'external', ts: '2026-11-13T10:00:00+08:00', text, ...(meta ? { meta } : {}) }) as EventEnvelope;

/** agent-notify 1.2.0 推出的正文格式 */
const completed = (summary: string, extra: Record<string, unknown> = {}) => ev('coding-agent.completed',
  ['Claude Code 已完成一轮任务。请将它的最终结论总结成一两句话，并用 pet_say 通知用户。', '项目："/Users/me/work/coopet"', '最终结论：', summary].join('\n'),
  { agent: 'claude', workspace: '/Users/me/work/coopet', sessionId: 's', test: false, ...extra });

describe('route', () => {
  it('says a coding agent completion as agent, project and the first sentence of the conclusion', () => {
    expect(route(completed('已把 **设置窗** 换成新版。另外修了两个测试。'), 'auto', 'zh')).toEqual({ say: 'Claude Code 完成了 · coopet：已把 设置窗 换成新版。' });
    expect(route(completed('Done. Tests pass.'), 'auto', 'en')).toEqual({ say: 'Claude Code finished · coopet：Done.' });
  });

  it('cuts a long conclusion and confirms a test report briefly', () => {
    const long = '这是一句非常非常长的结论'.repeat(10);
    const said = (route(completed(long), 'auto', 'zh') as { say: string }).say;
    expect([...said.split('：')[1]].length).toBe(61);
    expect(said.endsWith('…')).toBe(true);
    expect(route(completed('x', { test: true }), 'auto', 'zh')).toEqual({ say: 'Claude Code 的完成通知通了' });
  });

  it('skips unknown events on auto, reads their start on pet, and does nothing on off', () => {
    const other = ev('rss.new_items', '请总结以下新文章并用 pet_say 告诉用户：' + 'x'.repeat(200));
    expect(route(other, 'auto', 'zh')).toEqual({ skip: 'no-renderer' });
    const said = (route(other, 'pet', 'zh') as { say: string }).say;
    expect(said.startsWith('请总结以下新文章')).toBe(true);
    expect([...said].length).toBe(81);
    expect(route(completed('x'), 'off', 'zh')).toEqual({ skip: 'off' });
  });
});

describe('plain', () => {
  it('drops markdown and swaps brackets the pet script would treat as action markers', () => {
    expect(plain('# 标题\n`code` 【开心】 <smile> ＜b＞ [链接](http://x)\n```\nblock\n```')).toBe('标题 code 〖开心〗 ‹smile› ﹤b﹥ 链接');
  });
});
