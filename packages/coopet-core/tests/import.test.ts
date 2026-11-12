import { describe, expect, it } from 'vitest';

// 耦合点 1：桌宠 World 连同它的 cortico/* 导入能在本包里加载。
describe('desktop-pet World import', () => {
  it('loads DesktopPetWorld and its defaults', async () => {
    const pet = await import('cortico-world-desktop-pet');
    expect(typeof pet.DesktopPetWorld).toBe('function');
    expect(pet.DESKTOP_PET_DEFAULTS.port).toBe(7797);
  });
});
