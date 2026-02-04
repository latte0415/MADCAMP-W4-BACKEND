import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import type {
  StreamsSectionsData,
  VocalCurvePoint,
  VocalKeypoint,
} from "../types/streamsSections";

const WAVEFORM_HEIGHT = 120;
const PITCH_STRIP_HEIGHT = 160;
const DEFAULT_MIN_PX_PER_SEC = 50;
const ZOOM_FACTOR = 1.5;
const MIN_ZOOM = 10;
const MAX_ZOOM = 500;
const PADDING_VERTICAL = 12;

/** Vocal 피치 범위 (Hz). y축 log scale */
const VOCAL_PITCH_HZ_MIN = 80;
const VOCAL_PITCH_HZ_MAX = 1000;

/** 곡선 두께 스케일 (amp 0~1 → stroke 픽셀) */
const AMP_STROKE_SCALE = 10;

/** 에너지(amp) 이 값 미만이면 곡선 미표시 */
const AMP_DRAW_MIN = 0.05;

/** 키포인트 하이라이트 구간 반경(초). [t - W, t + W] */
const KEYPOINT_WINDOW_SEC = 0.12;

/** 하이라이트 색 (키포인트 구간) */
const HIGHLIGHT_STROKE = "#f1c40f";
/** 하이라이트 추가 두께(px) */
const HIGHLIGHT_STROKE_EXTRA = 2;
const HIGHLIGHT_STROKE_MIN = 2.5;

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 세그먼트 [a.t, b.t]가 키포인트 kp의 [kp.t - W, kp.t + W]와 겹치는지 */
function segmentInKeypointWindow(
  a: VocalCurvePoint,
  b: VocalCurvePoint,
  kp: VocalKeypoint,
  W: number
): boolean {
  return a.t <= kp.t + W && b.t >= kp.t - W;
}

function isSegmentHighlighted(
  a: VocalCurvePoint,
  b: VocalCurvePoint,
  keypoints: VocalKeypoint[],
  keypointWindowSec: number
): boolean {
  return keypoints.some((kp) => segmentInKeypointWindow(a, b, kp, keypointWindowSec));
}

function VocalPitchCanvas({
  canvasRef,
  width,
  height,
  points,
  xScale,
  pitchToY,
  ampScale,
  gridMidi,
  keypoints,
  keypointWindowSec,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  points: VocalCurvePoint[];
  xScale: (t: number) => number;
  pitchToY: (midi: number) => number;
  ampScale: number;
  gridMidi: number[];
  keypoints: VocalKeypoint[];
  keypointWindowSec: number;
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
    if (points.length >= 2) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // 패스 1: 일반 곡선 (에너지 임계 통과, 키포인트 구간 제외)
      ctx.strokeStyle = "#9b59b6";
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        const minAmp = Math.min(Number(a.amp) ?? 0, Number(b.amp) ?? 0);
        if (minAmp < AMP_DRAW_MIN) continue;
        if (isSegmentHighlighted(a, b, keypoints, keypointWindowSec)) continue;
        const pa = Number(a.pitch);
        const pb = Number(b.pitch);
        if (!Number.isFinite(pa) || !Number.isFinite(pb)) continue;
        const x0 = xScale(a.t);
        const y0 = pitchToY(pa);
        const x1 = xScale(b.t);
        const y1 = pitchToY(pb);
        const w = Math.max(0.5, (Number(a.amp) ?? 0) * ampScale);
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }

      // 패스 2: 키포인트 구간 하이라이트 (다른 색, 더 굵게)
      ctx.strokeStyle = HIGHLIGHT_STROKE;
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        const minAmp = Math.min(Number(a.amp) ?? 0, Number(b.amp) ?? 0);
        if (minAmp < AMP_DRAW_MIN) continue;
        if (!isSegmentHighlighted(a, b, keypoints, keypointWindowSec)) continue;
        const pa = Number(a.pitch);
        const pb = Number(b.pitch);
        if (!Number.isFinite(pa) || !Number.isFinite(pb)) continue;
        const x0 = xScale(a.t);
        const y0 = pitchToY(pa);
        const x1 = xScale(b.t);
        const y1 = pitchToY(pb);
        const baseW = Math.max(0.5, (Number(a.amp) ?? 0) * ampScale);
        const w = Math.max(HIGHLIGHT_STROKE_MIN, baseW + HIGHLIGHT_STROKE_EXTRA);
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }
  }, [canvasRef, width, height, points, xScale, pitchToY, ampScale, gridMidi, keypoints, keypointWindowSec]);
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
  const visibleKeypoints = keypoints.filter((kp) => kp.t >= visibleStart && kp.t <= visibleEnd);
  /** 하이라이트 판별용: visible 구간과 겹칠 수 있는 키포인트만 (kp.t ± KEYPOINT_WINDOW_SEC) */
  const keypointsForCanvas = keypoints.filter(
    (kp) =>
      kp.t >= visibleStart - KEYPOINT_WINDOW_SEC && kp.t <= visibleEnd + KEYPOINT_WINDOW_SEC
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
          곡선 {curve.length}점, 제스처 키포인트 {keypoints.length}개
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
                보컬 · y=피치, 선 굵기=에너지 (에너지 낮은 구간 미표시, 키포인트 구간 하이라이트)
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
                    xScale={xScale}
                    pitchToY={pitchToY}
                    ampScale={AMP_STROKE_SCALE}
                    gridMidi={gridMidi}
                    keypoints={keypointsForCanvas}
                    keypointWindowSec={KEYPOINT_WINDOW_SEC}
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
                    {visibleKeypoints.map((kp: VocalKeypoint, i: number) => {
                      const nearest = curve.length > 0
                        ? curve.reduce((a, b) =>
                            Math.abs(b.t - kp.t) < Math.abs(a.t - kp.t) ? b : a
                          )
                        : null;
                      const cy = nearest != null ? pitchToY(nearest.pitch) : PITCH_STRIP_HEIGHT / 2;
                      return (
                        <circle
                          key={`kp-${i}`}
                          cx={xScale(kp.t)}
                          cy={cy}
                          r={4}
                          fill={kp.type === "pitch_change" ? "#e74c3c" : "#f39c12"}
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
              y축 = 피치(log scale), 선 굵기 = 에너지. 에너지가 일정 이하인 구간은 표시하지 않음. 키포인트로 판단된 구간(노란색)은 하이라이트로 표시.
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
