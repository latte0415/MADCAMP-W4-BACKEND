/**
 * 브러시 스트립(가변 폭 곡선) Mesh 빌더.
 * GroovePoint[] → vertices/indices/uvs → PixiJS MeshGeometry + Shader.
 */

import { Buffer, BufferUsage, Geometry, Mesh, MeshGeometry, Shader } from "pixi.js";

/** 화면 좌표 + 에너지 (e: 0~1) */
export type GroovePoint = { x: number; y: number; e: number };

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Catmull-Rom 스플라인으로 곡선을 부드럽게 하여 더 많은 점 반환 (점을 지나는 붓질 형태) */
const SPLINE_TENSION = 0.35;

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
 * GroovePoint[]를 Catmull-Rom 스플라인으로 보간해 부드러운 곡선 위의 점들을 반환.
 * 원본 점을 지나가서 형태가 포인트와 맞게 됨.
 */
export function smoothGroovePoints(
  points: GroovePoint[],
  samplesPerSegment: number = 12
): GroovePoint[] {
  if (points.length < 2) return points;
  if (points.length === 2) {
    const [a, b] = points;
    const out: GroovePoint[] = [a!];
    for (let k = 1; k < samplesPerSegment; k++) {
      const t = k / samplesPerSegment;
      out.push({
        x: lerp(a!.x, b!.x, t),
        y: lerp(a!.y, b!.y, t),
        e: lerp(a!.e, b!.e, t),
      });
    }
    out.push(b!);
    return out;
  }

  const n = points.length;
  const result: GroovePoint[] = [points[0]!];

  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(n - 1, i + 2)]!;

    const cp1 = {
      x: p1.x + (p2.x - p0.x) / (6 * SPLINE_TENSION),
      y: p1.y + (p2.y - p0.y) / (6 * SPLINE_TENSION),
    };
    const cp2 = {
      x: p2.x - (p3.x - p1.x) / (6 * SPLINE_TENSION),
      y: p2.y - (p3.y - p1.y) / (6 * SPLINE_TENSION),
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

export interface BuildBrushStripOpt {
  wMin: number;
  wMax: number;
  energyGamma: number;
  wobbleAmp: number;
  wobbleFreq: number;
  /**
   * 국소 포인트 간격 대비 최대 폭 상한 비율.
   * 샘플링이 촘촘한 구간(짧은 간격)에서 폭이 과해져 덩이짐/자기교차가 나는 것을 방지.
   */
  maxWidthToLocalScaleRatio: number;
}

const DEFAULT_STRIP_OPT: BuildBrushStripOpt = {
  wMin: 0.5,
  wMax: 10,
  energyGamma: 1,
  wobbleAmp: 0,
  wobbleFreq: 0.02,
  maxWidthToLocalScaleRatio: 2.2,
};

export interface BrushStripData {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export interface BrushRibbonData {
  geometry: Geometry;
}

/**
 * GroovePoint[]로부터 삼각형 스트립 geometry 데이터 생성.
 * 각 점에서 접선 → 법선, 두께 = lerp(wMin, wMax, pow(e, energyGamma)) + wobble.
 */
export function buildBrushStrip(
  points: GroovePoint[],
  opt: Partial<BuildBrushStripOpt> = {}
): BrushStripData {
  const { wMin, wMax, energyGamma, wobbleAmp, wobbleFreq, maxWidthToLocalScaleRatio } = {
    ...DEFAULT_STRIP_OPT,
    ...opt,
  };

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  if (points.length < 2) {
    return {
      positions: new Float32Array(positions),
      uvs: new Float32Array(uvs),
      indices: new Uint32Array(indices),
    };
  }

  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const prev = points[i - 1] ?? p;
    const next = points[i + 1] ?? p;
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1e-6;
    const nx = -ty / len;
    const ny = tx / len;

    const eClamped = clamp(p.e, 0, 1);
    // 두께(에너지 기반) + wobble
    let w =
      lerp(wMin, wMax, Math.pow(eClamped, energyGamma)) +
      (i % 2 === 0 ? 1 : -1) * wobbleAmp * Math.sin(p.x * wobbleFreq + i * 0.7);

    // 샘플링이 촘촘한 구간에서 폭이 커지면 스트립이 겹치며 "덩이"처럼 보임 → 국소 간격 기반 폭 상한
    // (i±2를 사용해 과도하게 작은 간격으로 폭이 줄어드는 것도 완화)
    const pBack = points[i - 2] ?? prev;
    const pFwd = points[i + 2] ?? next;
    const dBack = Math.hypot(p.x - pBack.x, p.y - pBack.y);
    const dFwd = Math.hypot(pFwd.x - p.x, pFwd.y - p.y);
    const localScale = Math.max(1e-3, (dBack + dFwd) * 0.5);
    const wMaxLocal = localScale * maxWidthToLocalScaleRatio;
    if (Number.isFinite(wMaxLocal)) w = Math.min(w, wMaxLocal);

    const halfW = w / 2;

    const lx = p.x - nx * halfW;
    const ly = p.y - ny * halfW;
    const rx = p.x + nx * halfW;
    const ry = p.y + ny * halfW;

    positions.push(lx, ly, rx, ry);
    uvs.push(0, 0, 1, 1);
  }

  const numVerts = n * 2;
  for (let idx = 0; idx < numVerts - 2; idx += 2) {
    indices.push(idx, idx + 1, idx + 2);
    indices.push(idx + 1, idx + 3, idx + 2);
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  };
}

const RIBBON_VERTEX = `
attribute vec2 aCenter;
attribute vec2 aNormal;
attribute float aSide;
attribute float aHalfWidth;
attribute float aEnergy;
attribute float aU;
varying float vSide;
varying float vEnergy;
varying float vU;
uniform vec2 uResolution;
void main() {
  vSide = aSide;         // -1..+1
  vEnergy = aEnergy;     // 0..1
  vU = aU;               // 0..1 (stroke progress)
  vec2 pos = aCenter + aNormal * (aSide * aHalfWidth);
  vec2 ndc = (pos / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}
`;

const RIBBON_FRAGMENT = `
precision mediump float;
varying float vSide;
varying float vEnergy;
varying float vU;
uniform vec4 uColor;
uniform vec3 uHighlightColor;
uniform float uFeather;
uniform float uEnergyAlpha;
uniform float uStreakFreq;
uniform float uStreakStrength;
uniform float uFrayStrength;
uniform float uTailFrayBoost;
uniform float uHighlightStrength;
uniform float uHighlightEnd;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise21(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
void main() {
  float edge = abs(vSide);
  float featherA = 1.0 - smoothstep(1.0 - uFeather, 1.0, edge);
  float energyA = mix(1.0, vEnergy, uEnergyAlpha);
  float baseA = uColor.a * featherA * energyA;

  float n = noise21(vec2(vU * uStreakFreq, edge * 4.0));
  float streak = 0.5 + 0.5 * sin(vU * 20.0 + n * 6.28 + vSide * 0.8);
  float streakA = mix(0.92, 1.05, streak * uStreakStrength);
  float edgeMask = smoothstep(0.6, 1.0, edge);
  float tail = smoothstep(0.7, 1.0, vU);
  float frayN = noise21(vec2(vU * 12.0, edge * 16.0));
  float frayA = 1.0 - edgeMask * uFrayStrength * (0.2 + 0.4 * tail * uTailFrayBoost) * clamp(frayN, 0.0, 1.0);
  float startMask = 1.0 - smoothstep(0.0, max(0.01, uHighlightEnd), vU);
  float centerMask = 1.0 - smoothstep(0.4, 0.9, edge);
  float hl = startMask * centerMask * uHighlightStrength;

  vec3 base = uColor.rgb * streakA;
  vec3 col = mix(base, uHighlightColor, hl);
  float a = baseA * clamp(frayA, 0.5, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

/**
 * 다음 단계: center line 기반 Brush Ribbon.
 * - CPU: center/normal/halfWidth/energy만 생성
 * - GPU(vertex): normal 방향으로 좌우 extrude
 * - GPU(fragment): side 기반 feather + energy 기반 alpha
 */
export function buildBrushRibbon(
  points: GroovePoint[],
  opt: Partial<BuildBrushStripOpt> = {}
): BrushRibbonData {
  const { wMin, wMax, energyGamma, wobbleAmp, wobbleFreq, maxWidthToLocalScaleRatio } = {
    ...DEFAULT_STRIP_OPT,
    ...opt,
  };

  if (points.length < 2) {
    return { geometry: new Geometry() };
  }

  const n = points.length;
  // 2 verts per point
  const centers = new Float32Array(n * 2 * 2);   // x,y
  const normals = new Float32Array(n * 2 * 2);   // nx,ny
  const sides = new Float32Array(n * 2);         // -1,+1
  const halfWidths = new Float32Array(n * 2);    // half width in px
  const energies = new Float32Array(n * 2);      // 0..1
  const us = new Float32Array(n * 2);            // 0..1 stroke progress
  const indices = new Uint32Array((n * 2 - 2) * 3); // (numVerts-2)/2 * 6 == (n-1)*6

  // build verts
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const prev = points[i - 1] ?? p;
    const next = points[i + 1] ?? p;
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1e-6;
    let nx = -ty / len;
    let ny = tx / len;

    // 두께(에너지 기반) + wobble
    const eClamped = clamp(p.e, 0, 1);
    let w =
      lerp(wMin, wMax, Math.pow(eClamped, energyGamma)) +
      (i % 2 === 0 ? 1 : -1) * wobbleAmp * Math.sin(p.x * wobbleFreq + i * 0.7);

    // 국소 스케일 기반 폭 상한
    const pBack = points[i - 2] ?? prev;
    const pFwd = points[i + 2] ?? next;
    const dBack = Math.hypot(p.x - pBack.x, p.y - pBack.y);
    const dFwd = Math.hypot(pFwd.x - p.x, pFwd.y - p.y);
    const localScale = Math.max(1e-3, (dBack + dFwd) * 0.5);
    w = Math.min(w, localScale * maxWidthToLocalScaleRatio);

    const hw = w * 0.5;

    // write 2 verts (L/R) with same center/normal/energy/halfWidth
    const v0 = i * 2;
    const u = n > 1 ? i / (n - 1) : 0;
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      const vi = v0 + s;
      centers[vi * 2 + 0] = p.x;
      centers[vi * 2 + 1] = p.y;
      normals[vi * 2 + 0] = nx;
      normals[vi * 2 + 1] = ny;
      sides[vi] = side;
      halfWidths[vi] = hw;
      energies[vi] = eClamped;
      us[vi] = u;
    }
  }

  // indices (same topology as strip)
  let ii = 0;
  const numVerts = n * 2;
  for (let idx = 0; idx < numVerts - 2; idx += 2) {
    indices[ii++] = idx;
    indices[ii++] = idx + 1;
    indices[ii++] = idx + 2;
    indices[ii++] = idx + 1;
    indices[ii++] = idx + 3;
    indices[ii++] = idx + 2;
  }

  // Geometry: use explicit Buffers so formats are correct
  const geometry = new Geometry({
    attributes: {
      aCenter: {
        buffer: new Buffer({ data: centers, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }),
        format: "float32x2",
        stride: 2 * 4,
        offset: 0,
      },
      aNormal: {
        buffer: new Buffer({ data: normals, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }),
        format: "float32x2",
        stride: 2 * 4,
        offset: 0,
      },
      aSide: {
        buffer: new Buffer({ data: sides, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }),
        format: "float32",
        stride: 1 * 4,
        offset: 0,
      },
      aHalfWidth: {
        buffer: new Buffer({ data: halfWidths, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }),
        format: "float32",
        stride: 1 * 4,
        offset: 0,
      },
      aEnergy: {
        buffer: new Buffer({ data: energies, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }),
        format: "float32",
        stride: 1 * 4,
        offset: 0,
      },
      aU: {
        buffer: new Buffer({ data: us, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }),
        format: "float32",
        stride: 1 * 4,
        offset: 0,
      },
    },
    indexBuffer: new Buffer({ data: indices, usage: BufferUsage.INDEX | BufferUsage.COPY_DST }),
    topology: "triangle-list",
  });

  return { geometry };
}

export function createBrushRibbonMesh(
  data: BrushRibbonData,
  color: number,
  width: number,
  height: number,
  alpha: number = 1,
  feather: number = 0.35,
  energyAlpha: number = 0.6
): Mesh<Geometry, Shader> {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;

  const shader = Shader.from({
    gl: { vertex: RIBBON_VERTEX, fragment: RIBBON_FRAGMENT },
    resources: {
      uResolution: { uResolution: { value: [width, height], type: "vec2<f32>" } },
      uColor: { uColor: { value: [r, g, b, alpha], type: "vec4<f32>" } },
      // warm highlight like the example image (yellow/orange)
      uHighlightColor: { uHighlightColor: { value: [1.0, 0.72, 0.18], type: "vec3<f32>" } },
      uFeather: { uFeather: { value: feather, type: "f32" } },
      uEnergyAlpha: { uEnergyAlpha: { value: energyAlpha, type: "f32" } },
      uStreakFreq: { uStreakFreq: { value: 14.0, type: "f32" } },
      uStreakStrength: { uStreakStrength: { value: 0.85, type: "f32" } },
      uFrayStrength: { uFrayStrength: { value: 0.65, type: "f32" } },
      uTailFrayBoost: { uTailFrayBoost: { value: 1.35, type: "f32" } },
      uHighlightStrength: { uHighlightStrength: { value: 0.0, type: "f32" } },
      uHighlightEnd: { uHighlightEnd: { value: 0.0, type: "f32" } },
    },
  });

  return new Mesh({ geometry: data.geometry, shader });
}

const BRUSH_VERTEX = `
attribute vec2 aPosition;
attribute vec2 aUV;
varying vec2 vUV;
uniform vec2 uResolution;
void main() {
  vUV = aUV;
  vec2 ndc = (aPosition / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}
`;

const BRUSH_FRAGMENT = `
precision mediump float;
varying vec2 vUV;
uniform vec4 uColor;
uniform float uFeather;
void main() {
  // vUV.x: 0(좌)~1(우). 중심(0.5)에서 가장자리까지 거리 기반 feather
  float edge = abs(vUV.x - 0.5) * 2.0; // 0(center)~1(edge)
  float a = 1.0 - smoothstep(1.0 - uFeather, 1.0, edge);
  gl_FragColor = vec4(uColor.rgb, uColor.a * a);
}
`;

/**
 * BrushStripData + 색상으로 PixiJS Mesh 생성.
 * width/height는 쉐이더 NDC 변환용.
 */
export function createBrushMesh(
  data: BrushStripData,
  color: number,
  width: number,
  height: number,
  alpha: number = 1
): Mesh<MeshGeometry, Shader> {
  const geometry = new MeshGeometry({
    positions: data.positions,
    uvs: data.uvs,
    indices: data.indices,
  });

  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;

  const shader = Shader.from({
    gl: {
      vertex: BRUSH_VERTEX,
      fragment: BRUSH_FRAGMENT,
    },
    resources: {
      // Shader가 기대하는 uniform 이름(uResolution/uColor)과 resources 키를 1:1로 맞춘다.
      // Pixi v8 Shader는 resources 값이 단순 객체이면 내부에서 UniformGroup으로 감싸 동기화한다.
      // (직접 UniformGroup 인스턴스를 넘기면 일부 케이스에서 WebGL 동기화가 꼬일 수 있어 단순 객체 형태로 고정)
      uResolution: {
        uResolution: { value: [width, height], type: "vec2<f32>" },
      },
      uColor: {
        uColor: { value: [r, g, b, alpha], type: "vec4<f32>" },
      },
      uFeather: {
        uFeather: { value: 0.35, type: "f32" },
      },
    },
  });

  const mesh = new Mesh({ geometry, shader });
  return mesh;
}
