import { useEffect, useRef, useState } from "react";
import type { EventPoint } from "../types/event";

const ACTIVATE_BEFORE_SEC = 0.03;
const ACTIVATE_AFTER_SEC = 0.15;

interface LayerTimelineStripProps {
  label: string;
  events: EventPoint[];
  currentTime: number;
  visibleRange: [number, number];
  height: number;
  /** 행 전체 색상(roles 기반 중복 표시 시 해당 행 색으로 통일) */
  stripColor?: string;
  /** 포인트 기본 opacity (겹침 시 블렌딩 보이게 하려면 0.7~0.8) */
  pointOpacity?: number;
  /** 배경에 파형을 넣을 컨테이너 ref (부모가 WaveSurfer 마운트) */
  waveformBackgroundRef?: React.RefObject<HTMLDivElement | null>;
}

export function LayerTimelineStrip({
  label,
  events,
  currentTime,
  visibleRange,
  height,
  stripColor,
  pointOpacity = 0.6,
  waveformBackgroundRef,
}: LayerTimelineStripProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? 0;
      setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [visibleStart, visibleEnd] = visibleRange;
  const visibleDur = Math.max(0.001, visibleEnd - visibleStart);
  const xScale = (t: number) =>
    width > 0 && visibleDur > 0 ? ((t - visibleStart) / visibleDur) * width : 0;

  const getPointOpacity = (eventTime: number) => {
    const lo = eventTime - ACTIVATE_BEFORE_SEC;
    const hi = eventTime + ACTIVATE_AFTER_SEC;
    if (currentTime >= lo && currentTime <= hi) return 1;
    return pointOpacity;
  };

  const r = Math.max(3, Math.min(6, height * 0.25));
  const cy = height / 2;

  return (
    <div className="layer-timeline-strip">
      <div className="layer-timeline-head">
        <span className="layer-timeline-label">{label}</span>
        <span className="layer-timeline-count">{events.length}개</span>
      </div>
      <div className="layer-timeline-svg-wrap" style={{ position: "relative", height }}>
        {waveformBackgroundRef && (
          <div
            ref={waveformBackgroundRef}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
            aria-hidden
          />
        )}
        <div ref={wrapRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <svg
          width={width}
          height={height}
          style={{ display: "block", pointerEvents: "none" }}
        >
          {events.map((event, i) => (
            <circle
              key={`${event.t}-${i}`}
              cx={xScale(event.t)}
              cy={cy}
              r={r}
              fill={stripColor ?? event.color}
              opacity={getPointOpacity(event.t)}
            />
          ))}
          <line
            x1={xScale(currentTime)}
            x2={xScale(currentTime)}
            y1={0}
            y2={height}
            stroke="#e74c3c"
            strokeWidth={1.5}
          />
        </svg>
        </div>
      </div>
    </div>
  );
}
