import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import type {
  StreamsSectionsData,
  BassNote,
  BassCurveV3Point,
  GrooveCurvePoint,
} from "../types/streamsSections";

/** 트랙 1: 파형 / 트랙 2: 피치 (분리) */
const WAVEFORM_HEIGHT = 120;
const PITCH_STRIP_HEIGHT = 160;
/** 그루브 밀도 곡선 스트립 높이 (y = 0~1 밀도) */
const GROOVE_STRIP_HEIGHT = 100;
const DEFAULT_MIN_PX_PER_SEC = 50;
const ZOOM_FACTOR = 1.5;
const MIN_ZOOM = 10;
const MAX_ZOOM = 500;

/** 포인트/원이 잘리지 않도록 상하 여백 (픽셀) */
const PADDING_VERTICAL = 12;

const BASS_PITCH_HZ_MIN = 50;
const BASS_PITCH_HZ_MAX = 250;

/** v3 곡선 두께 스케일 (amp 0~1 → stroke 픽셀) */
const V3_AMP_STROKE_SCALE = 10;
/** 그루브 곡선: stroke-width = base + value * scale */
const GROOVE_STROKE_BASE = 2;
const GROOVE_STROKE_SCALE = 24;
/** 가로 그루브 곡선: Catmull-Rom tension (높을수록 곡선이 더 부드러움) */
const GROOVE_CURVE_TENSION = 0.5;
/** 흐름 클러스터링: "끝나는 음" 판정 — 이 값 미만일 때만 후보 (낮을수록 끊김 적음) */
const GROOVE_ENDING_DECAY_THRESHOLD = 0.2;
/** 끊을지 말지: 끝나는 음 + 이 갭(초) 초과일 때만 끊음. 클수록 전부 연결에 가깝게 */
const GROOVE_GAP_AFTER_ENDING_SEC = 0.55;
/** 이 갭(초) 초과면 무조건 새 호흡 (긴 쉼 = 호흡 경계) */
const GROOVE_LONG_REST_SEC = 1.0;
/** 한 호흡 최대 길이(초); 초과 시 다음 음부터 새 클러스터 */
const GROOVE_MAX_BREATH_DURATION_SEC = 10;
/** 피치 감소가 이 반음 수 이상이면 끊음 (너무 길게 이어지지 않게) */
const GROOVE_PITCH_DROP_SPLIT_SEMITONES = 4;
/** 그루브 선 두께: 포인트를 감싸는 넓은 띠처럼 */
const GROOVE_STROKE_WIDTH = 22;
/** 잔향 꼬리: 마지막 decay_ratio가 이 값 초과면 꼬리 그림 */
const GROOVE_TAIL_DECAY_THRESHOLD = 0.55;
/** 꼬리 세그먼트 기본 길이(픽셀), decay에 따라 스케일됨 */
const GROOVE_TAIL_SEGMENT_LEN_BASE = 18;
/** 꼬리 세그먼트 최대 개수(decay 1에 가까울수록 증가) */
const GROOVE_TAIL_MAX_SEGMENTS = 5;
/** decay에 따른 꼬리 세그먼트 개수·길이·두께 비율 계산 */
function getTailParams(decay: number): { segmentCount: number; segmentLen: number; strokeRatios: number[] } {
  const t = Math.max(0, (decay - GROOVE_TAIL_DECAY_THRESHOLD) / (1 - GROOVE_TAIL_DECAY_THRESHOLD));
  const segmentCount = Math.min(GROOVE_TAIL_MAX_SEGMENTS, 2 + Math.floor(t * 3));
  const segmentLen = GROOVE_TAIL_SEGMENT_LEN_BASE * (0.7 + 0.5 * decay);
  const pool = [0.65, 0.45, 0.28, 0.15, 0.06];
  const strokeRatios = pool.slice(0, segmentCount);
  return { segmentCount, segmentLen, strokeRatios };
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const NOTE_MARKER_COLOR = "#2ecc71";

type BassViewMode = "v2" | "v3";

/** Catmull-Rom 세그먼트(p1→p2) 위 한 점. t∈[0,1]. */
function sampleCubicSegment(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p0: { x: number; y: number },
  p3: { x: number; y: number },
  tension: number,
  t: number
): { x: number; y: number } {
  const cp1x = p1.x + (p2.x - p0.x) / (6 * tension);
  const cp1y = p1.y + (p2.y - p0.y) / (6 * tension);
  const cp2x = p2.x - (p3.x - p1.x) / (6 * tension);
  const cp2y = p2.y - (p3.y - p1.y) / (6 * tension);
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: mt3 * p1.x + 3 * mt2 * t * cp1x + 3 * mt * t2 * cp2x + t3 * p2.x,
    y: mt3 * p1.y + 3 * mt2 * t * cp1y + 3 * mt * t2 * cp2y + t3 * p2.y,
  };
}

