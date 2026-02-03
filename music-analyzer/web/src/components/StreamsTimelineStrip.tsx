import { useEffect, useRef, useState } from "react";
import type { StreamItem } from "../types/streamsSections";

const ROW_HEIGHT = 32;
const BAND_COLORS: Record<string, string> = {
  low: "#2ecc71",
  mid: "#f39c12",
  high: "#3498db",
};

interface StreamsTimelineStripProps {
  streams: StreamItem[];
  durationSec: number;
  visibleRange: [number, number];
  currentTime: number;
  /** 표시할 band만 (비어 있으면 전부) */
  bandsFilter?: string[];
}

export function StreamsTimelineStrip({
  streams,
  durationSec: _durationSec,
  visibleRange,
  currentTime,
  bandsFilter,
}: StreamsTimelineStripProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect?.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [visibleStart, visibleEnd] = visibleRange;
  const visibleDur = Math.max(0.001, visibleEnd - visibleStart);
  const xScale = (t: number) =>
    width > 0 && visibleDur > 0 ? ((t - visibleStart) / visibleDur) * width : 0;
  const xSpan = (tStart: number, tEnd: number) => {
    const x0 = xScale(tStart);
    const x1 = xScale(tEnd);
    return { x: Math.min(x0, x1), w: Math.max(1, Math.abs(x1 - x0)) };
  };

  const bands = bandsFilter?.length ? bandsFilter : ["low", "mid", "high"];
  const orderedStreams = streams
    .filter((s) => bands.includes(s.band))
    .sort((a, b) => {
      if (a.band !== b.band) return bands.indexOf(a.band) - bands.indexOf(b.band);
      return a.start - b.start;
    });

  if (orderedStreams.length === 0) {
    return (
      <div className="streams-timeline-strip">
        <div className="streams-timeline-head">
          <span className="streams-timeline-label">스트림 (band별)</span>
          <span className="streams-timeline-count">스트림 없음</span>
        </div>
      </div>
    );
  }

  const totalHeight = orderedStreams.length * ROW_HEIGHT;

  return (
    <div className="streams-timeline-strip">
      <div className="streams-timeline-head">
        <span className="streams-timeline-label">스트림 (band별) — 재생 커서와 맞춰 들으면서 확인</span>
        <span className="streams-timeline-count">스트림 {orderedStreams.length}개</span>
      </div>
      <div className="streams-timeline-body">
        <div className="streams-timeline-legend" style={{ height: totalHeight }}>
          {orderedStreams.map((stream) => (
            <div
              key={stream.id}
              className="streams-timeline-row-legend"
              style={{ height: ROW_HEIGHT }}
            >
              <span
                className="streams-timeline-stream-id"
                style={{ color: BAND_COLORS[stream.band] ?? "#888" }}
              >
                {stream.id}
              </span>
              <span className="streams-timeline-stream-meta">
                {stream.start.toFixed(1)}–{stream.end.toFixed(1)}s · {stream.events?.length ?? 0}개
              </span>
            </div>
          ))}
        </div>
        <div className="streams-timeline-svg-wrap" ref={wrapRef} style={{ height: totalHeight, flex: 1 }}>
          <svg width={width} height={totalHeight} style={{ display: "block" }}>
            {orderedStreams.map((stream, rowIndex) => {
              const y = rowIndex * ROW_HEIGHT;
              const cy = y + ROW_HEIGHT / 2;
              const bandColor = BAND_COLORS[stream.band] ?? "#888";
              const { x: segX, w: segW } = xSpan(stream.start, stream.end);
              const events = stream.events ?? [];

              return (
                <g key={stream.id}>
                  <rect
                    x={segX}
                    y={y + 4}
                    width={segW}
                    height={ROW_HEIGHT - 8}
                    fill={bandColor}
                    fillOpacity={0.35}
                    stroke={bandColor}
                    strokeWidth={1}
                  />
                  {events.map((t, i) => (
                    <circle
                      key={`${stream.id}-${t}-${i}`}
                      cx={xScale(t)}
                      cy={cy}
                      r={3}
                      fill={bandColor}
                      opacity={0.95}
                    />
                  ))}
                </g>
              );
            })}
            <line
              x1={xScale(currentTime)}
              x2={xScale(currentTime)}
              y1={0}
              y2={totalHeight}
              stroke="#e74c3c"
              strokeWidth={1.5}
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
