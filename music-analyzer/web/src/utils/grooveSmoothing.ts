/**
 * PixiJS 의존 없이 사용할 수 있는 그루브(곡선) 스무딩 유틸.
 * - 입력 점들을 지나가는 Catmull-Rom(Bezier 변환) 기반 보간
 * - 에너지(e)도 동일하게 선형 보간
 */
export type GroovePoint = { x: number; y: number; e: number };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function sampleCubicBezier(
  p1: { x: number; y: number },
  cp1: { x: number; y: number },
  cp2: { x: number; y: number },
  p2: { x: number; y: number },
  t: number
): { x: number; y: number } {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: mt3 * p1.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t3 * p2.x,
    y: mt3 * p1.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t3 * p2.y,
  };
}

/**
 * 입력 점들을 지나가는 부드러운 점열을 반환합니다.
 * - points 길이가 2 이하이면 선형 보간(에너지 포함)
 */
export function smoothGroovePoints(
  points: GroovePoint[],
  samplesPerSegment: number = 10,
  tension: number = 0.35
): GroovePoint[] {
  if (points.length < 2) return points;
  if (points.length === 2) {
    const [a, b] = points;
    if (!a || !b) return points;
    const out: GroovePoint[] = [a];
    for (let k = 1; k < samplesPerSegment; k++) {
      const t = k / samplesPerSegment;
      out.push({
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        e: lerp(a.e, b.e, t),
      });
    }
    out.push(b);
    return out;
  }

  const n = points.length;
  const result: GroovePoint[] = [points[0]!];

  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? points[i + 1]!;

    const cp1 = {
      x: p1.x + (p2.x - p0.x) / (6 * tension),
      y: p1.y + (p2.y - p0.y) / (6 * tension),
    };
    const cp2 = {
      x: p2.x - (p3.x - p1.x) / (6 * tension),
      y: p2.y - (p3.y - p1.y) / (6 * tension),
    };

    for (let k = 1; k < samplesPerSegment; k++) {
      const t = k / samplesPerSegment;
      const pos = sampleCubicBezier(
        { x: p1.x, y: p1.y },
        cp1,
        cp2,
        { x: p2.x, y: p2.y },
        t
      );
      result.push({
        x: pos.x,
        y: pos.y,
        e: lerp(p1.e, p2.e, t),
      });
    }
    result.push(p2);
  }

  return result;
}

