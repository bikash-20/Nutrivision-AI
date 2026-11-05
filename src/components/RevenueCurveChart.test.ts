import { describe, expect, it } from 'vitest';
import { getResponsiveChartFontSize, pointsToCatmullRomBezierPath } from './RevenueCurveChart';

describe('RevenueCurveChart responsive typography', () => {
  it('keeps axis labels at a readable size on narrow charts', () => {
    expect(getResponsiveChartFontSize(300) * (300 / 600)).toBeCloseTo(11);
  });

  it('keeps the normal chart font size on standard-width charts', () => {
    expect(getResponsiveChartFontSize(600)).toBe(11);
  });

  it('caps the rendered font size on wider charts', () => {
    expect(getResponsiveChartFontSize(1200) * (1200 / 600)).toBe(13);
  });

  it('uses a sensible size before the chart width is measured', () => {
    expect(getResponsiveChartFontSize(0)).toBe(11);
  });
});

describe('RevenueCurveChart Catmull-Rom spline calculations', () => {
  it('handles empty points array gracefully', () => {
    expect(pointsToCatmullRomBezierPath([])).toBe('');
  });

  it('handles single point as M move command', () => {
    expect(pointsToCatmullRomBezierPath([{ x: 10, y: 20 }])).toBe('M 10.0 20.0');
  });

  it('generates smooth cubic bezier path for multiple points', () => {
    const points = [
      { x: 0, y: 100 },
      { x: 50, y: 80 },
      { x: 100, y: 40 },
      { x: 150, y: 20 },
    ];
    const path = pointsToCatmullRomBezierPath(points);
    expect(path).toContain('M 0.0 100.0');
    expect(path).toContain('C ');
    // Expect 3 Bezier segments
    const segmentCount = (path.match(/ C /g) || []).length;
    expect(segmentCount).toBe(3);
  });
});
