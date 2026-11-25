import { describe, expect, it } from 'vitest';
import { clampWidth } from './useColumnWidth.js';

describe('clampWidth', () => {
  it('keeps a width inside the range', () => {
    expect(clampWidth(350, 200, 600)).toBe(350);
  });
  it('clamps below min and above max', () => {
    expect(clampWidth(50, 200, 600)).toBe(200);
    expect(clampWidth(900, 200, 600)).toBe(600);
  });
  it('lets max win when the range is inverted (narrow window)', () => {
    expect(clampWidth(300, 200, 150)).toBe(150);
  });
  it('rounds to whole pixels', () => {
    expect(clampWidth(312.6, 200, 600)).toBe(313);
  });
});
