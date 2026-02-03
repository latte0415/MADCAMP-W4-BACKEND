import { useEffect, useRef, useState, useMemo } from "react";
import WaveSurfer from "wavesurfer.js";
import { LayerTimelineStrip } from "./LayerTimelineStrip";
import { StreamsTimelineStrip } from "./StreamsTimelineStrip";
import { applyBandFilter, type BandId } from "../utils/bandFilter";
import type { StreamsSectionsData } from "../types/streamsSections";
import type { EventPoint } from "../types/event";

export type BandFilterOption = "all" | BandId;

const WAVEFORM_HEIGHT = 100;
const STRIP_HEIGHT = 44;
const STRIP_ROW_HEIGHT = 68; /* label + strip */
const DEFAULT_MIN_PX_PER_SEC = 50;
const ZOOM_FACTOR = 1.5;
const MIN_ZOOM = 10;
const MAX_ZOOM = 500;
const SECTION_COLORS = ["#3498db22", "#2ecc7122", "#f39c1222", "#e74c3c22", "#9b59b622"];

const LAYER_ORDER = ["P0", "P1", "P2"] as const;
const LAYER_LABELS: Record<string, string> = {
  P0: "P0 (저정밀)",
  P1: "P1 (중정밀)",
  P2: "P2 (고정밀)",
};
const LAYER_COLORS: Record<string, string> = {
  P0: "#2ecc71",
  P1: "#f39c12",
  P2: "#3498db",
};

/** roles 기준: 해당 역할에 band가 하나라도 있으면 해당 레이어 행에 표시 (09 Layer와 동일) */
function eventsForLayer(events: EventPoint[], layer: string): EventPoint[] {
  return events.filter((e) => {
    if (e.roles) {
      const bands = e.roles[layer as keyof typeof e.roles];
      return Array.isArray(bands) && bands.length > 0;
    }
    return e.layer === layer;
  });
}

interface StreamsSectionsViewProps {
  audioUrl: string | null;
  data: StreamsSectionsData | null;
}

const BAND_LABELS: Record<BandFilterOption, string> = {
  all: "전체",
  low: "Low (20–200Hz)",
  mid: "Mid (200–3k)",
  high: "High (3k–10k)",
};

