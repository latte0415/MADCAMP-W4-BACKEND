import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import type { StreamsSectionsData, BassNote, BassCurveV3Point } from "../types/streamsSections";

/** 트랙 1: 파형 / 트랙 2: 피치 (분리) */
const WAVEFORM_HEIGHT = 120;
const PITCH_STRIP_HEIGHT = 160;
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

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const NOTE_MARKER_COLOR = "#2ecc71";

type BassViewMode = "v2" | "v3";

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
    ws.load(audioUrl);
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
      ws.destroy();
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

  const xScale = useCallback(
    (t: number) =>
      stripWidth > 0 && visibleDur > 0 ? ((t - visibleStart) / visibleDur) * stripWidth : 0,
    [stripWidth, visibleStart, visibleDur]
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

  const visibleNotes = notes.filter(
    (note) => note.end >= visibleStart && note.start <= visibleEnd
  );
  const MAX_DRAW_NOTES = 800;
  const drawNotes = visibleNotes.length > MAX_DRAW_NOTES ? visibleNotes.slice(0, MAX_DRAW_NOTES) : visibleNotes;

  const visibleV3Points = bassCurveV3.filter(
    (p) => p.t >= visibleStart && p.t <= visibleEnd
  );

  const showNotes = notesOnly || viewMode === "v2";

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
          <div className="tab14-tracks-wrap" ref={wrapRef} style={{ width: "100%" }}>
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
              {dur > 0 && stripWidth > 1 && (
                <div
                  className="tab14-pitch-strip-inner"
                  style={{
                    width: stripWidth,
                    height: PITCH_STRIP_HEIGHT,
                    position: "relative",
                    overflow: "visible",
                  }}
                >
                  {showNotes && (
                    <svg width={stripWidth} height={PITCH_STRIP_HEIGHT} style={{ display: "block" }}>
                      {[36, 42, 48, 54, 60].map((midi) => (
                        <line
                          key={midi}
                          x1={0}
                          x2={stripWidth}
                          y1={midiToY(midi)}
                          y2={midiToY(midi)}
                          stroke="rgba(0,0,0,0.15)"
                          strokeWidth={1}
                          strokeDasharray="2,2"
                        />
                      ))}
                      {drawNotes.map((note: BassNote, noteIdx: number) => {
                        const raw = note.simplified_curve ?? note.pitch_curve;
                        const points = Array.isArray(raw) ? raw : [];
                        const polylinePoints = points
                          .filter(([, p]) => p != null && Number.isFinite(p))
                          .map(([t, p]) => `${xScale(t)},${midiToY(p as number)}`)
                          .join(" ");
                        if (!polylinePoints.trim()) return null;
                        const isActive =
                          duration > 0 &&
                          currentTime >= note.start &&
                          currentTime <= note.end;
                        const gc = note.groove_confidence;
                        const isLine = note.render_type === "line";
                        const isPoint = note.render_type === "point";
                        const strokeWidth =
                          isActive ? 2.5 : gc != null && isLine ? 1.2 + gc * 2.0 : isPoint ? 1.0 : 1.5;
                        const opacity =
                          isActive ? 1 : gc != null && isLine ? 0.7 + gc * 0.3 : isPoint ? 0.7 : 0.85;
                        const strokeDasharray = isPoint ? "4,2" : undefined;
                        return (
                          <polyline
                            key={`note-${noteIdx}`}
                            points={polylinePoints}
                            fill="none"
                            stroke={isActive ? "#f1c40f" : "#3498db"}
                            strokeWidth={strokeWidth}
                            strokeDasharray={strokeDasharray}
                            opacity={opacity}
                            className={isActive ? "tab14-note-active" : ""}
                          />
                        );
                      })}
                      {drawNotes.map((note: BassNote, i: number) => {
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
                            r={isActive ? 7 : 5}
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
