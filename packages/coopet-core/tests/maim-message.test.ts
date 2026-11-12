import { describe, expect, it } from 'vitest';
import { buildTextMessage, flattenText, isMessageBase } from '../src/link/maim-message.ts';

describe('maim message', () => {
  it('builds a private text message with top-level routing fields', () => {
    const m = buildTextMessage({ platform: 'coopet', botAccount: 'coopet-maibot', user: { id: 'owner', nickname: '主人' }, text: '你好' });
    expect(m.account_id).toBe('coopet-maibot');
    expect(m.scope).toBeNull();
    expect(m.message_info.platform).toBe('coopet');
    expect(m.message_info.message_id).toMatch(/^coopet-[0-9a-f-]{36}$/);
    expect(m.message_info.user_info).toEqual({ platform: 'coopet', user_id: 'owner', user_nickname: '主人' });
    expect(m.message_info.group_info).toBeUndefined();
    expect(m.message_segment).toEqual({ type: 'seglist', data: [{ type: 'text', data: '你好' }] });
    expect(typeof m.message_info.time).toBe('number');
  });

  it('recognizes a MessageBase and flattens its text', () => {
    const m = { message_info: {}, message_segment: { type: 'seglist', data: [{ type: 'text', data: 'a' }, { type: 'image', data: 'xx' }, { type: 'text', data: 'b' }] } };
    expect(isMessageBase(m)).toBe(true);
    expect(isMessageBase({ message_info: null, message_segment: {} })).toBe(false);
    expect(isMessageBase('x')).toBe(false);
    expect(flattenText(m.message_segment)).toBe('a[image]b');
  });
});
