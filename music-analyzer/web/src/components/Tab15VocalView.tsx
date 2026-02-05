import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import type {
  StreamsSectionsData,
  VocalCurvePoint,
  VocalGesture,
} from "../types/streamsSections";

const WAVEFORM_HEIGHT = 120;
const PITCH_STRIP_HEIGHT = 160;
const DEFAULT_MIN_PX_PER_SEC = 50;
const ZOOM_FACTOR = 1.5;
const MIN_ZOOM = 10;
const MAX_ZOOM = 500;
const PADDING_VERTICAL = 12;
const ACTIVATE_BEFORE_SEC = 0.03;
const ACTIVATE_AFTER_SEC = 0.15;

/** Vocal 피치 범위 (Hz). y축 log scale */
const VOCAL_PITCH_HZ_MIN = 80;
const VOCAL_PITCH_HZ_MAX = 1000;

/** 곡선 두께 스케일 (amp 0~1 → stroke 픽셀) */
const AMP_STROKE_SCALE = 10;

/** 에너지(amp) 이 값 미만이면 곡선 미표시 */
const AMP_DRAW_MIN = 0.05;

/** 시각화: 분석 10ms → 50~100ms (선이 선율처럼 보이도록) */
const VIS_DOWNSAMPLE_SEC = 0.1;
/** 시각화: downsampled pitch에 적용할 moving average 창 (gesture와 유사 효과) */
const VIS_SMOOTH_WINDOW = 5;

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** phrase 내부 points를 bucketSec 단위로 downsampling (median pitch, avg amp, t=버킷 중심) */
function downsamplePhrasePoints(
  points: VocalCurvePoint[],
  bucketSec: number
): { t: number; pitch: number; amp: number }[] {
  if (points.length === 0) return [];
  const half = bucketSec / 2;
  const buckets = new Map<number, { pitch: number[]; amp: number[] }>();
  for (const p of points) {
    const pitch = Number(p.pitch);
    const amp = Number(p.amp) ?? 0;
    if (!Number.isFinite(pitch)) continue;
    const bucketCenter = Math.floor(p.t / bucketSec) * bucketSec + half;
    const key = Math.round(bucketCenter * 1e4) / 1e4;
    if (!buckets.has(key)) buckets.set(key, { pitch: [], amp: [] });
    buckets.get(key)!.pitch.push(pitch);
    buckets.get(key)!.amp.push(amp);
  }
  const out: { t: number; pitch: number; amp: number }[] = [];
  for (const [tKey, v] of buckets) {
    const t = tKey;
    const pitchSorted = [...v.pitch].sort((a, b) => a - b);
    const mid = pitchSorted.length >> 1;
    const medianPitch =
      pitchSorted.length % 2 === 1
        ? pitchSorted[mid]!
        : (pitchSorted[mid - 1]! + pitchSorted[mid]!) / 2;
    const avgAmp = v.amp.reduce((s, x) => s + x, 0) / v.amp.length;
    out.push({ t, pitch: medianPitch, amp: avgAmp });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** downsampled 시리즈에 moving average (pitch만, purely rendering) */
function smoothPitchSeries(
  points: { t: number; pitch: number; amp: number }[],
  window: number
): { t: number; pitch: number; amp: number }[] {
  if (points.length === 0 || window < 2) return points;
  const w = Math.min(window, points.length);
  const half = (w - 1) >> 1;
  return points.map((p, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(points.length - 1, i + half); j++) {
      sum += points[j]!.pitch;
      n++;
    }
    return { ...p, pitch: n > 0 ? sum / n : p.pitch };
  });
}

/** phrase 단위로만 pitch 선 렌더링 (구간 사이 연결 금지) */
function VocalPitchCanvas({
  canvasRef,
  width,
  height,
  points,
  phrases,
  xScale,
  pitchToY,
  ampScale,
  gridMidi,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  points: VocalCurvePoint[];
  phrases: { start: number; end: number }[];
  xScale: (t: number) => number;
  pitchToY: (midi: number) => number;
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
      const y = pitchToY(midi);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(155, 89, 182, 0.95)";

    if (phrases.length > 0) {
      // A-1: phrase 밖에는 pitch 없음 — 구간별 clip; A-2: phrase마다 스타일 차이(짝/홀 opacity)
      for (let pi = 0; pi < phrases.length; pi++) {
        const ph = phrases[pi]!;
        const x0 = xScale(ph.start);
        const x1 = xScale(ph.end);
        const w = Math.max(1, x1 - x0);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, 0, w, height);
        ctx.clip();
        ctx.globalAlpha = pi % 2 === 0 ? 0.95 : 0.75;
        const seg = points.filter((p) => p.t >= ph.start && p.t <= ph.end);
        if (seg.length >= 2) {
          const down = downsamplePhrasePoints(seg, VIS_DOWNSAMPLE_SEC);
          if (down.length >= 2) {
            const vis = smoothPitchSeries(down, VIS_SMOOTH_WINDOW);
            for (let i = 0; i < vis.length - 1; i++) {
              const a = vis[i]!;
              const b = vis[i + 1]!;
              if (a.amp < AMP_DRAW_MIN && b.amp < AMP_DRAW_MIN) continue;
              ctx.lineWidth = Math.max(0.5, Math.max(a.amp, b.amp) * ampScale);
              ctx.beginPath();
              ctx.moveTo(xScale(a.t), pitchToY(a.pitch));
              ctx.lineTo(xScale(b.t), pitchToY(b.pitch));
              ctx.stroke();
            }
          }
        }
        ctx.restore();
      }
    } else if (points.length >= 2) {
      // fallback: phrase 없을 때도 downsampling 적용 (호환용)
      const down = downsamplePhrasePoints(points, VIS_DOWNSAMPLE_SEC);
      const vis = down.length >= 2 ? smoothPitchSeries(down, VIS_SMOOTH_WINDOW) : down;
      for (let i = 0; i < vis.length - 1; i++) {
        const a = vis[i]!;
        const b = vis[i + 1]!;
        if (a.amp < AMP_DRAW_MIN && b.amp < AMP_DRAW_MIN) continue;
        const w = Math.max(0.5, Math.max(a.amp, b.amp) * ampScale);
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(xScale(a.t), pitchToY(a.pitch));
        ctx.lineTo(xScale(b.t), pitchToY(b.pitch));
        ctx.stroke();
      }
    }
  }, [canvasRef, width, height, points, phrases, xScale, pitchToY, ampScale, gridMidi]);
  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: "block", width: `${width}px`, height: `${height}px` }}
    />
  );
}

