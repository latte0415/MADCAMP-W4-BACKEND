import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import type {
  StreamsSectionsData,
  OtherCurvePoint,
  OtherRegion,
} from "../types/streamsSections";

const WAVEFORM_HEIGHT = 120;
const STRIP_HEIGHT = 100;
const DEFAULT_MIN_PX_PER_SEC = 50;
const ZOOM_FACTOR = 1.5;
const MIN_ZOOM = 10;
const MAX_ZOOM = 500;
const PADDING_VERTICAL = 8;

interface Tab16OtherViewProps {
  audioUrl: string | null;
  data: StreamsSectionsData | null;
}

export function Tab16OtherView({ audioUrl, data }: Tab16OtherViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
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

  const other = data?.other;
  const curve = other?.other_curve ?? [];
  const regions = other?.other_regions ?? [];
  const keypoints = other?.other_keypoints ?? [];
  const hasPitchCurve = curve.some(
    (p) => p.pitch != null && Number.isFinite(p.pitch as number)
  );
  const hasOther = (Array.isArray(curve) && curve.length > 0) || (Array.isArray(regions) && regions.length > 0);

  const dur = data?.duration_sec ?? (duration || 1);
  const [visibleStart, visibleEnd] = duration > 0 ? visibleRange : [0, Math.max(1, dur)];
  const visibleDur = Math.max(0.001, visibleEnd - visibleStart);
  const stripWidth = Math.max(trackWidth, 1);

  const xScale = useCallback(
    (t: number) =>
      stripWidth > 0 && visibleDur > 0 ? ((t - visibleStart) / visibleDur) * stripWidth : 0,
    [stripWidth, visibleStart, visibleDur]
  );

  const densityToY = useCallback(
    (density: number) => {
      const v = Math.max(0, Math.min(1, density));
      const innerH = Math.max(0, STRIP_HEIGHT - 2 * PADDING_VERTICAL);
      return PADDING_VERTICAL + (1 - v) * innerH;
    },
    []
  );

  const pitchToY = useCallback(
    (pitch: number, minPitch: number, maxPitch: number) => {
      const innerH = Math.max(0, STRIP_HEIGHT - 2 * PADDING_VERTICAL);
      const range = Math.max(1, maxPitch - minPitch);
      const v = (pitch - minPitch) / range;
      return PADDING_VERTICAL + (1 - v) * innerH;
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
  const visibleRegions = regions.filter(
    (r) => r.end >= visibleStart && r.start <= visibleEnd
  );
  const visibleKeypoints = keypoints.filter(
    (k) => k.t >= visibleStart && k.t <= visibleEnd
  );
  const visiblePitchVals = visibleCurvePoints
    .map((v) => v.pitch)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const visiblePitchMin = visiblePitchVals.length ? Math.min(...visiblePitchVals) : 0;
  const visiblePitchMax = visiblePitchVals.length ? Math.max(...visiblePitchVals) : 1;

  /** 키포인트 시점 t에서 곡선 보간 density (y 계산용) */
  const densityAtT = useCallback(
    (t: number): number => {
      if (curve.length === 0) return 0.5;
      const i = curve.findIndex((p) => p.t >= t);
      if (i <= 0) return curve[0]?.density ?? 0.5;
      if (i >= curve.length) return curve[curve.length - 1]?.density ?? 0.5;
      const a = curve[i - 1]!;
      const b = curve[i]!;
      const frac = (t - a.t) / (b.t - a.t);
      return (a.density ?? 0.5) + frac * ((b.density ?? 0.5) - (a.density ?? 0.5));
    },
    [curve]
  );

  const pitchAtT = useCallback(
    (t: number): number | null => {
      if (curve.length === 0) return null;
      const i = curve.findIndex((p) => p.t >= t);
      if (i <= 0) return curve[0]?.pitch ?? null;
      if (i >= curve.length) return curve[curve.length - 1]?.pitch ?? null;
      const a = curve[i - 1]!;
      const b = curve[i]!;
      if (a.pitch == null || b.pitch == null) return a.pitch ?? b.pitch ?? null;
      const frac = (t - a.t) / (b.t - a.t);
      return a.pitch + frac * (b.pitch - a.pitch);
    },
    [curve]
  );

  if (!data) {
    return (
      <div className="tab16-other-view">
        <p className="placeholder">streams_sections_cnn.json을 로드하세요 (other 필드 포함)</p>
      </div>
    );
  }

  if (!hasOther) {
    return (
      <div className="tab16-other-view">
        <p className="placeholder">
          이 JSON에는 other 곡선/영역 데이터가 없습니다. run_stem_folder로 other.wav가 있는 stem 폴더를 분석한 streams_sections_cnn.json을 로드하세요.
        </p>
      </div>
    );
  }

  return (
    <div className="tab16-other-view">
      <div className="tab16-meta">
        <span className="tab16-meta-count">
          곡선 {curve.length}점, 영역 {regions.length}개
          {keypoints.length > 0 ? `, 키포인트 ${keypoints.length}개` : ""}
        </span>
        {data.source && <span className="tab16-meta-source">{data.source}</span>}
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
          <div className="tab16-tracks-wrap" ref={wrapRef} style={{ width: "100%" }}>
            <div className="tab16-track tab16-track-waveform">
              <div className="tab16-track-label">파형</div>
              <div
                className="waveform-container"
                ref={containerRef}
                style={{ width: "100%", height: WAVEFORM_HEIGHT }}
              />
            </div>
            {curve.length > 0 && (
              <div className="tab16-track tab16-track-density">
                <div className="tab16-track-label">
                  {hasPitchCurve ? "Other · 멜로디 피치 곡선" : "Other · onset 밀도 곡선"}
                </div>
                <div
                  className="tab16-strip-inner"
                  style={{
                    width: stripWidth,
                    height: STRIP_HEIGHT,
                    position: "relative",
                    background: "rgba(0,0,0,0.06)",
                    borderRadius: 4,
                  }}
                >
                  <svg
                    width={stripWidth}
                    height={STRIP_HEIGHT}
                    style={{
                      display: "block",
                      position: "absolute",
                      left: 0,
                      top: 0,
                      zIndex: 0,
                      pointerEvents: "none",
                    }}
                  >
                    {visibleCurvePoints.length >= 2 &&
                      visibleCurvePoints.map((p: OtherCurvePoint, i: number) => {
                        if (i === 0) return null;
                        const prev = visibleCurvePoints[i - 1]!;
                        const hasPitchRange = Number.isFinite(visiblePitchMin) && Number.isFinite(visiblePitchMax);
                        const lineWidth = Math.max(1.5, 1.5 + (p.amp ?? 0) * 2);
                        if (hasPitchCurve) {
                          if (prev.pitch == null || p.pitch == null || !hasPitchRange) return null;
                          return (
                            <line
                              key={`d-${i}`}
                              x1={xScale(prev.t)}
                              y1={pitchToY(prev.pitch, visiblePitchMin, visiblePitchMax)}
                              x2={xScale(p.t)}
                              y2={pitchToY(p.pitch, visiblePitchMin, visiblePitchMax)}
                              stroke="#2c3e50"
                              strokeWidth={lineWidth}
                              strokeLinecap="round"
                            />
                          );
                        }
                        return (
                          <line
                            key={`d-${i}`}
                            x1={xScale(prev.t)}
                            y1={densityToY(prev.density ?? 0.5)}
                            x2={xScale(p.t)}
                            y2={densityToY(p.density ?? 0.5)}
                            stroke="#27ae60"
                            strokeWidth={2}
                            strokeLinecap="round"
                          />
                        );
                      })}
                    <g style={{ pointerEvents: "auto" }}>
                      {visibleKeypoints.map((kp, i) => {
                        const cx = xScale(kp.t);
                        const density = densityAtT(kp.t);
                        const pitch = pitchAtT(kp.t);
                        const cy = hasPitchCurve && pitch != null
                          ? pitchToY(pitch, visiblePitchMin, visiblePitchMax)
                          : densityToY(density);
                        if (kp.type === "density_peak") {
                          const size = 5;
                          const pts = `${cx},${cy - size} ${cx - size},${cy + size} ${cx + size},${cy + size}`;
                          return (
                            <polygon
                              key={`kp-${i}-${kp.t}`}
                              points={pts}
                              fill="#e67e22"
                              stroke="#fff"
                              strokeWidth={1}
                              title="density peak: 리듬이 가장 쌓인 시점"
                            />
                          );
                        }
                        if (kp.type === "phrase_start") {
                          const size = 5;
                          const pts = `${cx},${cy - size} ${cx - size},${cy + size} ${cx + size},${cy + size}`;
                          return (
                            <polygon
                              key={`kp-${i}-${kp.t}`}
                              points={pts}
                              fill="#16a085"
                              stroke="#fff"
                              strokeWidth={1}
                              title="phrase_start: 멜로디 시작"
                            />
                          );
                        }
                        if (kp.type === "pitch_turn") {
                          const size = 4;
                          const pts = `${cx},${cy - size} ${cx - size},${cy} ${cx},${cy + size} ${cx + size},${cy}`;
                          return (
                            <polygon
                              key={`kp-${i}-${kp.t}`}
                              points={pts}
                              fill="#8e44ad"
                              stroke="#fff"
                              strokeWidth={1}
                              title="pitch_turn: 멜로디 전환점"
                            />
                          );
                        }
                        if (kp.type === "accent") {
                          return (
                            <circle
                              key={`kp-${i}-${kp.t}`}
                              cx={cx}
                              cy={cy}
                              r={4}
                              fill="#e74c3c"
                              stroke="#fff"
                              strokeWidth={1}
                              title="accent: 에너지 강조"
                            />
                          );
                        }
                        return (
                          <circle
                            key={`kp-${i}-${kp.t}`}
                            cx={cx}
                            cy={cy}
                            r={3}
                            fill="#3498db"
                            stroke="#fff"
                            strokeWidth={1}
                            title="onset: 타격/어택 시점"
                          />
                        );
                      })}
                    </g>
                    {duration > 0 && (
                      <line
                        x1={xScale(currentTime)}
                        x2={xScale(currentTime)}
                        y1={0}
                        y2={STRIP_HEIGHT}
                        stroke="#e74c3c"
                        strokeWidth={2}
                      />
                    )}
                  </svg>
                </div>
              </div>
            )}
            {regions.length > 0 && (
              <div className="tab16-track tab16-track-regions">
                <div className="tab16-track-label">Other · 멜로디 활성 구간 (반투명 밴드)</div>
                <div
                  className="tab16-strip-inner"
                  style={{
                    width: stripWidth,
                    height: STRIP_HEIGHT,
                    position: "relative",
                    background: "rgba(0,0,0,0.06)",
                    borderRadius: 4,
                  }}
                >
                  <svg
                    width={stripWidth}
                    height={STRIP_HEIGHT}
                    style={{
                      display: "block",
                      position: "absolute",
                      left: 0,
                      top: 0,
                      zIndex: 0,
                      pointerEvents: "none",
                    }}
                  >
                    {visibleRegions.map((r: OtherRegion, i: number) => (
                      <rect
                        key={`r-${i}`}
                        x={xScale(r.start)}
                        y={PADDING_VERTICAL}
                        width={Math.max(2, xScale(r.end) - xScale(r.start))}
                        height={STRIP_HEIGHT - 2 * PADDING_VERTICAL}
                        fill="rgba(155, 89, 182, 0.25)"
                        stroke="rgba(155, 89, 182, 0.5)"
                        strokeWidth={1}
                      />
                    ))}
                    {duration > 0 && (
                      <line
                        x1={xScale(currentTime)}
                        x2={xScale(currentTime)}
                        y1={0}
                        y2={STRIP_HEIGHT}
                        stroke="#e74c3c"
                        strokeWidth={2}
                      />
                    )}
                  </svg>
                </div>
              </div>
            )}
          </div>
          <details className="tab16-details">
            <summary>Other 설명</summary>
            <p className="tab16-desc">
              멜로디: 피치 곡선 + 전환점/강조 지점. 멜로디 활성 구간은 반투명 밴드로 표시.
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