/** 점열을 Catmull-Rom으로 잇는 열린 경로 d. 가로로 이어지는 곡선용. */
function buildSmoothOpenPath(
  points: { x: number; y: number }[],
  tension: number = GROOVE_CURVE_TENSION
): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  const n = points.length;
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(n - 1, i + 2)]!;
    const cp1x = p1.x + (p2.x - p0.x) / (6 * tension);
    const cp1y = p1.y + (p2.y - p0.y) / (6 * tension);
    const cp2x = p2.x - (p3.x - p1.x) / (6 * tension);
    const cp2y = p2.y - (p3.y - p1.y) / (6 * tension);
    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`;
  }
  return d;
}

/** 세그먼트당 샘플 수만큼 보간한 뒤 다시 스무스 경로 생성 (한 클러스터 선을 더 부드럽게). */
const GROOVE_SMOOTH_SAMPLES_PER_SEGMENT = 3;

function buildSmootherOpenPath(
  points: { x: number; y: number }[],
  tension: number = GROOVE_CURVE_TENSION
): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  const n = points.length;
  const expanded: { x: number; y: number }[] = [points[0]!];
  const s = GROOVE_SMOOTH_SAMPLES_PER_SEGMENT;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(n - 1, i + 2)]!;
    for (let k = 1; k < s; k++) {
      expanded.push(sampleCubicSegment(p1, p2, p0, p3, tension, k / s));
    }
    expanded.push(p2);
  }
  return buildSmoothOpenPath(expanded, tension);
}

/** 점을 "한 호흡" 단위로 묶음. 끊는 조건: 끝나는 음+갭, 긴 쉼, 피치 급강하, 호흡 최대 길이. */
function clusterPointsByFlow<T extends { t: number; decay_ratio?: number | null; pitch?: number }>(
  points: T[],
  endingDecayThreshold: number,
  gapAfterEndingSec: number,
  pitchDropSplitSemitones: number,
  longRestSec: number,
  maxBreathDurationSec: number
): T[][] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const clusters: T[][] = [];
  let current: T[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const gap = cur.t - prev.t;
    const breathStart = current[0]!.t;
    const breathDuration = cur.t - breathStart;
    const prevDecay = prev.decay_ratio ?? 1;
    const isPrevEnding = prevDecay < endingDecayThreshold;
    const gapEnoughAfterEnding = gap > gapAfterEndingSec;
    const isLongRest = gap > longRestSec;
    const prevPitch = prev.pitch ?? 0;
    const curPitch = cur.pitch ?? 0;
    const pitchDrop = prevPitch - curPitch;
    const isLargePitchDrop =
      pitchDropSplitSemitones > 0 && pitchDrop >= pitchDropSplitSemitones;
    const exceedsMaxBreath = breathDuration > maxBreathDurationSec;
    const split =
      (isPrevEnding && gapEnoughAfterEnding) ||
      isLongRest ||
      isLargePitchDrop ||
      exceedsMaxBreath;
    if (split) {
      clusters.push(current);
      current = [cur];
    } else {
      current.push(cur);
    }
  }
  clusters.push(current);
  return clusters;
}

function PitchStripV3Canvas({
  canvasRef,
  width,
  height,
  points,
  xScale,
  midiToY,
  ampScale,
  gridMidi,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  points: BassCurveV3Point[];
  xScale: (t: number) => number;
  midiToY: (midi: number) => number;
  ampScale: number;
  gridMidi: number[];
}) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(0,0,0,0.1)";
    ctx.setLineDash([2, 2]);
    for (const midi of gridMidi) {
      const y = midiToY(midi);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (points.length >= 2) {
      ctx.strokeStyle = "#3498db";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const pa = Number(a.pitch);
        const pb = Number(b.pitch);
        if (!Number.isFinite(pa) || !Number.isFinite(pb)) continue;
        const x0 = xScale(a.t);
        const y0 = midiToY(pa);
        const x1 = xScale(b.t);
        const y1 = midiToY(pb);
        const w = Math.max(0.5, (Number(a.amp) || 0) * ampScale);
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }
    /* 재생선은 WaveSurfer 커서만 사용 */
  }, [canvasRef, width, height, points, xScale, midiToY, ampScale, gridMidi]);
  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: "block", width: `${width}px`, height: `${height}px` }}
    />
  );
}

interface Tab14BassViewProps {
  audioUrl: string | null;
  data: StreamsSectionsData | null;
  /** true: 최종본용 — 노트만 표시, 토글 없음. false: 레거시 — 노트/연속 곡선 토글 */
  notesOnly?: boolean;
}

export function Tab14BassView({ audioUrl, data, notesOnly = false }: Tab14BassViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pitchCanvasRef = useRef<HTMLCanvasElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [minPxPerSec, setMinPxPerSec] = useState(DEFAULT_MIN_PX_PER_SEC);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 1]);
  const [trackWidth, setTrackWidth] = useState(0);
  const [viewMode, setViewMode] = useState<BassViewMode>("v2");

  const syncVisibleRangeFromWaveSurfer = useCallback(() => {
    const ws = wavesurferRef.current;
    const container = containerRef.current;
    if (!ws || !container) return;
    const scrollEl = container.querySelector(".scroll") as HTMLElement | null;
    const dur = ws.getDuration();
    if (!scrollEl || dur <= 0) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollEl;
    if (scrollWidth <= 0) return;
    const startTime = (scrollLeft / scrollWidth) * dur;
    const endTime = ((scrollLeft + clientWidth) / scrollWidth) * dur;
    setVisibleRange([startTime, endTime]);
  }, []);

  useEffect(() => {
    if (!audioUrl || !containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: WAVEFORM_HEIGHT,
      minPxPerSec: DEFAULT_MIN_PX_PER_SEC,
      waveColor: "rgba(120, 160, 220, 0.7)",
      progressColor: "rgba(26, 115, 232, 0.4)",
      cursorWidth: 2,
      cursorColor: "#e74c3c",
      barWidth: 1,
      barGap: 1,
      barRadius: 0,
      normalize: true,
    });
    wavesurferRef.current = ws;
    const loadPromise = ws.load(audioUrl);
    if (loadPromise != null && typeof loadPromise.catch === "function") {
      loadPromise.catch(() => {});
    }
    ws.on("ready", () => {
      const d = ws.getDuration();
      setDuration(d);
      setVisibleRange([0, d]);
      requestAnimationFrame(() => syncVisibleRangeFromWaveSurfer());
    });
    ws.on("scroll", () => syncVisibleRangeFromWaveSurfer());
    ws.on("zoom", () => requestAnimationFrame(() => syncVisibleRangeFromWaveSurfer()));
    ws.on("audioprocess", (t: number) => setCurrentTime(t));
    ws.on("seeking", (t: number) => setCurrentTime(t));
    ws.on("timeupdate", (t: number) => setCurrentTime(t));
    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => setIsPlaying(false));
    return () => {
      const p = ws.destroy();
      if (p != null && typeof (p as Promise<unknown>).catch === "function") {
        (p as Promise<unknown>).catch(() => {});
      }
      wavesurferRef.current = null;
    };
  }, [audioUrl, syncVisibleRangeFromWaveSurfer]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width } = entries[0]?.contentRect ?? { width: 0 };
      setTrackWidth(width || 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [audioUrl]);

  const bass = data?.bass;
  const notes = bass?.notes ?? [];
  const bassCurveV3 = bass?.bass_curve_v3 ?? [];
  const hasV2 = Array.isArray(notes) && notes.length > 0;
  const hasV3 = Array.isArray(bassCurveV3) && bassCurveV3.length > 0;
  const hasBass = notesOnly ? hasV2 : hasV2 || hasV3;

  useEffect(() => {
    if (!notesOnly && !hasV2 && hasV3 && viewMode === "v2") setViewMode("v3");
  }, [notesOnly, hasV2, hasV3, viewMode]);

  const dur = data?.duration_sec ?? (duration || 1);
  const [visibleStart, visibleEnd] = duration > 0 ? visibleRange : [0, Math.max(1, dur)];
  const visibleDur = Math.max(0.001, visibleEnd - visibleStart);
  const stripWidth = Math.max(trackWidth, 1);
  /** 파형과 1:1 비율 + 줌 공유: 전체 타임라인 너비 = duration * minPxPerSec */
  const contentWidth =
    duration > 0 ? Math.max(trackWidth, duration * minPxPerSec) : stripWidth;

  const xScale = useCallback(
    (t: number) =>
      duration > 0 && contentWidth > 0 ? (t / duration) * contentWidth : 0,
    [duration, contentWidth]
  );

  const pitchToY = useCallback(
    (pitchHz: number) => {
      const norm = (pitchHz - BASS_PITCH_HZ_MIN) / (BASS_PITCH_HZ_MAX - BASS_PITCH_HZ_MIN);
      const clamped = Math.max(0, Math.min(1, norm));
      const innerH = Math.max(0, PITCH_STRIP_HEIGHT - 2 * PADDING_VERTICAL);
      return PADDING_VERTICAL + (1 - clamped) * innerH;
    },
    []
  );

  const midiToY = useCallback(
    (midi: number) => pitchToY(midiToHz(midi)),
    [pitchToY]
  );

  const togglePlay = () => wavesurferRef.current?.playPause();
  const zoomIn = () => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    const next = Math.min(MAX_ZOOM, minPxPerSec * ZOOM_FACTOR);
    setMinPxPerSec(next);
    ws.zoom(next);
  };
  const zoomOut = () => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    const next = Math.max(MIN_ZOOM, minPxPerSec / ZOOM_FACTOR);
    setMinPxPerSec(next);
    ws.zoom(next);
  };
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const visibleNotes = notes.filter(
    (note) => note.end >= visibleStart && note.start <= visibleEnd
  );
  const MAX_DRAW_NOTES = 800;
  const drawNotes = visibleNotes.length > MAX_DRAW_NOTES ? visibleNotes.slice(0, MAX_DRAW_NOTES) : visibleNotes;
  /** 파형 1:1 시: 전체 타임라인에 그리므로 전체 노트 사용 (캡 있음) */
  const stripNotes =
    contentWidth > stripWidth && notes.length > 0
      ? (notes.length > MAX_DRAW_NOTES ? notes.slice(0, MAX_DRAW_NOTES) : notes)
      : drawNotes;
  const grooveCurve = bass?.groove_curve ?? [];
  const visibleGrooveCurve = grooveCurve.filter(
    (pt): pt is GrooveCurvePoint =>
      Array.isArray(pt) && pt.length >= 2 && pt[0] >= visibleStart && pt[0] <= visibleEnd
  );
  const visibleV3Points = bassCurveV3.filter(
    (p) => p.t >= visibleStart && p.t <= visibleEnd
  );
  const showNotes = notesOnly || viewMode === "v2";

  /** 그루브 스트립: value 0~1 → y 픽셀 (0=아래, 1=위) */
  const grooveValueToY = useCallback(
    (value: number) => {
      const v = Math.max(0, Math.min(1, value));
      const innerH = Math.max(0, GROOVE_STRIP_HEIGHT - 2 * PADDING_VERTICAL);
      return PADDING_VERTICAL + (1 - v) * innerH;
    },
    []
  );

  if (!data) {
    return (
      <div className="tab14-bass-view">
        <p className="placeholder">streams_sections_cnn.json을 로드하세요 (bass 필드 포함)</p>
      </div>
    );
  }

  if (!hasBass) {
    return (
      <div className="tab14-bass-view">
        <p className="placeholder">
          {notesOnly
            ? "이 JSON에는 베이스 노트 데이터가 없습니다. run_stem_folder로 bass.wav가 있는 stem 폴더를 분석한 streams_sections_cnn.json을 로드하세요."
            : "이 JSON에는 베이스 노트(또는 연속 곡선) 데이터가 없습니다. run_stem_folder로 bass.wav가 있는 stem 폴더를 분석한 streams_sections_cnn.json을 로드하세요."}
        </p>
      </div>
    );
  }

  return (
    <div className="tab14-bass-view">
      <div className="tab14-meta">
        {!notesOnly && (
          <div className="tab14-mode-toggle" role="group" aria-label="노트 / 연속 곡선 전환">
            {hasV2 && (
              <button
                type="button"
                className={viewMode === "v2" ? "active" : ""}
                onClick={() => setViewMode("v2")}
                aria-pressed={viewMode === "v2"}
              >
                v2 노트
              </button>
            )}
            {hasV3 && (
              <button
                type="button"
                className={viewMode === "v3" ? "active" : ""}
                onClick={() => setViewMode("v3")}
                aria-pressed={viewMode === "v3"}
              >
                v3 연속 곡선
              </button>
            )}
          </div>
        )}
        <span className="tab14-meta-count">
          {notesOnly || viewMode === "v2" ? `${notes.length}개 노트` : `${bassCurveV3.length}점`}
        </span>
        {data.source && <span className="tab14-meta-source">{data.source}</span>}
      </div>

      {audioUrl && (
        <>
          <div className="waveform-controls">
            <button type="button" onClick={togglePlay} disabled={duration === 0}>
              {isPlaying ? "일시정지" : "재생"}
            </button>
            <span className="time-display">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            <div className="zoom-controls">
              <button type="button" onClick={zoomOut} disabled={duration === 0} title="줌 아웃">
                −
              </button>
              <button type="button" onClick={zoomIn} disabled={duration === 0} title="줌 인">
                +
              </button>
            </div>
          </div>
          <div
            className="tab14-tracks-wrap"
            ref={wrapRef}
            style={{ width: "100%", overflowX: "auto", overflowY: "hidden" }}
          >
            <div
              className="tab14-tracks-content"
              style={{
                width: contentWidth,
                minWidth: "100%",
              }}
            >
              <div className="tab14-track tab14-track-waveform">
                <div className="tab14-track-label">파형</div>
                <div
                  className="waveform-container"
                  ref={containerRef}
                  style={{ width: "100%", height: WAVEFORM_HEIGHT }}
                />
              </div>
              <div className="tab14-track tab14-track-pitch">
                <div className="tab14-track-label">
                  피치 (MIDI) · {notesOnly || viewMode === "v2" ? "노트" : "연속 곡선"}
                </div>
                {dur > 0 && contentWidth > 1 && (
                  <div
                    className="tab14-pitch-strip-inner"
                    style={{
                      width: contentWidth,
                      height: PITCH_STRIP_HEIGHT,
                      position: "relative",
                      overflow: "visible",
                    }}
                  >
                    {showNotes && (
                      <>
                        <svg
                          width={contentWidth}
                          height={PITCH_STRIP_HEIGHT}
                        style={{
                          display: "block",
                          position: "absolute",
                          left: 0,
                          top: 0,
                          zIndex: 0,
                          pointerEvents: "none",
                        }}
                      >
                        {[36, 42, 48, 54, 60].map((midi) => (
                          <line
                            key={midi}
                            x1={0}
                            x2={contentWidth}
                            y1={midiToY(midi)}
                            y2={midiToY(midi)}
                            stroke="rgba(0,0,0,0.15)"
                            strokeWidth={1}
                            strokeDasharray="2,2"
                          />
                        ))}
                      </svg>
                      <svg
                        width={contentWidth}
                        height={PITCH_STRIP_HEIGHT}
                        style={{
                          display: "block",
                          position: "absolute",
                          left: 0,
                          top: 0,
                          zIndex: 2,
                          pointerEvents: "none",
                        }}
                      >
                      {stripNotes.map((note: BassNote, i: number) => {
                        const cy =
                          note.pitch_center != null && Number.isFinite(note.pitch_center)
                            ? midiToY(note.pitch_center)
                            : PADDING_VERTICAL + (PITCH_STRIP_HEIGHT - 2 * PADDING_VERTICAL) / 2;
                        const isActive =
                          duration > 0 &&
                          currentTime >= note.start &&
                          currentTime <= note.end;
                        return (
                          <circle
                            key={`marker-${i}`}
                            cx={xScale(note.start)}
                            cy={cy}
                            r={isActive ? 8 : 6}
                            fill={isActive ? "#f1c40f" : NOTE_MARKER_COLOR}
                            stroke="#fff"
                            strokeWidth={isActive ? 2 : 1}
                            className={isActive ? "tab14-marker-active" : ""}
                          />
                        );
                      })}
                      {duration > 0 && (
                        <line
                          x1={xScale(currentTime)}
                          x2={xScale(currentTime)}
                          y1={0}
                          y2={PITCH_STRIP_HEIGHT}
                          stroke="#e74c3c"
                          strokeWidth={2}
                        />
                      )}
                    </svg>
                    </>
                  )}
                  {!notesOnly && viewMode === "v3" && (
                    <>
                      {!hasV3 ? (
                        <p className="placeholder" style={{ padding: 8 }}>
                          연속 곡선 데이터가 없습니다. (테스트 탭에서 bass_curve_v3 포함 JSON 로드 시 표시)
                        </p>
                      ) : (
                        <>
                          <PitchStripV3Canvas
                            canvasRef={pitchCanvasRef}
                            width={stripWidth}
                            height={PITCH_STRIP_HEIGHT}
                            points={visibleV3Points}
                            xScale={xScale}
                            midiToY={midiToY}
                            ampScale={V3_AMP_STROKE_SCALE}
                            gridMidi={[36, 42, 48, 54, 60]}
                          />
                          {duration > 0 && (
                            <div
                              className="tab14-pitch-playhead"
                              style={{
                                position: "absolute",
                                left: xScale(currentTime),
                                top: 0,
                                bottom: 0,
                                width: 2,
                                background: "#e74c3c",
                                pointerEvents: "none",
                              }}
                            />
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            {showNotes && stripNotes.length > 0 && (() => {
              const points = stripNotes.map((n) => ({
                t: n.start,
                pitch: n.pitch_center != null && Number.isFinite(n.pitch_center) ? n.pitch_center : 48,
                decay_ratio: n.decay_ratio ?? undefined,
              }));
              const clusters = clusterPointsByFlow(
                points,
                GROOVE_ENDING_DECAY_THRESHOLD,
                GROOVE_GAP_AFTER_ENDING_SEC,
                GROOVE_PITCH_DROP_SPLIT_SEMITONES,
                GROOVE_LONG_REST_SEC,
                GROOVE_MAX_BREATH_DURATION_SEC
              );
              return (
                <div className="tab14-track tab14-track-groove">
                  <div className="tab14-track-label">그루브 (피치 y축 동일 · 선 = 한 흐름, 잔향 있으면 꼬리)</div>
                  <div
                    className="tab14-groove-inner"
                    style={{
                      width: contentWidth,
                      height: PITCH_STRIP_HEIGHT,
                      position: "relative",
                      background: "rgba(0,0,0,0.03)",
                      borderRadius: 4,
                    }}
                  >
                    <svg
                      width={contentWidth}
                      height={PITCH_STRIP_HEIGHT}
                      style={{
                        display: "block",
                        position: "absolute",
                        left: 0,
                        top: 0,
                        zIndex: 0,
                        pointerEvents: "none",
                      }}
                    >
                      {[36, 42, 48, 54, 60].map((midi) => (
                        <line
                          key={`groove-grid-${midi}`}
                          x1={0}
                          x2={contentWidth}
                          y1={midiToY(midi)}
                          y2={midiToY(midi)}
                          stroke="rgba(0,0,0,0.12)"
                          strokeWidth={1}
                          strokeDasharray="2,2"
                        />
                      ))}
                      {clusters.map((cluster, ci) => {
                        const pixelPoints = cluster.map(({ t, pitch }) => ({
                          x: xScale(t),
                          y: midiToY(pitch),
                        }));
                        const strokeStyle = "rgba(52, 152, 219, 0.82)";
                        const pathD =
                          buildSmootherOpenPath(pixelPoints, GROOVE_CURVE_TENSION) +
                          (pixelPoints.length === 1 ? " Z" : "");
                        if (pixelPoints.length === 0) return null;
                        const lastDecay = cluster[cluster.length - 1]?.decay_ratio ?? 0;
                        const showTail =
                          pixelPoints.length >= 2 && lastDecay > GROOVE_TAIL_DECAY_THRESHOLD;
                        const tailParams = showTail ? getTailParams(lastDecay) : null;
                        const last = pixelPoints[pixelPoints.length - 1]!;
                        const prev = pixelPoints[pixelPoints.length - 2];
                        const segLen = tailParams?.segmentLen ?? 0;
                        const ux =
                          prev != null && segLen > 0
                            ? ((last.x - prev.x) / (Math.hypot(last.x - prev.x, last.y - prev.y) || 1)) * segLen
                            : 0;
                        const uy =
                          prev != null && segLen > 0
                            ? ((last.y - prev.y) / (Math.hypot(last.x - prev.x, last.y - prev.y) || 1)) * segLen
                            : 0;
                        return (
                          <g key={`groove-seg-${ci}`}>
                            <path
                              d={pathD}
                              fill="none"
                              stroke={strokeStyle}
                              strokeWidth={GROOVE_STROKE_WIDTH}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            {tailParams &&
                              tailParams.strokeRatios.map((ratio, ti) => (
                                <line
                                  key={`tail-${ti}`}
                                  x1={last.x + ux * ti}
                                  y1={last.y + uy * ti}
                                  x2={last.x + ux * (ti + 1)}
                                  y2={last.y + uy * (ti + 1)}
                                  stroke={strokeStyle}
                                  strokeWidth={GROOVE_STROKE_WIDTH * ratio}
                                  strokeLinecap="round"
                                />
                              ))}
                          </g>
                        );
                      })}
                      {stripNotes.map((note, i) => {
                        const x = xScale(note.start);
                        const midi = note.pitch_center != null && Number.isFinite(note.pitch_center) ? note.pitch_center : 48;
                        const y = midiToY(midi);
                        return (
                          <circle
                            key={`groove-pt-${i}`}
                            cx={x}
                            cy={y}
                            r={4}
                            fill="#3498db"
                            stroke="#fff"
                            strokeWidth={1}
                          />
                        );
                      })}
                      {duration > 0 && (
                        <line
                          x1={xScale(currentTime)}
                          x2={xScale(currentTime)}
                          y1={0}
                          y2={PITCH_STRIP_HEIGHT}
                          stroke="#e74c3c"
                          strokeWidth={2}
                          opacity={0.9}
                        />
                      )}
                    </svg>
                  </div>
                </div>
              );
            })()}
            </div>
          </div>

          {(notesOnly || viewMode === "v2") && (
            <details className="tab14-details">
              <summary>{notesOnly ? "노트 목록" : "v4 노트 목록"}</summary>
              <div className="tab14-legend">
                <span style={{ color: NOTE_MARKER_COLOR }}>●</span> 노트 시작
                {notes.some((n) => n.render_type != null) && (
                  <>
                    {" · "}
                    <span style={{ color: "#3498db" }}>선(굵기·투명도)</span> = groove_confidence (render_type: line)
                  </>
                )}
              </div>
              {notes.some((n) => n.render_type != null || n.groove_confidence != null) && (
                <p className="tab14-v3-desc">
                  v4 Dual Onset: render_type(line/point)에 따라 선 스타일 적용. line 노트는 groove_confidence가 높을수록 굵고 불투명.
                </p>
              )}
              <ul className="tab14-notes-list">
                {notes.slice(0, 40).map((note: BassNote, i: number) => (
                  <li key={i}>
                    {note.start.toFixed(2)}–{note.end.toFixed(2)}s · pitch={
                      note.pitch_center != null && Number.isFinite(note.pitch_center)
                        ? note.pitch_center.toFixed(1)
                        : "—"
                    } · peak={note.energy_peak.toFixed(3)}
                    {note.role != null && (
                      <> · {note.role}</>
                    )}
                    {note.render_type != null && (
                      <> · {note.render_type}</>
                    )}
                    {note.groove_confidence != null && (
                      <> · groove={note.groove_confidence.toFixed(2)}</>
                    )}
                  </li>
                ))}
                {notes.length > 40 && <li>… 외 {notes.length - 40}개</li>}
              </ul>
            </details>
          )}
          {!notesOnly && viewMode === "v3" && hasV3 && (
            <details className="tab14-details">
              <summary>v3 연속 곡선 설명</summary>
              <p className="tab14-v3-desc">두께 = amplitude (Hilbert), y = pitch (MIDI)</p>
            </details>
          )}
        </>
      )}

      {!audioUrl && (
        <p className="placeholder">오디오를 먼저 로드하면 파형과 동기 재생을 사용할 수 있습니다.</p>
      )}
    </div>
  );
}