interface Tab15VocalViewProps {
  audioUrl: string | null;
  data: StreamsSectionsData | null;
}

export function Tab15VocalView({ audioUrl, data }: Tab15VocalViewProps) {
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

  const vocal = data?.vocal;
  const curve = vocal?.vocal_curve ?? [];
  const keypoints = vocal?.vocal_keypoints ?? [];
  const phrases = vocal?.vocal_phrases ?? [];
  const turns = vocal?.vocal_turns ?? [];
  const onsets = vocal?.vocal_onsets ?? [];
  const useTurnsMode = turns.length > 0 || onsets.length > 0;
  const hasVocal = Array.isArray(curve) && curve.length > 0;

  const dur = data?.duration_sec ?? (duration || 1);
  const [visibleStart, visibleEnd] = duration > 0 ? visibleRange : [0, Math.max(1, dur)];
  const visibleDur = Math.max(0.001, visibleEnd - visibleStart);
  const stripWidth = Math.max(trackWidth, 1);

  const xScale = useCallback(
    (t: number) =>
      stripWidth > 0 && visibleDur > 0 ? ((t - visibleStart) / visibleDur) * stripWidth : 0,
    [stripWidth, visibleStart, visibleDur]
  );
  const isActiveAtTime = useCallback(
    (t: number) => currentTime >= t - ACTIVATE_BEFORE_SEC && currentTime <= t + ACTIVATE_AFTER_SEC,
    [currentTime]
  );

  const pitchToY = useCallback(
    (midi: number) => {
      const hz = midiToHz(midi);
      const logMin = Math.log(VOCAL_PITCH_HZ_MIN);
      const logMax = Math.log(VOCAL_PITCH_HZ_MAX);
      const norm = (Math.log(Math.max(hz, VOCAL_PITCH_HZ_MIN)) - logMin) / (logMax - logMin);
      const clamped = Math.max(0, Math.min(1, norm));
      const innerH = Math.max(0, PITCH_STRIP_HEIGHT - 2 * PADDING_VERTICAL);
      return PADDING_VERTICAL + (1 - clamped) * innerH;
    },
    []
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

  const visibleCurvePoints = curve.filter((p) => p.t >= visibleStart && p.t <= visibleEnd);
  const visiblePhrases = useTurnsMode ? [] : phrases.filter(
    (ph) => ph.end >= visibleStart && ph.start <= visibleEnd
  );
  const visibleTurns = turns.filter((t) => t.t >= visibleStart && t.t <= visibleEnd);
  const visibleOnsets = onsets.filter((o) => o.t >= visibleStart && o.t <= visibleEnd);
  const allGestures = useTurnsMode ? [] : phrases.flatMap((ph) =>
    ph.gestures
      .filter((g) => g.type !== "phrase_start")
      .map((g) => ({ g, ph }))
  );
  const visibleGesturesWithPhrase = allGestures.filter(
    ({ g, ph }) =>
      g.t >= visibleStart &&
      g.t <= visibleEnd &&
      g.t > ph.start &&
      g.t < ph.end
  );
  const gridMidi = [48, 60, 72, 84, 96];

  if (!data) {
    return (
      <div className="tab15-vocal-view">
        <p className="placeholder">streams_sections_cnn.json을 로드하세요 (vocal 필드 포함)</p>
      </div>
    );
  }

  if (!hasVocal) {
    return (
      <div className="tab15-vocal-view">
        <p className="placeholder">
          이 JSON에는 보컬 곡선 데이터가 없습니다. run_stem_folder로 vocals.wav가 있는 stem 폴더를 분석한 streams_sections_cnn.json을 로드하세요.
        </p>
      </div>
    );
  }

  return (
    <div className="tab15-vocal-view">
      <div className="tab15-meta">
        <span className="tab15-meta-count">
          곡선 {curve.length}점
          {useTurnsMode
            ? `, Turn ${turns.length}개`
            : phrases.length > 0
              ? `, phrases ${phrases.length}개, 제스처 ${allGestures.length}개`
              : `, 키포인트 ${keypoints.length}개`}
        </span>
        {data.source && <span className="tab15-meta-source">{data.source}</span>}
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
          <div className="tab15-tracks-wrap" ref={wrapRef} style={{ width: "100%" }}>
            <div className="tab15-track tab15-track-waveform">
              <div className="tab15-track-label">파형</div>
              <div
                className="waveform-container"
                ref={containerRef}
                style={{ width: "100%", height: WAVEFORM_HEIGHT }}
              />
            </div>
            <div className="tab15-track tab15-track-pitch">
              <div className="tab15-track-label">
                보컬 · {useTurnsMode ? "pitch 선 하나, ▲ 전환 ● onset" : "phrase 단위 피치 선, ● onset(발음·강세)"}
              </div>
              {dur > 0 && stripWidth > 1 && (
                <div
                  className="tab15-pitch-strip-inner"
                  style={{
                    width: stripWidth,
                    height: PITCH_STRIP_HEIGHT,
                    position: "relative",
                    overflow: "visible",
                  }}
                >
                  <VocalPitchCanvas
                    canvasRef={pitchCanvasRef}
                    width={stripWidth}
                    height={PITCH_STRIP_HEIGHT}
                    points={visibleCurvePoints}
                    phrases={useTurnsMode ? [] : visiblePhrases}
                    xScale={xScale}
                    pitchToY={pitchToY}
                    ampScale={AMP_STROKE_SCALE}
                    gridMidi={gridMidi}
                  />
                  <svg
                    width={stripWidth}
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
                    {!useTurnsMode && visiblePhrases.map((ph, i) => {
                      const x = xScale(ph.start);
                      const w = Math.max(1, xScale(ph.end) - x);
                      return (
                        <g key={`phrase-${i}`}>
                          <rect
                            x={x}
                            y={0}
                            width={w}
                            height={PITCH_STRIP_HEIGHT}
                            fill="rgba(155, 89, 182, 0.04)"
                            stroke="rgba(155, 89, 182, 0.1)"
                            strokeWidth={1}
                          />
                          <line
                            x1={x}
                            x2={x}
                            y1={0}
                            y2={PITCH_STRIP_HEIGHT}
                            stroke="rgba(155, 89, 182, 0.25)"
                            strokeWidth={1}
                          />
                          <line
                            x1={x + w}
                            x2={x + w}
                            y1={0}
                            y2={PITCH_STRIP_HEIGHT}
                            stroke="rgba(155, 89, 182, 0.25)"
                            strokeWidth={1}
                          />
                        </g>
                      );
                    })}
                    <g style={{ pointerEvents: "auto" }}>
                      {useTurnsMode
                        ? visibleTurns.map((turn, i: number) => {
                        const nearest = curve.length > 0
                          ? curve.reduce((a, b) =>
                              Math.abs(b.t - turn.t) < Math.abs(a.t - turn.t) ? b : a
                            )
                          : null;
                        const cy = nearest != null ? pitchToY(nearest.pitch) : PITCH_STRIP_HEIGHT / 2;
                        const cx = xScale(turn.t);
                        const isActive = isActiveAtTime(turn.t);
                        const up =
                          turn.direction === "down_to_up" ||
                          (turn.direction !== "up_to_down" && !turn.direction);
                        const size = 6;
                        const pts = up
                          ? `${cx},${cy - size} ${cx - size},${cy + size} ${cx + size},${cy + size}`
                          : `${cx},${cy + size} ${cx - size},${cy - size} ${cx + size},${cy - size}`;
                        return (
                          <polygon
                            key={`turn-${i}-${turn.t}`}
                            points={pts}
                            fill="#f39c12"
                            stroke="#fff"
                            strokeWidth={isActive ? 2 : 1}
                            opacity={isActive ? 1 : 0.6}
                            title="전환: 멜로디가 꺾이는 지점 (여기서 동작을 바꿔라)"
                          />
                        );
                      })
                      : null}
                      {/* onset 마커는 일단 비표시 */}
                      {!useTurnsMode && visibleGesturesWithPhrase.map(({ g, ph }, i: number) => {
                        const nearest = curve.length > 0
                          ? curve.reduce((a, b) =>
                              Math.abs(b.t - g.t) < Math.abs(a.t - g.t) ? b : a
                            )
                          : null;
                        const cy = nearest != null ? pitchToY(nearest.pitch) : PITCH_STRIP_HEIGHT / 2;
                        const x0 = xScale(ph.start) + 2;
                        const x1 = xScale(ph.end) - 2;
                        const cx = Math.max(x0, Math.min(x1, xScale(g.t)));
                        const isActive = isActiveAtTime(g.t);
                        const fill =
                          g.type === "accent" ? "#e74c3c" : g.type === "onset" ? "#3498db" : "#f39c12";
                        const title =
                          g.type === "pitch_gesture"
                            ? "전환 포인트: 멜로디 방향이 바뀌는 지점"
                            : g.type === "onset"
                              ? "발음/강세: onset이 강한 지점"
                              : "강조 포인트: 표현이 강해지는 지점";
                        if (g.type === "pitch_gesture") {
                          const up =
                            g.direction === "down_to_up" ||
                            (g.direction !== "up_to_down" && (g.direction === "up" || !g.direction));
                          const size = 6;
                          const pts = up
                            ? `${cx},${cy - size} ${cx - size},${cy + size} ${cx + size},${cy + size}`
                            : `${cx},${cy + size} ${cx - size},${cy - size} ${cx + size},${cy - size}`;
                          return (
                            <polygon
                              key={`gesture-${i}-${g.t}`}
                              points={pts}
                              fill={fill}
                              stroke="#fff"
                              strokeWidth={isActive ? 2 : 1}
                              opacity={isActive ? 1 : 0.6}
                              title={title}
                            />
                          );
                        }
                        return (
                          <circle
                            key={`gesture-${i}-${g.t}`}
                            cx={cx}
                            cy={cy}
                            r={(g.type === "onset" ? 4 : 5) + (isActive ? 2 : 0)}
                            fill={fill}
                            stroke="#fff"
                            strokeWidth={isActive ? 2 : 1}
                            opacity={isActive ? 1 : 0.6}
                            title={title}
                          />
                        );
                      })}
                    </g>
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
                </div>
              )}
            </div>
          </div>
          <details className="tab15-details">
            <summary>보컬 곡선 설명</summary>
            <p className="tab15-desc">
              {useTurnsMode
                ? "y축 = 피치(log scale). pitch 선 하나. ▲ 전환: 멜로디가 꺾이는 지점. 마커에 마우스를 올리면 설명이 보입니다."
                : "y축 = 피치(log scale). phrase 안에서만 보임. 마커에 마우스를 올리면 설명이 보입니다."}
            </p>
          </details>
        </>
      )}

      {!audioUrl && (
        <p className="placeholder">오디오를 먼저 로드하면 파형과 동기 재생을 사용할 수 있습니다.</p>
      )}
    </div>
  );
}
