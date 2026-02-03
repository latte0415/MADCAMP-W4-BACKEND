import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { applyBandFilter, type BandId } from "../utils/bandFilter";
import type { StreamsSectionsData, KeypointByBandItem, TextureBlockItem } from "../types/streamsSections";

const WAVEFORM_HEIGHT = 120;
const DEFAULT_MIN_PX_PER_SEC = 50;
const ZOOM_FACTOR = 1.5;
const MIN_ZOOM = 10;
const MAX_ZOOM = 500;

const BAND_COLORS: Record<string, string> = {
  low: "#e74c3c",
  mid: "#f39c12",
  high: "#3498db",
};

interface Tab13DrumKeypointsViewProps {
  audioUrl: string | null;
  data: StreamsSectionsData | null;
}

export function Tab13DrumKeypointsView({ audioUrl, data }: Tab13DrumKeypointsViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const filterBlobUrlsRef = useRef<Partial<Record<BandId, string>>>({});
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [minPxPerSec, setMinPxPerSec] = useState(DEFAULT_MIN_PX_PER_SEC);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 1]);
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: WAVEFORM_HEIGHT });
  const [filteredAudioUrl, setFilteredAudioUrl] = useState<string | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);
  const [selectedBand, setSelectedBand] = useState<"low" | "mid" | "high">("low");

  // 선택한 대역에 맞는 오디오 URL (low/mid/high면 대역 필터 적용)
  const effectiveAudioUrl = selectedBand && filteredAudioUrl ? filteredAudioUrl : audioUrl;

  // 대역 필터 적용: selectedBand가 low/mid/high일 때만 해당 밴드 필터 URL 로드
  useEffect(() => {
    if (!audioUrl || !selectedBand) {
      setFilteredAudioUrl(null);
      return;
    }
    const band = selectedBand as BandId;
    if (filterBlobUrlsRef.current[band]) {
      setFilteredAudioUrl(filterBlobUrlsRef.current[band] ?? null);
      return;
    }
    setFilterLoading(true);
    applyBandFilter(audioUrl, band)
      .then((blobUrl) => {
        filterBlobUrlsRef.current[band] = blobUrl;
        setFilteredAudioUrl(blobUrl);
        setFilterLoading(false);
      })
      .catch(() => setFilterLoading(false));
  }, [audioUrl, selectedBand]);

  useEffect(() => {
    return () => {
      Object.values(filterBlobUrlsRef.current).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
      filterBlobUrlsRef.current = {};
    };
  }, [audioUrl]);

  useEffect(() => {
    if (!effectiveAudioUrl || !containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: WAVEFORM_HEIGHT,
      minPxPerSec: DEFAULT_MIN_PX_PER_SEC,
      waveColor: "rgba(140, 140, 140, 0.38)",
      progressColor: "rgba(26, 115, 232, 0.5)",
      cursorWidth: 2,
      barWidth: 1,
      barGap: 1,
      barRadius: 0,
      normalize: true,
    });
    wavesurferRef.current = ws;
    ws.load(effectiveAudioUrl);
    ws.on("ready", () => {
      const d = ws.getDuration();
      setDuration(d);
      setVisibleRange([0, d]);
    });
    ws.on("scroll", (start: number, end: number) => setVisibleRange([start, end]));
    ws.on("zoom", (newMinPxPerSec: number) => {
      const wrapper = ws.getWrapper();
      const w = wrapper?.clientWidth ?? 0;
      const dur = ws.getDuration();
      if (w > 0 && dur > 0 && newMinPxPerSec > 0) {
        const visibleDur = w / newMinPxPerSec;
        setVisibleRange((prev) => [prev[0], Math.min(dur, prev[0] + visibleDur)]);
      }
    });
    ws.on("audioprocess", (t: number) => setCurrentTime(t));
    ws.on("seeking", (t: number) => setCurrentTime(t));
    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => setIsPlaying(false));
    return () => {
      ws.destroy();
      wavesurferRef.current = null;
    };
  }, [effectiveAudioUrl]);

  useEffect(() => {
    const el = wrapRef.current ?? containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect ?? { width: 0, height: WAVEFORM_HEIGHT };
      setOverlaySize((prev) => ({ width: width || prev.width, height: height || prev.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [effectiveAudioUrl]);

  const keypointsByBand = (data?.keypoints_by_band && typeof data.keypoints_by_band === "object")
    ? data.keypoints_by_band
    : {};
  const textureBlocksByBand = (data?.texture_blocks_by_band && typeof data.texture_blocks_by_band === "object")
    ? data.texture_blocks_by_band
    : {};
  const dur = data?.duration_sec ?? (duration || 1);
  const [visibleStart, visibleEnd] = duration > 0 ? visibleRange : [0, Math.max(1, dur)];
  const visibleDur = Math.max(0.001, visibleEnd - visibleStart);
  const xScale = useCallback(
    (t: number) => (overlaySize.width > 0 && visibleDur > 0 ? ((t - visibleStart) / visibleDur) * overlaySize.width : 0),
    [overlaySize.width, visibleStart, visibleDur]
  );

  const bands = ["low", "mid", "high"] as const;
  const textureBands = ["mid", "high"] as const;

  const currentKeypoints = (keypointsByBand[selectedBand] ?? []) as KeypointByBandItem[];
  const currentTextureBlocks = (selectedBand === "mid" || selectedBand === "high"
    ? (textureBlocksByBand[selectedBand] ?? [])
    : []) as TextureBlockItem[];

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
      <div className="tab13-drum-keypoints-view">
        <p className="placeholder">streams_sections_cnn.json을 로드하세요 (keypoints_by_band, texture_blocks_by_band 포함)</p>
      </div>
    );
  }

  const hasKeypoints =
    Object.keys(keypointsByBand).length > 0 &&
    Object.values(keypointsByBand).some((arr) => Array.isArray(arr) && arr.length > 0);
  const hasTexture =
    Object.keys(textureBlocksByBand).length > 0 &&
    Object.values(textureBlocksByBand).some((arr) => Array.isArray(arr) && arr.length > 0);

  if (!hasKeypoints && !hasTexture) {
    return (
      <div className="tab13-drum-keypoints-view">
        <p className="placeholder">이 JSON에는 keypoints_by_band / texture_blocks_by_band가 없습니다. export/run_stem_folder로 생성한 streams_sections_cnn.json을 로드하세요.</p>
      </div>
    );
  }

  const bandColor = BAND_COLORS[selectedBand] ?? "#5a9fd4";

  return (
    <div className="tab13-drum-keypoints-view">
      <div className="tab13-meta">
        <span>keypoints_by_band: low={(keypointsByBand.low ?? []).length}, mid={(keypointsByBand.mid ?? []).length}, high={(keypointsByBand.high ?? []).length}</span>
        <span>texture_blocks: mid={(textureBlocksByBand.mid ?? []).length}, high={(textureBlocksByBand.high ?? []).length}</span>
        {data.source && <span>소스: {data.source}</span>}
      </div>

      {(hasKeypoints || hasTexture) && (
        <div className="tab13-band-toggle">
          <span className="tab13-band-toggle-label">대역</span>
          <div className="tab13-band-toggle-btns" role="group" aria-label="대역 선택">
            {bands.map((band) => (
              <button
                key={band}
                type="button"
                className={`tab13-band-toggle-btn ${selectedBand === band ? "active" : ""}`}
                onClick={() => setSelectedBand(band)}
                style={selectedBand === band ? { borderColor: BAND_COLORS[band], color: BAND_COLORS[band] } : undefined}
              >
                {band === "low" ? "Low" : band === "mid" ? "Mid" : "High"}
              </button>
            ))}
          </div>
          {selectedBand && (
            <span className="tab13-band-filter-hint">
              {filterLoading ? "필터 적용 중…" : "해당 대역 필터 적용"}
            </span>
          )}
        </div>
      )}

      {audioUrl && (
        <>
          <div className="waveform-controls">
            <button type="button" onClick={togglePlay} disabled={duration === 0 || filterLoading}>
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
          <div className="tab13-waveform-wrap" ref={wrapRef} style={{ position: "relative" }}>
            <div className="waveform-container" ref={containerRef} style={{ minHeight: WAVEFORM_HEIGHT, width: "100%" }} />
            {(hasKeypoints || hasTexture) && dur > 0 && overlaySize.width > 0 && (
              <div
                className="overlay-svg-wrap"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: overlaySize.width,
                  height: overlaySize.height,
                  pointerEvents: "none",
                }}
              >
                <svg width={overlaySize.width} height={overlaySize.height} style={{ display: "block" }}>
                  {currentTextureBlocks.map((blk, i) => {
                    const x = xScale(blk.start);
                    const w = Math.max(2, xScale(blk.end) - x);
                    return (
                      <rect
                        key={`tex-${i}`}
                        x={x}
                        y={2}
                        width={w}
                        height={overlaySize.height - 4}
                        fill={bandColor}
                        opacity={0.25}
                        rx={2}
                      />
                    );
                  })}
                  {(() => {
                    const valid = currentKeypoints.filter(
                      (kp) => kp != null && typeof (kp as KeypointByBandItem).time === "number"
                    );
                    const scores = valid.map((kp) => Math.min(1, Math.max(0, Number((kp as KeypointByBandItem).score ?? 0))));
                    const minS = scores.length ? Math.min(...scores) : 0;
                    const maxS = scores.length ? Math.max(...scores) : 1;
                    const range = maxS - minS || 1;
                    const norm = (s: number) => (s - minS) / range;
                    const MIN_R = 2;
                    const MAX_R = 14;
                    const scoreToR = (s: number) => MIN_R + norm(s) * (MAX_R - MIN_R);
                    return valid.map((kp, i) => {
                      const t = (kp as KeypointByBandItem).time;
                      const score = scores[i];
                      const r = scoreToR(score);
                      return (
                        <circle
                          key={`kp-${t}-${i}`}
                          cx={xScale(t)}
                          cy={overlaySize.height / 2}
                          r={r}
                          fill={bandColor}
                          opacity={0.9}
                        />
                      );
                    });
                  })()}
                  {duration > 0 && (
                    <line
                      x1={xScale(currentTime)}
                      x2={xScale(currentTime)}
                      y1={0}
                      y2={overlaySize.height}
                      stroke="#e74c3c"
                      strokeWidth={2}
                    />
                  )}
                </svg>
              </div>
            )}
          </div>
        </>
      )}

      <details className="tab13-details" style={{ marginTop: 16 }}>
        <summary>keypoints_by_band / texture_blocks_by_band 목록</summary>
        <div className="detail-grid">
          {bands.map((band) => (
            <div key={band}>
              <h4>Keypoints {band}</h4>
              <ul style={{ fontSize: 12, maxHeight: 100, overflow: "auto" }}>
                {(keypointsByBand[band] ?? []).slice(0, 20).map((kp: KeypointByBandItem, i: number) => (
                  <li key={i}>
                    {kp.time.toFixed(2)}s score={kp.score.toFixed(3)}
                  </li>
                ))}
                {(keypointsByBand[band] ?? []).length > 20 && (
                  <li>… 외 {(keypointsByBand[band] ?? []).length - 20}개</li>
                )}
              </ul>
            </div>
          ))}
          {textureBands.map((band) => (
            <div key={`blk-${band}`}>
              <h4>Texture blocks {band}</h4>
              <ul style={{ fontSize: 12, maxHeight: 100, overflow: "auto" }}>
                {(textureBlocksByBand[band] ?? []).slice(0, 15).map((blk: TextureBlockItem, i: number) => (
                  <li key={i}>
                    {blk.start.toFixed(2)}–{blk.end.toFixed(2)}s rep={blk.representative_time.toFixed(2)} n={blk.count}
                  </li>
                ))}
                {(textureBlocksByBand[band] ?? []).length > 15 && (
                  <li>… 외 {(textureBlocksByBand[band] ?? []).length - 15}개</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
