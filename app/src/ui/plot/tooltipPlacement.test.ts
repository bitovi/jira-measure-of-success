import { describe, expect, it } from 'vitest';
import { tooltipPlacement } from './tooltipPlacement.js';

/** The tooltip's horizontal extent at its maximum width. */
const extent = (p: ReturnType<typeof tooltipPlacement>, vw: number): [number, number] =>
  p.left !== undefined ? [p.left, p.left + p.maxWidth] : [vw - p.right! - p.maxWidth, vw - p.right!];

describe('tooltipPlacement', () => {
  it('sits right of the cursor when there is room', () => {
    expect(tooltipPlacement(100, 1200)).toEqual({ left: 114, maxWidth: 400 });
  });

  it('flips left near the right edge', () => {
    expect(tooltipPlacement(1100, 1200)).toEqual({ right: 114, maxWidth: 400 });
  });

  it('in a 600px frame at x=200, stays inside the viewport by capping the width (review: PR #3)', () => {
    const p = tooltipPlacement(200, 600);
    expect(p).toEqual({ left: 214, maxWidth: 378 });
    const [from, to] = extent(p, 600);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeLessThanOrEqual(600);
  });

  it('uses the roomier side when neither fits the full width', () => {
    expect(tooltipPlacement(400, 600)).toEqual({ right: 214, maxWidth: 378 });
  });

  it('spans a very narrow viewport rather than overflowing it', () => {
    const p = tooltipPlacement(160, 320);
    expect(p).toEqual({ left: 8, maxWidth: 304 });
    const [from, to] = extent(p, 320);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeLessThanOrEqual(320);
  });

  it('never overflows for any cursor position', () => {
    for (const vw of [320, 480, 600, 800, 1280]) {
      for (let x = 0; x <= vw; x += 10) {
        const [from, to] = extent(tooltipPlacement(x, vw), vw);
        expect(from).toBeGreaterThanOrEqual(0);
        expect(to).toBeLessThanOrEqual(vw);
      }
    }
  });
});
