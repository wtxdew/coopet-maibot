// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const R = require('../settings/render.js');

describe('renderField', () => {
  it('renders a checkbox for booleans and reports changes', () => {
    const onChange = vi.fn();
    const row = R.renderField(document, 'worlds.desktop-pet.rememberPosition', { type: 'boolean', title: '记住位置', 'x-hot': true }, false, onChange);
    const box = row.querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(row.querySelector('.field-title')!.textContent).toBe('记住位置');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('renders a select with Chinese labels for known enums', () => {
    const onChange = vi.fn();
    const row = R.renderField(document, 'worlds.desktop-pet.roam', { type: 'string', title: '走动', enum: ['free', 'calm', 'off'], 'x-hot': true }, 'calm', onChange);
    const select = row.querySelector('select') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['常走动', '多待着', '不乱动']);
    expect(select.value).toBe('calm');
    select.value = 'off';
    select.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('off');
  });

  it('renders a slider and number for a ranged number, with description and suffix', () => {
    const onChange = vi.fn();
    const prop = { type: 'number', title: '大小', minimum: 0.5, maximum: 3, multipleOf: 0.05, 'x-hot': true, 'x-suffix': '倍', description: '桌宠的大小' };
    const row = R.renderField(document, 'worlds.desktop-pet.window.scale', prop, 1, onChange);
    const range = row.querySelector('input[type=range]') as HTMLInputElement;
    const number = row.querySelector('input[type=number]') as HTMLInputElement;
    expect([range.min, range.max, range.step, number.value]).toEqual(['0.5', '3', '0.05', '1']);
    expect(row.querySelector('.suffix')!.textContent).toBe('倍');
    expect(row.querySelector('.field-desc')!.textContent).toBe('桌宠的大小');
    number.value = '1.5';
    number.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenLastCalledWith(1.5);
    expect(range.value).toBe('1.5');
  });

  it('marks settings that need a restart and converts x-scale values', () => {
    const onChange = vi.fn();
    const row = R.renderField(document, 'k', { type: 'integer', title: '超时', 'x-scale': 1000, 'x-hot': false }, 20000, onChange);
    expect(row.querySelector('.field-title')!.textContent).toBe('超时（重启核心后生效）');
    const number = row.querySelector('input[type=number]') as HTMLInputElement;
    expect(number.value).toBe('20');
    number.value = '30';
    number.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith(30000);
  });
});

describe('chatLine', () => {
  const names = { user: '老板', bot: '麦麦' };
  it.each([
    [{ kind: 'user', cursor: 1, ts: '', via: 'bubble', text: '你好' }, { side: 'user', who: '老板', text: '你好' }],
    [{ kind: 'user', cursor: 2, ts: '', via: 'voice', text: '在吗' }, { side: 'user', who: '老板（语音）', text: '在吗' }],
    [{ kind: 'say', cursor: 3, ts: '', beats: [{ text: '在呢', mood: { zh: '开心' } }, { text: '～' }] }, { side: 'pet', who: '麦麦（开心）', text: '在呢～' }],
    [{ kind: 'touch', cursor: 4, ts: '', touch: { kind: 'poke', count: 3, woke: false, crashed: false } }, { side: 'note', text: '老板戳了戳 ×3' }],
    [{ kind: 'figure', cursor: 5, ts: '', figure: { kind: 'dress', name: { zh: '女仆装' } } }, { side: 'note', text: '换了装扮：女仆装' }],
  ])('%#', (item, expected) => {
    expect(R.chatLine(item, names)).toMatchObject({ ...expected, cursor: item.cursor });
  });

  it('skips kinds it does not show', () => {
    expect(R.chatLine({ kind: 'activity', cursor: 9, ts: '', steps: [], ms: 0 }, names)).toBeNull();
  });
});

describe('shortTime', () => {
  it('shows HH:MM today and the date on other days', () => {
    const now = new Date(2026, 10, 13, 12, 0);
    expect(R.shortTime(new Date(2026, 10, 13, 9, 5).toISOString(), now)).toBe('09:05');
    expect(R.shortTime(new Date(2026, 10, 12, 23, 30).toISOString(), now)).toBe('11-12 23:30');
    expect(R.shortTime('bad', now)).toBe('');
  });
});
