import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  MusicKeypoint,
  BassNote,
  StemUrls,
  MusicAnalysisDetail,
  DrumKeypointByBandItem,
  VocalCurvePoint,
  OtherCurvePoint,
} from '../types';

interface AudioDetailAnalysisSectionProps {
  audioUrl?: string | null;
  stemUrls?: StemUrls;
  musicDetail?: MusicAnalysisDetail;
  duration: number;
  currentTime: number;
  selectionStart: number;
  selectionDuration: number;
  musicKeypoints: MusicKeypoint[];
  bassNotes?: BassNote[];
  onSeek?: (time: number) => void;
}

type DrumBand = 'low' | 'mid' | 'high';

type DetailTab = 'drums' | 'bass' | 'vocal' | 'other';

const BAR_SECONDS = 4;
const WAVEFORM_HEIGHT = 120;
const BASE_PX_PER_SEC = 120;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 4;
const ACTIVATE_BEFORE_SEC = 0.03;
const ACTIVATE_AFTER_SEC = 0.15;

const STEM_COLORS: Record<DetailTab | DrumBand, string> = {
  drums: '#f59e0b',
  bass: '#10b981',
  vocal: '#f472b6',
  other: '#38bdf8',
  low: '#f59e0b',
  mid: '#fbbf24',
  high: '#fb7185',
};

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function AudioDetailAnalysisSection({
  audioUrl,
  stemUrls,
  musicDetail,
  duration,
  currentTime,
  selectionStart,
  selectionDuration,
  musicKeypoints,
  bassNotes = [],
  onSeek,
}: AudioDetailAnalysisSectionProps) {
  const [visibleStems, setVisibleStems] = useState<DetailTab[]>(['drums', 'bass', 'vocal', 'other']);
  const [visibleDrumBands, setVisibleDrumBands] = useState<DrumBand[]>(['low', 'mid', 'high']);
  const [zoom, setZoom] = useState(1);
  const [waveformByStem, setWaveformByStem] = useState<
    Partial<Record<DetailTab, Float32Array | null>>
  >({});
  const waveformRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const waveformStemKeys = useRef<(DetailTab | null)[]>([]);
  const playheadRefs = useRef<(HTMLDivElement | null)[]>([]);
  const currentTimeRef = useRef(currentTime);
  const smoothTimeRef = useRef(currentTime);
  const lastFrameRef = useRef<number | null>(null);

  const selectionEnd = selectionStart + selectionDuration;
  const viewDuration = Math.max(0.001, selectionDuration);
  const pxPerSec = BASE_PX_PER_SEC * zoom;
  const timelineWidth = Math.max(viewDuration * pxPerSec, 480);
  const barMarkers = useMemo(() => {
    if (selectionDuration <= 0) return [];
    const markers: number[] = [];
    for (let t = selectionStart; t <= selectionEnd + 0.0001; t += BAR_SECONDS) {
      markers.push(t);
    }
    return markers;
  }, [selectionDuration, selectionStart, selectionEnd]);

  const drumEventsByBand = useMemo(
    () => ({
      low: musicKeypoints.filter((kp) => kp.frequency === 'low'),
      mid: musicKeypoints.filter((kp) => kp.frequency === 'mid'),
      high: musicKeypoints.filter((kp) => kp.frequency === 'high'),
    }),
    [musicKeypoints]
  );
  const vocalEvents = useMemo(
    () => musicKeypoints.filter((kp) => kp.frequency === 'high'),
    [musicKeypoints]
  );
  const otherEvents = useMemo(() => musicKeypoints.filter((kp) => kp.frequency === 'mid'), [musicKeypoints]);
  const drumKeypointsByBand = musicDetail?.keypointsByBand ?? {};
  const bassDetail = musicDetail?.bass;
  const vocalDetail = musicDetail?.vocal;
  const otherDetail = musicDetail?.other;
  const resolvedBassNotes = (bassDetail?.notes?.length ? bassDetail.notes : bassNotes) ?? [];
  const vocalCurve = (vocalDetail?.vocal_curve ?? []).filter(
    (p): p is VocalCurvePoint => Number.isFinite(Number(p?.t)) && Number.isFinite(Number(p?.pitch))
  );
  const vocalPhrases = (vocalDetail?.vocal_phrases ?? []).filter(
    (p) => Number.isFinite(Number(p?.start)) && Number.isFinite(Number(p?.end))
  );
  const vocalTurns = (vocalDetail?.vocal_turns ?? []).filter((p) => Number.isFinite(Number(p?.t)));
  const vocalOnsets = (vocalDetail?.vocal_onsets ?? []).filter((p) => Number.isFinite(Number(p?.t)));
  const otherCurve = (otherDetail?.other_curve ?? []).filter(
    (p): p is OtherCurvePoint => Number.isFinite(Number(p?.t))
  );
  const stemAudioUrls = useMemo(
    () => ({
      drums: stemUrls?.drums ?? audioUrl ?? null,
      bass: stemUrls?.bass ?? audioUrl ?? null,
      vocal: stemUrls?.vocal ?? audioUrl ?? null,
      other: stemUrls?.other ?? audioUrl ?? null,
    }),
    [audioUrl, stemUrls]
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const inRange = resolvedBassNotes.filter(
      (note) => note.time >= selectionStart && note.time <= selectionEnd
    );
    const times = resolvedBassNotes.map((n) => n.time).filter((t) => Number.isFinite(t));
    const minTime = times.length ? Math.min(...times) : null;
    const maxTime = times.length ? Math.max(...times) : null;
    // Debug-only visibility checks for bass overlays.
    console.debug('[AudioDetailAnalysisSection] bass debug', {
      totalBassNotes: resolvedBassNotes.length,
      bassNotesInSelection: inRange.length,
      selectionStart,
      selectionEnd,
      minBassTime: minTime,
      maxBassTime: maxTime,
      hasBassDetail: Boolean(bassDetail),
      hasMusicDetail: Boolean(musicDetail),
      sampleNote: resolvedBassNotes[0] ?? null,
    });
  }, [resolvedBassNotes, selectionStart, selectionEnd, bassDetail, musicDetail]);

  useEffect(() => {
    if (duration <= 0) {
      setWaveformByStem({});
      return;
    }
    let cancelled = false;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const loadWaveform = async (url: string | null) => {
      if (!url) return null;
      try {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        const buffer = await ctx.decodeAudioData(buf);
        const ch = buffer.getChannelData(0);
        const step = Math.max(1, Math.floor(ch.length / (buffer.duration * 60)));
        const samples: number[] = [];
        for (let i = 0; i < ch.length; i += step) {
          samples.push(Math.abs(ch[i]));
        }
        return new Float32Array(samples);
      } catch {
        return null;
      }
    };
    const loadAll = async () => {
      const next: Partial<Record<DetailTab, Float32Array | null>> = {};
      const stems: DetailTab[] = ['drums', 'bass', 'vocal', 'other'];
      for (const stem of stems) {
        next[stem] = await loadWaveform(stemAudioUrls[stem]);
        if (cancelled) return;
      }
      if (!cancelled) setWaveformByStem(next);
    };
    loadAll();
    return () => {
      cancelled = true;
      ctx.close();
    };
  }, [
    duration,
    stemAudioUrls.drums,
    stemAudioUrls.bass,
    stemAudioUrls.vocal,
    stemAudioUrls.other,
  ]);

  useEffect(() => {
    if (duration <= 0 || selectionDuration <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    waveformRefs.current.forEach((canvas, index) => {
      if (!canvas) return;
      const stemKey = waveformStemKeys.current[index];
      const waveformData = stemKey ? waveformByStem[stemKey] ?? null : null;
      const samplesPerSec = waveformData && waveformData.length > 0 ? waveformData.length / duration : 0;
      const startIndex = waveformData
        ? clamp(Math.floor(selectionStart * samplesPerSec), 0, waveformData.length)
        : 0;
      const endIndex = waveformData
        ? clamp(Math.ceil(selectionEnd * samplesPerSec), 0, waveformData.length)
        : 0;
      const slice = waveformData ? waveformData.subarray(startIndex, endIndex) : null;
      const rect = canvas.getBoundingClientRect();
      const height = rect.height || WAVEFORM_HEIGHT;
      canvas.width = timelineWidth * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${timelineWidth}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, timelineWidth, height);
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, timelineWidth, height);

      if (slice && slice.length > 0) {
        const centerY = height / 2;
        const step = slice.length > 0 ? timelineWidth / slice.length : timelineWidth;
        ctx.fillStyle = 'rgba(150, 150, 150, 0.28)';
        for (let i = 0; i < slice.length; i++) {
          const x = i * step;
          const v = slice[i] ?? 0;
          const barHeight = Math.max(2, v * centerY);
          ctx.fillRect(x, centerY - barHeight / 2, Math.max(1, step), barHeight);
        }
      }

      for (let t = selectionStart; t <= selectionEnd + 0.0001; t += BAR_SECONDS) {
        const x = ((t - selectionStart) / viewDuration) * timelineWidth;
        ctx.strokeStyle = 'rgba(120,120,120,0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
  }, [
    duration,
    selectionStart,
    selectionEnd,
    selectionDuration,
    timelineWidth,
    viewDuration,
    waveformByStem,
  ]);

  const handleZoomIn = () => setZoom((prev) => clamp(prev * 1.35, MIN_ZOOM, MAX_ZOOM));
  const handleZoomOut = () => setZoom((prev) => clamp(prev / 1.35, MIN_ZOOM, MAX_ZOOM));

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek || duration <= 0) return;
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const scrollLeft = container.scrollLeft;
    const x = e.clientX - rect.left + scrollLeft;
    const time = selectionStart + (x / timelineWidth) * viewDuration;
    onSeek(clamp(time, 0, duration));
  };

  if (selectionDuration <= 0 || duration <= 0) return null;

  const selectionBars = Math.max(1, Math.round(selectionDuration / BAR_SECONDS));
  const clampedTime = clamp(currentTime, selectionStart, selectionEnd);
  const xScale = (t: number) => ((t - selectionStart) / viewDuration) * timelineWidth;
  const isActiveAtTime = (t: number, span?: number) => {
    if (!Number.isFinite(t)) return false;
    if (span != null && span > 0) {
      return clampedTime >= t && clampedTime <= t + span;
    }
    return clampedTime >= t - ACTIVATE_BEFORE_SEC && clampedTime <= t + ACTIVATE_AFTER_SEC;
  };

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    let rafId: number | null = null;
    const tick = () => {
      const now = performance.now();
      const last = lastFrameRef.current ?? now;
      const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
      lastFrameRef.current = now;
      const t = clamp(currentTimeRef.current, selectionStart, selectionEnd);
      const prev = smoothTimeRef.current;
      const alpha = 1 - Math.exp(-dt * 20);
      const next = prev + (t - prev) * alpha;
      smoothTimeRef.current = Number.isFinite(next) ? next : t;
      const x = xScale(smoothTimeRef.current);
      playheadRefs.current.forEach((el) => {
        if (!el) return;
        el.style.transform = `translate3d(${x}px, 0, 0)`;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [selectionStart, selectionEnd, viewDuration, timelineWidth]);

  useEffect(() => {
    smoothTimeRef.current = clamp(currentTimeRef.current, selectionStart, selectionEnd);
    lastFrameRef.current = null;
  }, [selectionStart, selectionEnd]);
  // playheadX no longer needed; playhead is rendered via DOM for smooth motion

  const renderDrumBandOverlay = (band: DrumBand, height: number) => {
    const events = drumKeypointsByBand[band]?.length
      ? drumKeypointsByBand[band]!
      : drumEventsByBand[band];
    const textureBlocks = musicDetail?.textureBlocksByBand?.[band] ?? [];
    return (
      <svg width={timelineWidth} height={height} style={{ display: 'block' }}>
        {textureBlocks
          .filter((blk) => blk.end >= selectionStart && blk.start <= selectionEnd)
          .map((blk, index) => {
            const x = xScale(Math.max(blk.start, selectionStart));
            const w = Math.max(2, xScale(Math.min(blk.end, selectionEnd)) - x);
            const intensity = clamp(Number(blk.intensity ?? blk.density ?? 0.4), 0, 1);
            return (
              <rect
                key={`drum-tex-${band}-${index}`}
                x={x}
                y={2}
                width={w}
                height={height - 4}
                fill={STEM_COLORS[band]}
                opacity={0.12 + intensity * 0.28}
                rx={2}
              />
            );
          })}
        {events
          .filter((kp: any) => kp.time >= selectionStart && kp.time <= selectionEnd)
          .map((kp: any, index: number) => {
            const score = clamp(Number(kp.score ?? kp.intensity ?? 0.6), 0, 1);
            const r = 2 + score * 6;
            const isActive = isActiveAtTime(kp.time);
            return (
              <circle
                key={`drum-${band}-${kp.time}-${index}`}
                cx={xScale(kp.time)}
                cy={height / 2}
                r={isActive ? r + 2 : r}
                fill={STEM_COLORS[band]}
                opacity={isActive ? 1 : 0.35 + score * 0.6}
                stroke={isActive ? '#fff' : 'none'}
                strokeWidth={isActive ? 2 : 0}
              />
            );
          })}
      </svg>
    );
  };

  const renderOverlayFor = (tab: DetailTab) => {
    if (tab === 'bass') {
      const groove = (bassDetail?.groove_curve ?? []).filter(
        (p: [number, number]) => p[0] >= selectionStart && p[0] <= selectionEnd
      );
      const v3 = (bassDetail?.bass_curve_v3 ?? []).filter(
        (p) => p.t >= selectionStart && p.t <= selectionEnd
      );
      const bassPitchToY = (midi: number) => {
        const hz = 440 * Math.pow(2, (midi - 69) / 12);
        const minHz = 50;
        const maxHz = 250;
        const logMin = Math.log(minHz);
        const logMax = Math.log(maxHz);
        const norm = (Math.log(Math.max(hz, minHz)) - logMin) / (logMax - logMin);
        const clamped = clamp(norm, 0, 1);
        const pad = 8;
        const innerH = Math.max(0, WAVEFORM_HEIGHT - 2 * pad);
        return pad + (1 - clamped) * innerH;
      };
      return (
        <svg width={timelineWidth} height={WAVEFORM_HEIGHT} style={{ display: 'block' }}>
          {resolvedBassNotes
            .filter((note) => note.time >= selectionStart && note.time <= selectionEnd)
            .map((note, index) => {
              const x = xScale(note.time);
              const w = Math.max(4, ((note.duration ?? 0) / viewDuration) * timelineWidth);
              const isActive = isActiveAtTime(note.time, note.duration);
              return (
                <rect
                  key={`bass-${index}`}
                  x={x}
                  y={WAVEFORM_HEIGHT * 0.55}
                  width={w}
                  height={WAVEFORM_HEIGHT * 0.25}
                  fill={STEM_COLORS.bass}
                  opacity={isActive ? 0.9 : 0.6}
                  stroke={isActive ? '#fff' : 'none'}
                  strokeWidth={isActive ? 1.5 : 0}
                  rx={2}
                />
              );
            })}
          {v3.length > 1 &&
            v3.slice(1).map((pt, index) => {
              const prev = v3[index];
              if (!prev) return null;
              const amp = clamp(Math.max(prev.amp ?? 0, pt.amp ?? 0), 0, 1);
              if (amp < 0.05) return null;
              const stroke = 1 + amp * 6;
              return (
                <line
                  key={`bass-v3-${index}`}
                  x1={xScale(prev.t)}
                  y1={bassPitchToY(prev.pitch)}
                  x2={xScale(pt.t)}
                  y2={bassPitchToY(pt.pitch)}
                  stroke="#34d399"
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  opacity={0.25 + amp * 0.6}
                />
              );
            })}
          {groove.length > 1 &&
            groove.slice(1).map((pt, index) => {
              const prev = groove[index];
              const t0 = prev?.[0] ?? 0;
              const t1 = pt[0];
              const v0 = clamp(prev?.[1] ?? 0, 0, 1);
              const v1 = clamp(pt[1] ?? 0, 0, 1);
              const y0 = WAVEFORM_HEIGHT * 0.85 - v0 * (WAVEFORM_HEIGHT * 0.55);
              const y1 = WAVEFORM_HEIGHT * 0.85 - v1 * (WAVEFORM_HEIGHT * 0.55);
              const stroke = 2 + Math.max(v0, v1) * 6;
              return (
                <line
                  key={`groove-${index}`}
                  x1={xScale(t0)}
                  y1={y0}
                  x2={xScale(t1)}
                  y2={y1}
                  stroke={STEM_COLORS.bass}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  opacity={0.4 + Math.max(v0, v1) * 0.5}
                />
              );
            })}
          {groove.map((pt, index) => {
            const t = pt[0];
            const v = clamp(pt[1], 0, 1);
            if (v < 0.15) return null;
            const y = WAVEFORM_HEIGHT * 0.85 - v * (WAVEFORM_HEIGHT * 0.55);
            const tailLen = 12 + v * 24;
            const tailOpacity = 0.15 + v * 0.35;
            return (
              <line
                key={`groove-tail-${index}`}
                x1={xScale(t)}
                y1={y}
                x2={xScale(t + (tailLen / timelineWidth) * viewDuration)}
                y2={y}
                stroke={STEM_COLORS.bass}
                strokeWidth={2 + v * 4}
                strokeLinecap="round"
                opacity={tailOpacity}
              />
            );
          })}
        </svg>
      );
    }

    if (tab === 'vocal') {
      const pitchMinHz = 80;
      const pitchMaxHz = 1000;
      const logMin = Math.log(pitchMinHz);
      const logMax = Math.log(pitchMaxHz);
      const pitchToY = (midi: number) => {
        const hz = 440 * Math.pow(2, (midi - 69) / 12);
        const norm = (Math.log(Math.max(hz, pitchMinHz)) - logMin) / (logMax - logMin);
        const clamped = clamp(norm, 0, 1);
        const pad = 8;
        const innerH = Math.max(0, WAVEFORM_HEIGHT - 2 * pad);
        return pad + (1 - clamped) * innerH;
      };
      const filtered = vocalCurve.filter((p) => p.t >= selectionStart && p.t <= selectionEnd);
      if (filtered.length < 2) {
        return (
          <svg width={timelineWidth} height={WAVEFORM_HEIGHT} style={{ display: 'block' }}>
            {vocalEvents
              .filter((kp) => kp.time >= selectionStart && kp.time <= selectionEnd)
              .map((kp, index) => (
                <circle
                  key={`vocal-kp-${kp.time}-${index}`}
                  cx={xScale(kp.time)}
                  cy={WAVEFORM_HEIGHT / 2}
                  r={2 + clamp(kp.intensity ?? 0.6, 0.1, 1) * 10}
                  fill={STEM_COLORS.vocal}
                  opacity={0.9}
                />
              ))}
          </svg>
        );
      }
      const maxPoints = 800;
      const step = filtered.length > maxPoints ? Math.ceil(filtered.length / maxPoints) : 1;
      const sliced = step > 1 ? filtered.filter((_, i) => i % step === 0) : filtered;
      const gridMidi = [36, 42, 48, 54, 60];
      return (
        <svg width={timelineWidth} height={WAVEFORM_HEIGHT} style={{ display: 'block' }}>
          {gridMidi.map((midi) => (
            <line
              key={`vocal-grid-${midi}`}
              x1={0}
              x2={timelineWidth}
              y1={pitchToY(midi)}
              y2={pitchToY(midi)}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
              strokeDasharray="2 4"
            />
          ))}
          {vocalPhrases
            .filter((ph) => ph.end >= selectionStart && ph.start <= selectionEnd)
            .map((ph, index) => {
              const x = xScale(Math.max(ph.start, selectionStart));
              const w = Math.max(2, xScale(Math.min(ph.end, selectionEnd)) - x);
              return (
                <rect
                  key={`vocal-phrase-${index}`}
                  x={x}
                  y={2}
                  width={w}
                  height={WAVEFORM_HEIGHT - 4}
                  fill={STEM_COLORS.vocal}
                  opacity={index % 2 === 0 ? 0.08 : 0.14}
                  rx={2}
                />
              );
            })}
          {sliced.slice(1).map((p, index) => {
            const prev = sliced[index];
            if (!prev) return null;
            const amp = clamp(Math.max(Number(prev.amp ?? 0), Number(p.amp ?? 0)), 0, 1);
            if (amp < 0.05) return null;
            const stroke = 1 + amp * 6;
            return (
              <line
                key={`vocal-${index}`}
                x1={xScale(prev.t)}
                y1={pitchToY(prev.pitch)}
                x2={xScale(p.t)}
                y2={pitchToY(p.pitch)}
                stroke={STEM_COLORS.vocal}
                strokeWidth={stroke}
                strokeLinecap="round"
                opacity={0.2 + amp * 0.7}
              />
            );
          })}
          {vocalTurns
            .filter((t) => t.t >= selectionStart && t.t <= selectionEnd)
            .map((t, index) => {
              const isActive = isActiveAtTime(t.t);
              const size = isActive ? 7 : 5;
              const cx = xScale(t.t);
              const cy = WAVEFORM_HEIGHT * 0.25;
              const up = t.direction === 'down_to_up' || (t.direction !== 'up_to_down' && !t.direction);
              const pts = up
                ? `${cx},${cy - size} ${cx - size},${cy + size} ${cx + size},${cy + size}`
                : `${cx},${cy + size} ${cx - size},${cy - size} ${cx + size},${cy - size}`;
              return (
                <polygon
                  key={`vocal-turn-${index}`}
                  points={pts}
                  fill="#facc15"
                  opacity={isActive ? 1 : 0.7}
                  stroke={isActive ? '#fff' : 'none'}
                  strokeWidth={isActive ? 1.5 : 0}
                />
              );
            })}
          {vocalOnsets
            .filter((t) => t.t >= selectionStart && t.t <= selectionEnd)
            .map((t, index) => (
              <circle
                key={`vocal-onset-${index}`}
                cx={xScale(t.t)}
                cy={WAVEFORM_HEIGHT * 0.75}
                r={isActiveAtTime(t.t) ? 5 : 3}
                fill="#f472b6"
                opacity={isActiveAtTime(t.t) ? 1 : 0.75}
                stroke={isActiveAtTime(t.t) ? '#fff' : 'none'}
                strokeWidth={isActiveAtTime(t.t) ? 1.5 : 0}
              />
            ))}
        </svg>
      );
    }

    if (tab === 'other') {
      const regions = (otherDetail?.other_regions ?? []).filter(
        (r) => r.end >= selectionStart && r.start <= selectionEnd
      );
      const keypoints = (otherDetail?.other_keypoints ?? []).filter(
        (k) => k.t >= selectionStart && k.t <= selectionEnd
      );
      const curve = otherCurve.filter((p) => p.t >= selectionStart && p.t <= selectionEnd);
      const pitchVals = curve
        .map((p) => p.pitch)
        .filter((v): v is number => v != null && Number.isFinite(v));
      const pitchMin = pitchVals.length ? Math.min(...pitchVals) : 0;
      const pitchMax = pitchVals.length ? Math.max(...pitchVals) : 1;
      const hasPitch = pitchVals.length > 0;
      const pitchToY = (pitch: number) => {
        const pad = 8;
        const innerH = Math.max(0, WAVEFORM_HEIGHT - 2 * pad);
        const range = Math.max(1, pitchMax - pitchMin);
        const v = (pitch - pitchMin) / range;
        return pad + (1 - v) * innerH;
      };
      const densityToY = (density: number) => {
        const pad = 8;
        const innerH = Math.max(0, WAVEFORM_HEIGHT - 2 * pad);
        const v = clamp(density, 0, 1);
        return pad + (1 - v) * innerH;
      };
      const nearestCurvePoint = (t: number) => {
        if (curve.length === 0) return null;
        let nearest = curve[0]!;
        let best = Math.abs(nearest.t - t);
        for (let i = 1; i < curve.length; i++) {
          const pt = curve[i]!;
          const d = Math.abs(pt.t - t);
          if (d < best) {
            best = d;
            nearest = pt;
          }
        }
        return nearest;
      };
      if (regions.length === 0 && keypoints.length === 0 && curve.length < 2) {
        return (
          <svg width={timelineWidth} height={WAVEFORM_HEIGHT} style={{ display: 'block' }}>
            {otherEvents
              .filter((kp) => kp.time >= selectionStart && kp.time <= selectionEnd)
              .map((kp, index) => (
                <circle
                  key={`other-kp-${kp.time}-${index}`}
                  cx={xScale(kp.time)}
                  cy={WAVEFORM_HEIGHT / 2}
                  r={2 + clamp(kp.intensity ?? 0.6, 0.1, 1) * 10}
                  fill={STEM_COLORS.other}
                  opacity={0.9}
                />
              ))}
          </svg>
        );
      }
      return (
        <svg width={timelineWidth} height={WAVEFORM_HEIGHT} style={{ display: 'block' }}>
          {regions.map((r, index) => {
            const x = xScale(r.start);
            const w = Math.max(2, xScale(r.end) - x);
            return (
              <rect
                key={`other-region-${index}`}
                x={x}
                y={4}
                width={w}
                height={WAVEFORM_HEIGHT - 8}
                fill={STEM_COLORS.other}
                opacity={0.2 + clamp(r.intensity ?? 0.3, 0, 1) * 0.3}
                rx={2}
              />
            );
          })}
          {curve.length > 1 &&
            curve.slice(1).map((p, index) => {
              const prev = curve[index];
              if (!prev) return null;
              const v0 = clamp(prev.density ?? prev.amp ?? 0.4, 0, 1);
              const v1 = clamp(p.density ?? p.amp ?? 0.4, 0, 1);
              const y0 = hasPitch && prev.pitch != null ? pitchToY(prev.pitch) : densityToY(v0);
              const y1 = hasPitch && p.pitch != null ? pitchToY(p.pitch) : densityToY(v1);
              return (
                <line
                  key={`other-curve-${index}`}
                  x1={xScale(prev.t)}
                  y1={y0}
                  x2={xScale(p.t)}
                  y2={y1}
                  stroke={STEM_COLORS.other}
                  strokeWidth={hasPitch ? 2 + Math.max(v0, v1) * 4 : 2}
                  strokeLinecap="round"
                  opacity={hasPitch ? 0.5 + Math.max(v0, v1) * 0.4 : 0.6}
                />
              );
            })}
          {keypoints.map((kp, index) => {
            const nearest = nearestCurvePoint(kp.t);
            const intensity = clamp(Number(kp.score ?? 0.6), 0, 1);
            const isActive = isActiveAtTime(kp.t);
            const baseY = hasPitch && nearest?.pitch != null
              ? pitchToY(nearest.pitch)
              : densityToY(nearest?.density ?? nearest?.amp ?? 0.6);
            return (
              <circle
                key={`other-kp-${index}`}
                cx={xScale(kp.t)}
                cy={baseY}
                r={3 + intensity * 4 + (isActive ? 2 : 0)}
                fill={STEM_COLORS.other}
                opacity={isActive ? 1 : 0.7}
                stroke={isActive ? '#fff' : 'none'}
                strokeWidth={isActive ? 1.5 : 0}
              />
            );
          })}
        </svg>
      );
    }

    const events = vocalEvents;
    const color = STEM_COLORS.vocal;
    const drumBandKeypoints: DrumKeypointByBandItem[] = [];
    const selectedEvents: Array<MusicKeypoint | DrumKeypointByBandItem> = events;
    const scores = selectedEvents.map((kp: any) => {
      const v = kp.score ?? kp.intensity ?? 0.5;
      return clamp(Number(v), 0, 1);
    });
    const minS = scores.length ? Math.min(...scores) : 0;
    const maxS = scores.length ? Math.max(...scores) : 1;
    const range = maxS - minS || 1;
    const scoreToRadius = (s: number) => 2 + ((s - minS) / range) * 12;
    return (
      <svg width={timelineWidth} height={WAVEFORM_HEIGHT} style={{ display: 'block' }}>
        {selectedEvents
          .filter((kp: any) => kp.time >= selectionStart && kp.time <= selectionEnd)
          .map((kp: any, index: number) => {
            const score = clamp(Number(kp.score ?? kp.intensity ?? 0.6), 0, 1);
            const r = scoreToRadius(score);
            const isActive = isActiveAtTime(kp.time);
            return (
              <circle
                key={`kp-${kp.time}-${index}`}
                cx={xScale(kp.time)}
                cy={WAVEFORM_HEIGHT / 2}
                r={isActive ? r + 2 : r}
                fill={color}
                opacity={isActive ? 1 : 0.9}
                stroke={isActive ? '#fff' : 'none'}
                strokeWidth={isActive ? 2 : 0}
              />
            );
          })}
      </svg>
    );
  };

  const stemItems = [
    {
      id: 'drums' as const,
      label: '드럼 키포인트',
      color: STEM_COLORS.drums,
      count:
        (drumKeypointsByBand.low?.length ?? drumEventsByBand.low.length) +
        (drumKeypointsByBand.mid?.length ?? drumEventsByBand.mid.length) +
        (drumKeypointsByBand.high?.length ?? drumEventsByBand.high.length),
    },
    {
      id: 'bass' as const,
      label: '베이스',
      color: STEM_COLORS.bass,
      count: resolvedBassNotes.length,
    },
    {
      id: 'vocal' as const,
      label: '보컬',
      color: STEM_COLORS.vocal,
      count: vocalCurve.length || vocalEvents.length,
    },
    {
      id: 'other' as const,
      label: '기타',
      color: STEM_COLORS.other,
      count: (otherDetail?.keypoints?.length ?? 0) || otherCurve.length || otherEvents.length,
    },
  ];

  return (
    <div className="rounded border border-neutral-800 bg-neutral-950/80 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-semibold text-white">오디오 상세 분석</h3>
          <p className="text-[11px] text-neutral-500 mt-1 uppercase tracking-[0.25em]">
            Selected {selectionBars} Bars · {formatTime(selectionStart)} - {formatTime(selectionEnd)}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <span>{formatTime(clampedTime)}</span>
          <span className="text-neutral-600">/</span>
          <span>{formatTime(selectionEnd)}</span>
          <div className="ml-3 flex items-center gap-1">
            <button
              type="button"
              onClick={handleZoomOut}
              className="h-7 w-7 rounded border border-neutral-700 text-neutral-400 hover:border-neutral-500"
            >
              −
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              className="h-7 w-7 rounded border border-neutral-700 text-neutral-400 hover:border-neutral-500"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {stemItems.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() =>
              setVisibleStems((prev) =>
                prev.includes(tab.id) ? prev.filter((s) => s !== tab.id) : [...prev, tab.id]
              )
            }
            className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.2em] ${
              visibleStems.includes(tab.id)
                ? 'border-neutral-200 text-neutral-100'
                : 'border-neutral-700 text-neutral-500 hover:border-neutral-500'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-400 uppercase tracking-[0.2em] mb-2">
        <span>드럼 대역</span>
        <div className="flex items-center gap-1">
          {(['low', 'mid', 'high'] as DrumBand[]).map((band) => (
            <button
              key={band}
              onClick={() =>
                setVisibleDrumBands((prev) =>
                  prev.includes(band) ? prev.filter((b) => b !== band) : [...prev, band]
                )
              }
              className={`px-2 py-1 rounded border text-[10px] ${
                visibleDrumBands.includes(band)
                  ? 'border-amber-400/70 bg-amber-500/20 text-amber-200'
                  : 'border-neutral-700 text-neutral-500 hover:border-neutral-500'
              }`}
            >
              {band.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {stemItems
          .filter((tab) => visibleStems.includes(tab.id))
          .map((tab, index) => (
            <div key={`stem-${tab.id}`} className="grid grid-cols-[160px_minmax(0,1fr)] gap-3 items-start">
              <div className="rounded border border-neutral-800 bg-neutral-950/80 p-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-neutral-400">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: tab.color }} />
                  {tab.label}
                </div>
                <div className="mt-2 text-[10px] uppercase tracking-[0.3em] text-neutral-600">
                  {tab.count}개
                </div>
              </div>
              <div className="space-y-2 min-w-0">
                {tab.id === 'drums' &&
                  (['low', 'mid', 'high'] as DrumBand[])
                    .filter((band) => visibleDrumBands.includes(band))
                    .map((band, bandIndex) => {
                      const refIndex = index * 10 + bandIndex;
                      return (
                        <div
                          key={`drum-${band}`}
                          onClick={handleSeekClick}
                          className="relative h-[64px] overflow-x-auto overflow-y-hidden rounded border border-neutral-800 bg-neutral-950 cursor-pointer"
                        >
                          {stemAudioUrls.drums ? (
                            <>
                              <canvas
                                ref={(el) => {
                                  waveformRefs.current[refIndex] = el;
                                  waveformStemKeys.current[refIndex] = 'drums';
                                }}
                                style={{ width: timelineWidth, height: 64, display: 'block' }}
                              />
                              <div
                                className="absolute left-0 top-0 pointer-events-none"
                                style={{ width: timelineWidth, height: 64 }}
                              >
                                {barMarkers.map((t) => {
                                  const left = ((t - selectionStart) / viewDuration) * timelineWidth;
                                  return (
                        <div
                          key={`bar-${tab.id}-${band}-${t}`}
                          className="absolute top-0 bottom-0 w-px bg-neutral-600/50"
                          style={{ left }}
                        />
                      );
                    })}
                  </div>
                  <div className="absolute left-0 top-0" style={{ width: timelineWidth, height: 64 }}>
                    {renderDrumBandOverlay(band, 64)}
                    <div
                      ref={(el) => (playheadRefs.current[refIndex] = el)}
                      className="absolute left-0 top-0 bottom-0 w-px bg-white/80 pointer-events-none will-change-transform"
                    />
                  </div>
                </>
              ) : (
                            <div className="flex h-full items-center justify-center text-xs text-neutral-500">
                              오디오가 필요합니다.
                            </div>
                          )}
                        </div>
                      );
                    })}
                {tab.id === 'bass' && (
                  <>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Waveform</div>
                    <div
                      onClick={handleSeekClick}
                      className="relative h-[90px] overflow-x-auto overflow-y-hidden rounded border border-neutral-800 bg-neutral-950 cursor-pointer"
                    >
                      {stemAudioUrls.bass ? (
                        <>
                          <canvas
                            ref={(el) => {
                              waveformRefs.current[index * 10] = el;
                              waveformStemKeys.current[index * 10] = 'bass';
                            }}
                            style={{ width: timelineWidth, height: 90, display: 'block' }}
                          />
                    <div
                      className="absolute left-0 top-0 pointer-events-none"
                      style={{ width: timelineWidth, height: 90 }}
                    >
                      {barMarkers.map((t) => {
                        const left = ((t - selectionStart) / viewDuration) * timelineWidth;
                        return (
                          <div
                            key={`bar-${tab.id}-${t}`}
                            className="absolute top-0 bottom-0 w-px bg-neutral-600/50"
                            style={{ left }}
                          />
                        );
                      })}
                    </div>
                    <div className="absolute left-0 top-0" style={{ width: timelineWidth, height: 90 }}>
                      <div
                        ref={(el) => (playheadRefs.current[index * 10] = el)}
                        className="absolute left-0 top-0 bottom-0 w-px bg-white/80 pointer-events-none will-change-transform"
                      />
                    </div>
                  </>
                ) : (
                        <div className="flex h-full items-center justify-center text-xs text-neutral-500">
                          오디오가 필요합니다.
                        </div>
                      )}
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Pitch / Groove</div>
                    <div
                      onClick={handleSeekClick}
                      className="relative h-[120px] overflow-x-auto overflow-y-hidden rounded border border-neutral-800 bg-neutral-950 cursor-pointer"
                    >
                  <div className="absolute left-0 top-0" style={{ width: timelineWidth, height: WAVEFORM_HEIGHT }}>
                    {renderOverlayFor('bass')}
                    <div
                      ref={(el) => (playheadRefs.current[index * 10 + 1] = el)}
                      className="absolute left-0 top-0 bottom-0 w-px bg-white/80 pointer-events-none will-change-transform"
                    />
                  </div>
                </div>
                  </>
                )}
                {tab.id === 'vocal' && (
                  <div
                    onClick={handleSeekClick}
                    className="relative h-[120px] overflow-x-auto overflow-y-hidden rounded border border-neutral-800 bg-neutral-950 cursor-pointer"
                  >
                  {stemAudioUrls.vocal ? (
                    <>
                      <canvas
                        ref={(el) => {
                          waveformRefs.current[index * 10] = el;
                          waveformStemKeys.current[index * 10] = 'vocal';
                        }}
                        style={{ width: timelineWidth, height: WAVEFORM_HEIGHT, display: 'block' }}
                      />
                      <div
                        className="absolute left-0 top-0 pointer-events-none"
                        style={{ width: timelineWidth, height: WAVEFORM_HEIGHT }}
                      >
                        {barMarkers.map((t) => {
                          const left = ((t - selectionStart) / viewDuration) * timelineWidth;
                          return (
                            <div
                              key={`bar-${tab.id}-${t}`}
                              className="absolute top-0 bottom-0 w-px bg-neutral-600/50"
                              style={{ left }}
                            />
                          );
                        })}
                      </div>
                      <div
                        className="absolute left-0 top-0"
                        style={{ width: timelineWidth, height: WAVEFORM_HEIGHT }}
                      >
                        {renderOverlayFor('vocal')}
                        <div
                          ref={(el) => (playheadRefs.current[index * 10] = el)}
                          className="absolute left-0 top-0 bottom-0 w-px bg-white/80 pointer-events-none will-change-transform"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-neutral-500">
                      오디오가 필요합니다.
                    </div>
                  )}
                </div>
              )}
            {tab.id === 'other' && (
              <div
                onClick={handleSeekClick}
                className="relative h-[120px] overflow-x-auto overflow-y-hidden rounded border border-neutral-800 bg-neutral-950 cursor-pointer"
              >
                {stemAudioUrls.other ? (
                  <>
                    <canvas
                      ref={(el) => {
                        waveformRefs.current[index * 10] = el;
                        waveformStemKeys.current[index * 10] = 'other';
                      }}
                      style={{ width: timelineWidth, height: WAVEFORM_HEIGHT, display: 'block' }}
                    />
                    <div
                      className="absolute left-0 top-0 pointer-events-none"
                      style={{ width: timelineWidth, height: WAVEFORM_HEIGHT }}
                    >
                      {barMarkers.map((t) => {
                        const left = ((t - selectionStart) / viewDuration) * timelineWidth;
                        return (
                          <div
                            key={`bar-${tab.id}-${t}`}
                            className="absolute top-0 bottom-0 w-px bg-neutral-600/50"
                            style={{ left }}
                          />
                        );
                      })}
                    </div>
                    <div
                      className="absolute left-0 top-0"
                      style={{ width: timelineWidth, height: WAVEFORM_HEIGHT }}
                    >
                      {renderOverlayFor('other')}
                      <div
                        ref={(el) => (playheadRefs.current[index * 10] = el)}
                        className="absolute left-0 top-0 bottom-0 w-px bg-white/80 pointer-events-none will-change-transform"
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-neutral-500">
                    오디오가 필요합니다.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
          ))}
      </div>
    </div>
  );
}