export function StreamsSectionsView({ audioUrl, data }: StreamsSectionsViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const stripBgRef = useRef<HTMLDivElement>(null);
  const stripBgWsRef = useRef<WaveSurfer | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [minPxPerSec, setMinPxPerSec] = useState(DEFAULT_MIN_PX_PER_SEC);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 1]);
  const [selectedBand, setSelectedBand] = useState<BandFilterOption>("all");
  const [filteredCache, setFilteredCache] = useState<Record<BandId, string>>({});
  const [filterLoading, setFilterLoading] = useState(false);
  const blobUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!audioUrl) return;
    return () => {
      blobUrlsRef.current.forEach(URL.revokeObjectURL);
      blobUrlsRef.current = [];
      setFilteredCache({});
    };
  }, [audioUrl]);

  const effectiveAudioUrl =
    selectedBand === "all"
      ? audioUrl
      : filteredCache[selectedBand]
        ? filteredCache[selectedBand]
        : audioUrl;

  useEffect(() => {
    if (!audioUrl) return;
    if (selectedBand === "all") return;
    if (filteredCache[selectedBand]) return;
    let cancelled = false;
    setFilterLoading(true);
    applyBandFilter(audioUrl, selectedBand)
      .then((blobUrl) => {
        if (!cancelled) {
          blobUrlsRef.current.push(blobUrl);
          setFilteredCache((prev) => ({ ...prev, [selectedBand]: blobUrl }));
        } else {
          URL.revokeObjectURL(blobUrl);
        }
      })
      .finally(() => {
        if (!cancelled) setFilterLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [audioUrl, selectedBand, filteredCache]);

  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach(URL.revokeObjectURL);
      blobUrlsRef.current = [];
    };
  }, []);

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

  const numStripRows = data?.events ? 1 + LAYER_ORDER.length : 0;
  const totalStripBlockHeight = numStripRows * STRIP_ROW_HEIGHT;

  useEffect(() => {
    if (!effectiveAudioUrl || !data?.events?.length || !stripBgRef.current || totalStripBlockHeight <= 0) return;

    const el = stripBgRef.current;
    const bgWs = WaveSurfer.create({
      container: el,
      height: totalStripBlockHeight,
      minPxPerSec: minPxPerSec,
      waveColor: "rgba(140, 140, 140, 0.32)",
      progressColor: "transparent",
      cursorWidth: 0,
      barWidth: 1,
      barGap: 1,
      barRadius: 0,
      normalize: true,
    });
    stripBgWsRef.current = bgWs;
    bgWs.load(effectiveAudioUrl);

    const mainWs = wavesurferRef.current;
    const syncScroll = () => {
      const mW = mainWs?.getWrapper();
      const bW = bgWs.getWrapper();
      if (mW && bW) bW.scrollLeft = mW.scrollLeft;
    };
    mainWs?.on("scroll", syncScroll);
    bgWs.on("ready", syncScroll);

    return () => {
      mainWs?.un("scroll", syncScroll);
      bgWs.destroy();
      stripBgWsRef.current = null;
    };
  }, [effectiveAudioUrl, data?.events?.length, totalStripBlockHeight]);

  useEffect(() => {
    const bg = stripBgWsRef.current;
    if (bg) bg.zoom(minPxPerSec);
  }, [minPxPerSec]);

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

  const eventsByLayer = useMemo(
    () =>
      data?.events
        ? LAYER_ORDER.map((layer) => ({
            layer,
            events: eventsForLayer(data.events!, layer),
          }))
        : [],
    [data?.events]
  );

  if (!data) {
    return (
      <div className="streams-sections-view">
        <p className="placeholder">스트림·파트 JSON을 로드하세요 (streams_sections.json)</p>
      </div>
    );
  }

  const { streams, sections, keypoints, duration_sec } = data;
  const dur = duration_sec || duration || 1;
  const stripVisibleRange: [number, number] =
    duration > 0 ? visibleRange : [0, Math.max(1, duration_sec ?? 1)];
  const currentSection = sections.find(
    (sec) => currentTime >= sec.start && currentTime < sec.end
  ) ?? null;

  return (
    <div className="streams-sections-view">
      <div className="streams-sections-meta">
        <span>스트림 {streams.length}개</span>
        <span>섹션 {sections.length}개</span>
        <span>키포인트 {keypoints.length}개</span>
        {data.events && <span>이벤트(P0/P1/P2) {data.events.length}개</span>}
        {data.source && <span>소스: {data.source}</span>}
      </div>

      {audioUrl && (
        <>
          <div className="band-filter-section">
            <span className="band-filter-label">밴드별 청취 / 스트림만 보기</span>
            <div className="band-filter-btns" role="group" aria-label="밴드 선택">
              {(["all", "low", "mid", "high"] as const).map((band) => (
                <button
                  key={band}
                  type="button"
                  className={`band-filter-btn ${selectedBand === band ? "active" : ""}`}
                  onClick={() => setSelectedBand(band)}
                  disabled={filterLoading && selectedBand !== band}
                  title={band === "all" ? "전체 대역" : `${BAND_LABELS[band]}만 재생·표시`}
                >
                  {BAND_LABELS[band]}
                </button>
              ))}
            </div>
            {filterLoading && selectedBand !== "all" && (
              <span className="band-filter-loading">필터 적용 중…</span>
            )}
          </div>
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
          <div className="waveform-container" ref={containerRef} style={{ minHeight: WAVEFORM_HEIGHT }} />
        </>
      )}

      {streams.length > 0 && dur > 0 && (
        <div className="streams-visual-wrap" style={{ marginTop: 12 }}>
          <StreamsTimelineStrip
            streams={streams}
            durationSec={dur}
            visibleRange={stripVisibleRange}
            currentTime={currentTime}
            bandsFilter={selectedBand === "all" ? undefined : [selectedBand]}
          />
        </div>
      )}

      {sections.length > 0 && dur > 0 && (
        <div className="sections-ruler-wrap" style={{ marginTop: 8 }}>
          {currentSection != null && (
            <div className="sections-current-label" style={{ fontSize: 12, color: "#5a9fd4", marginBottom: 4 }}>
              현재: 섹션 {currentSection.id} ({currentSection.start.toFixed(1)}–{currentSection.end.toFixed(1)}s)
            </div>
          )}
          <div className="sections-ruler" style={{ position: "relative", height: 24 }}>
            {sections.map((sec, i) => {
              const isCurrent = currentSection?.id === sec.id;
              return (
                <div
                  key={sec.id}
                  className={`section-bar ${isCurrent ? "section-bar-current" : ""}`}
                  style={{
                    position: "absolute",
                    left: `${(sec.start / dur) * 100}%`,
                    width: `${((sec.end - sec.start) / dur) * 100}%`,
                    height: "100%",
                    backgroundColor: SECTION_COLORS[i % SECTION_COLORS.length],
                    borderLeft: "1px solid #3498db",
                    boxSizing: "border-box",
                    ...(isCurrent ? { boxShadow: "inset 0 0 0 2px rgba(90, 159, 212, 0.8)" } : {}),
                  }}
                  title={`섹션 ${sec.id} ${sec.start.toFixed(1)}–${sec.end.toFixed(1)}s`}
                />
              );
            })}
          </div>
        </div>
      )}

      {data.events && data.events.length > 0 && (
        <div className="tab09-layer-rows" style={{ marginTop: 12, position: "relative" }}>
          <div
            ref={stripBgRef}
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: totalStripBlockHeight,
              zIndex: 0,
            }}
          />
          <div style={{ position: "relative", zIndex: 1 }}>
            <LayerTimelineStrip
              label="포인트 (P0/P1/P2 겹침)"
              events={data.events}
              currentTime={currentTime}
              visibleRange={stripVisibleRange}
              height={STRIP_HEIGHT}
              pointOpacity={0.72}
            />
            {eventsByLayer.length > 0 &&
              eventsByLayer.map(({ layer, events: layerEvents }) => (
                <LayerTimelineStrip
                  key={layer}
                  label={LAYER_LABELS[layer] ?? layer}
                  events={layerEvents}
                  currentTime={currentTime}
                  visibleRange={stripVisibleRange}
                  height={STRIP_HEIGHT}
                  stripColor={LAYER_COLORS[layer]}
                />
              ))}
          </div>
        </div>
      )}

      <details className="streams-sections-details" style={{ marginTop: 16 }}>
        <summary>스트림 / 섹션 / 키포인트 목록</summary>
        <div className="detail-grid">
          <div>
            <h4>스트림</h4>
            <ul style={{ fontSize: 12, maxHeight: 120, overflow: "auto" }}>
              {streams.map((s) => (
                <li key={s.id}>
                  {s.id} ({s.band}) {s.start.toFixed(2)}–{s.end.toFixed(2)}s, 이벤트 {s.events?.length ?? 0}개
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4>섹션</h4>
            <ul style={{ fontSize: 12, maxHeight: 120, overflow: "auto" }}>
              {sections.map((sec) => {
                const isCurrent = currentSection?.id === sec.id;
                return (
                  <li
                    key={sec.id}
                    className={isCurrent ? "section-list-item-current" : ""}
                    style={isCurrent ? { fontWeight: 600, color: "#5a9fd4" } : undefined}
                  >
                    {sec.id}: {sec.start.toFixed(2)}–{sec.end.toFixed(2)}s
                    {isCurrent ? " ← 현재" : ""}
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <h4>키포인트</h4>
            <ul style={{ fontSize: 12, maxHeight: 120, overflow: "auto" }}>
              {keypoints.slice(0, 30).map((kp, i) => (
                <li key={i}>
                  {kp.time.toFixed(2)}s {kp.type} {kp.label ?? ""}
                </li>
              ))}
              {keypoints.length > 30 && <li>… 외 {keypoints.length - 30}개</li>}
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}
