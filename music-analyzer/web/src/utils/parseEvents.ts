import type { EventPoint } from "../types/event";
import type { EnergyEvent, EnergyJsonData } from "../types/energyEvent";
import type { ClarityEvent, ClarityJsonData } from "../types/clarityEvent";
import type { TemporalEvent, TemporalJsonData } from "../types/temporalEvent";
import type { SpectralEvent, SpectralJsonData } from "../types/spectralEvent";
import type { ContextEvent, ContextJsonData } from "../types/contextEvent";
import type { StreamsSectionsData, BassData } from "../types/streamsSections";
import type { DrumBandEnergyJsonData } from "../types/drumBandEnergy";

const DEFAULT_POINT_COLOR = "#5a9fd4";

/** 02_clarity 형식(metadata + attack_time_ms, clarity_score) → Clarity 데이터 반환, 아니면 null */
export function parseClarityJson(data: unknown): ClarityJsonData | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const metaRaw = obj.metadata ?? obj.meta;
  if (metaRaw == null || typeof metaRaw !== "object" || !Array.isArray(obj.events)) return null;
  const rawEvents = obj.events as Record<string, unknown>[];
  const hasClarity = rawEvents.some(
    (e) => e && typeof e === "object" && ("attack_time_ms" in e || "clarity_score" in e)
  );
  if (!hasClarity) return null;

  const m = metaRaw as Record<string, unknown>;
  const events: ClarityEvent[] = rawEvents
    .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
    .map((item) => ({
      t: Number(item.time ?? item.t ?? 0),
      strength: Math.min(1, Math.max(0, Number(item.strength ?? 0))),
      attack_time_ms: Number(item.attack_time_ms ?? 0),
      clarity_score: Number(item.clarity_score ?? 0),
    }));

  return {
    events,
    meta: {
      source: String(m.source ?? ""),
      sr: Number(m.sr ?? 22050),
      hop_length: Number(m.hop_length ?? 256),
      bpm: Number(m.bpm ?? 0),
      total_events: Number(m.total_events ?? events.length),
    },
  };
}

/** 03_temporal 형식(metadata + grid_align_score, temporal_score) → Temporal 데이터 반환, 아니면 null */
export function parseTemporalJson(data: unknown): TemporalJsonData | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const metaRaw = obj.metadata ?? obj.meta;
  if (metaRaw == null || typeof metaRaw !== "object" || !Array.isArray(obj.events)) return null;
  const rawEvents = obj.events as Record<string, unknown>[];
  const hasTemporal = rawEvents.some(
    (e) => e && typeof e === "object" && ("grid_align_score" in e || "temporal_score" in e)
  );
  if (!hasTemporal) return null;

  const m = metaRaw as Record<string, unknown>;
  const events: TemporalEvent[] = rawEvents
    .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
    .map((item) => {
      const ev: TemporalEvent = {
        index: Number(item.index ?? 0),
        time: Number(item.time ?? item.t ?? 0),
        frame: Number(item.frame ?? 0),
        strength: Number(item.strength ?? 0),
        grid_align_score: Number(item.grid_align_score ?? 0),
        repetition_score: Number(item.repetition_score ?? 0),
        temporal_score: Number(item.temporal_score ?? 0),
      };
      if (item.ioi_prev != null) ev.ioi_prev = Number(item.ioi_prev);
      if (item.ioi_next != null) ev.ioi_next = Number(item.ioi_next);
      return ev;
    });

  return {
    events,
    meta: {
      source: String(m.source ?? ""),
      sr: Number(m.sr ?? 22050),
      duration_sec: Number(m.duration_sec ?? 0),
      hop_length: Number(m.hop_length ?? 256),
      bpm: Number(m.bpm ?? 0),
      bpm_dynamic_used: Boolean(m.bpm_dynamic_used ?? false),
      total_events: Number(m.total_events ?? events.length),
    },
  };
}

/** 04_spectral 형식(metadata + focus_score, spectral_centroid_hz) → Spectral 데이터 반환, 아니면 null */
export function parseSpectralJson(data: unknown): SpectralJsonData | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const metaRaw = obj.metadata ?? obj.meta;
  if (metaRaw == null || typeof metaRaw !== "object" || !Array.isArray(obj.events)) return null;
  const rawEvents = obj.events as Record<string, unknown>[];
  const hasSpectral = rawEvents.some(
    (e) => e && typeof e === "object" && ("focus_score" in e || "spectral_centroid_hz" in e)
  );
  if (!hasSpectral) return null;

  const m = metaRaw as Record<string, unknown>;
  const events: SpectralEvent[] = rawEvents
    .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
    .map((item) => {
      const centroid = item.spectral_centroid_hz;
      const bandwidth = item.spectral_bandwidth_hz;
      const flatness = item.spectral_flatness;
      return {
        index: Number(item.index ?? 0),
        time: Number(item.time ?? item.t ?? 0),
        frame: Number(item.frame ?? 0),
        strength: Number(item.strength ?? 0),
        spectral_centroid_hz: centroid != null && typeof centroid === "number" ? centroid : null,
        spectral_bandwidth_hz: bandwidth != null && typeof bandwidth === "number" ? bandwidth : null,
        spectral_flatness: flatness != null && typeof flatness === "number" ? flatness : null,
        focus_score: Number(item.focus_score ?? 0),
      };
    });

  return {
    events,
    meta: {
      source: String(m.source ?? ""),
      sr: Number(m.sr ?? 22050),
      duration_sec: Number(m.duration_sec ?? 0),
      hop_length: Number(m.hop_length ?? 256),
      n_fft: Number(m.n_fft ?? 2048),
      bpm: Number(m.bpm ?? 0),
      total_events: Number(m.total_events ?? events.length),
    },
  };
}

/** 05_context 형식(metadata + snr_db, dependency_score) → Context 데이터 반환, 아니면 null */
export function parseContextJson(data: unknown): ContextJsonData | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const metaRaw = obj.metadata ?? obj.meta;
  if (metaRaw == null || typeof metaRaw !== "object" || !Array.isArray(obj.events)) return null;
  const rawEvents = obj.events as Record<string, unknown>[];
  const hasContext = rawEvents.some(
    (e) => e && typeof e === "object" && ("snr_db" in e || "dependency_score" in e)
  );
  if (!hasContext) return null;

  const m = metaRaw as Record<string, unknown>;
  const events: ContextEvent[] = rawEvents
    .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
    .map((item) => ({
      index: Number(item.index ?? 0),
      time: Number(item.time ?? item.t ?? 0),
      frame: Number(item.frame ?? 0),
      strength: Number(item.strength ?? 0),
      snr_db: Number(item.snr_db ?? 0),
      masking_low: Number(item.masking_low ?? 0),
      masking_mid: Number(item.masking_mid ?? 0),
      masking_high: Number(item.masking_high ?? 0),
      dependency_score: Number(item.dependency_score ?? 0),
    }));

  return {
    events,
    meta: {
      source: String(m.source ?? ""),
      sr: Number(m.sr ?? 22050),
      duration_sec: Number(m.duration_sec ?? 0),
      hop_length: Number(m.hop_length ?? 256),
      n_fft: Number(m.n_fft ?? 2048),
      bpm: Number(m.bpm ?? 0),
      event_win_sec: Number(m.event_win_sec ?? 0.05),
      bg_win_sec: Number(m.bg_win_sec ?? 0.1),
      total_events: Number(m.total_events ?? events.length),
    },
  };
}

/** 04 형식(energy_rms_min 있음) → 전체 에너지 데이터 반환, 아니면 null */
export function parseEnergyJson(data: unknown): EnergyJsonData | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (obj.energy_rms_min == null || !Array.isArray(obj.events)) return null;

  const raw = (obj.events as Record<string, unknown>[])
    .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
    .map((item) => ({
      t: Number(item.t ?? 0),
      strength: Math.min(1, Math.max(0, Number(item.strength ?? 0.7))),
      texture: Math.min(1, Math.max(0, Number(item.texture ?? 0.5))),
      color: typeof item.color === "string" && item.color ? item.color : DEFAULT_POINT_COLOR,
      rms: Number(item.rms ?? 0),
      e_norm: Number(item.e_norm ?? item.strength ?? 0.7),
      band_low: Number(item.band_low ?? 0),
      band_mid: Number(item.band_mid ?? 0),
      band_high: Number(item.band_high ?? 0),
    }));

  const sorted = [...raw.map((e) => e.strength)].sort((a, b) => a - b);
  const t33 = sorted[Math.floor(sorted.length * 0.33)] ?? 0;
  const t66 = sorted[Math.floor(sorted.length * 0.66)] ?? 1;

  const events: EnergyEvent[] = raw.map((e) => ({
    ...e,
    layer: e.strength >= t66 ? "강함" : e.strength >= t33 ? "중간" : "약함",
  }));

  return {
    events,
    meta: {
      source: String(obj.source ?? ""),
      sr: Number(obj.sr ?? 22050),
      duration_sec: Number(obj.duration_sec ?? 0),
      energy_rms_min: Number(obj.energy_rms_min ?? 0),
      energy_rms_max: Number(obj.energy_rms_max ?? 1),
    },
  };
}

/**
 * json_spec.md 기반 — 노트북별 JSON 형식 → EventPoint[] 변환
 *
 * 수용 형식 (우선순위):
 * 1. onset_beats.json (01_explore): onset_times_sec, beat_times_sec, drum_onset_times_sec
 * 2. onset_events.json (03_visualize_point): events[] (t, strength, texture, color, layer)
 * 3. events[] 래퍼
 * 4. 배열 직접 [{ t, strength?, color?, layer? }]
 */
export function parseEventsFromJson(data: unknown): EventPoint[] {
  if (!data || typeof data !== "object") return [];

  const obj = data as Record<string, unknown>;

  // 1. 01_explore → onset_beats.json (강함/중간/약함에 매핑: drum_onset→강함, beat→중간, onset→약함)
  if ("onset_times_sec" in obj || "beat_times_sec" in obj || "drum_onset_times_sec" in obj) {
    const events: EventPoint[] = [];
    if (Array.isArray(obj.onset_times_sec)) {
      (obj.onset_times_sec as number[]).forEach((t) => {
        events.push({ t: Number(t), strength: 0.7, color: DEFAULT_POINT_COLOR, layer: "약함" });
      });
    }
    if (Array.isArray(obj.beat_times_sec)) {
      (obj.beat_times_sec as number[]).forEach((t) => {
        events.push({ t: Number(t), strength: 0.6, color: DEFAULT_POINT_COLOR, layer: "중간" });
      });
    }
    if (Array.isArray(obj.drum_onset_times_sec)) {
      (obj.drum_onset_times_sec as number[]).forEach((t) => {
        events.push({ t: Number(t), strength: 0.8, color: DEFAULT_POINT_COLOR, layer: "강함" });
      });
    }
    return events;
  }

  // 2, 3. 03_visualize_point / 04_layered_onset / 09_layered → onset_events.json 또는 events[] 래퍼
  if (Array.isArray(obj.events)) {
    const events = (obj.events as Record<string, unknown>[])
      .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
      .map((item) => normalizeEvent(item));

    // 09 레이어 형식: 이미 layer가 P0/P1/P2이면 유지
    const hasPrecisionLayers = events.some(
      (e) => e.layer === "P0" || e.layer === "P1" || e.layer === "P2"
    );
    if (!hasPrecisionLayers && events.length > 0) {
      // 03/04 형식: strength 기준 강함/중간/약함 tertile 할당
      const strengths = events.map((e) => e.strength);
      const sorted = [...strengths].sort((a, b) => a - b);
      const t33 = sorted[Math.floor(sorted.length * 0.33)] ?? 0;
      const t66 = sorted[Math.floor(sorted.length * 0.66)] ?? 1;
      events.forEach((e, i) => {
        const v = strengths[i];
        if (v >= t66) e.layer = "강함";
        else if (v >= t33) e.layer = "중간";
        else e.layer = "약함";
      });
    }
    return events;
  }

  // 4. 배열 직접 — strength tertile로 강함/중간/약함 할당
  if (Array.isArray(data)) {
    const events = (data as Record<string, unknown>[])
      .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
      .map((item) => normalizeEvent(item));
    if (events.length > 0) {
      const strengths = events.map((e) => e.strength);
      const sorted = [...strengths].sort((a, b) => a - b);
      const t33 = sorted[Math.floor(sorted.length * 0.33)] ?? 0;
      const t66 = sorted[Math.floor(sorted.length * 0.66)] ?? 1;
      events.forEach((e, i) => {
        const v = strengths[i];
        if (v >= t66) e.layer = "강함";
        else if (v >= t33) e.layer = "중간";
        else e.layer = "약함";
      });
    }
    return events;
  }

  return [];
}

/** drum_band_energy.json 형식 (bands: { low, mid, high } 각각 [ { t, energy } ]) */
export function parseDrumBandEnergyJson(data: unknown): DrumBandEnergyJsonData | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const bandsRaw = obj.bands;
  if (!bandsRaw || typeof bandsRaw !== "object") return null;
  const b = bandsRaw as Record<string, unknown>;
  const lowArr = Array.isArray(b.low) ? b.low : [];
  const midArr = Array.isArray(b.mid) ? b.mid : [];
  const highArr = Array.isArray(b.high) ? b.high : [];
  const toEvents = (arr: unknown[]) =>
    arr
      .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
      .map((item) => ({
        t: Number(item.t ?? 0),
        energy: Number(item.energy ?? 0),
      }));

  return {
    bands: {
      low: toEvents(lowArr),
      mid: toEvents(midArr),
      high: toEvents(highArr),
    },
    meta: {
      source: String(obj.source ?? ""),
      duration_sec: Number(obj.duration_sec ?? 0),
      sr: Number(obj.sr ?? 22050),
    },
  };
}

/** 07_streams_sections → streams_sections.json 형식 (events 있으면 P0/P1/P2 roles 파싱). streams/sections/keypoints 없으면 빈 배열로 처리. */
export function parseStreamsSectionsJson(data: unknown): StreamsSectionsData | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const streams = Array.isArray(obj.streams) ? obj.streams : [];
  const sections = Array.isArray(obj.sections) ? obj.sections : [];
  const keypoints = Array.isArray(obj.keypoints) ? obj.keypoints : [];
  const events = Array.isArray(obj.events)
    ? (obj.events as unknown[])
        .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
        .map((item) => normalizeEvent(item))
    : undefined;
  const keypoints_by_band =
    obj.keypoints_by_band && typeof obj.keypoints_by_band === "object"
      ? (obj.keypoints_by_band as StreamsSectionsData["keypoints_by_band"])
      : undefined;
  const texture_blocks_by_band =
    obj.texture_blocks_by_band && typeof obj.texture_blocks_by_band === "object"
      ? (obj.texture_blocks_by_band as StreamsSectionsData["texture_blocks_by_band"])
      : undefined;

  const bass = parseBassData(obj.bass);

  return {
    source: String(obj.source ?? ""),
    sr: Number(obj.sr ?? 22050),
    duration_sec: Number(obj.duration_sec ?? 0),
    streams: streams as StreamsSectionsData["streams"],
    sections: sections as StreamsSectionsData["sections"],
    keypoints: keypoints as StreamsSectionsData["keypoints"],
    events,
    keypoints_by_band,
    texture_blocks_by_band,
    bass,
  };
}

function parseBassData(raw: unknown): BassData | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const notes = obj.notes;
  if (!Array.isArray(notes)) return undefined;
  const render =
    obj.render && typeof obj.render === "object"
      ? (obj.render as BassData["render"])
      : undefined;
  let bass_curve_v3: BassData["bass_curve_v3"];
  if (Array.isArray(obj.bass_curve_v3)) {
    bass_curve_v3 = (obj.bass_curve_v3 as unknown[]).filter(
      (item): item is { t: number; pitch: number; amp: number } =>
        item != null &&
        typeof item === "object" &&
        "t" in item &&
        "pitch" in item &&
        "amp" in item &&
        typeof (item as { t: unknown }).t === "number" &&
        typeof (item as { pitch: unknown }).pitch === "number" &&
        typeof (item as { amp: unknown }).amp === "number"
    );
  } else {
    bass_curve_v3 = undefined;
  }
  const bass_curve_v3_meta =
    obj.bass_curve_v3_meta && typeof obj.bass_curve_v3_meta === "object"
      ? (obj.bass_curve_v3_meta as BassData["bass_curve_v3_meta"])
      : undefined;
  return { notes: notes as BassData["notes"], render, bass_curve_v3, bass_curve_v3_meta };
}

const LAYER_COLORS: Record<string, string> = {
  P0: "#2ecc71",
  P1: "#f39c12",
  P2: "#3498db",
};

function parseRoles(item: Record<string, unknown>): EventPoint["roles"] | undefined {
  const r = item.roles;
  if (!r || typeof r !== "object" || Array.isArray(r)) return undefined;
  const obj = r as Record<string, unknown>;
  const P0 = Array.isArray(obj.P0) ? (obj.P0 as string[]) : [];
  const P1 = Array.isArray(obj.P1) ? (obj.P1 as string[]) : [];
  const P2 = Array.isArray(obj.P2) ? (obj.P2 as string[]) : [];
  return { P0, P1, P2 };
}

function primaryFromRoles(roles: EventPoint["roles"]): string {
  if (!roles) return "P0";
  if (roles.P2.length > 0) return "P2";
  if (roles.P1.length > 0) return "P1";
  return "P0";
}

function normalizeEvent(item: Record<string, unknown>): EventPoint {
  const t = Number(item.t ?? item.time ?? 0);
  const strength = Math.min(1, Math.max(0, Number(item.strength ?? 0.7)));
  const textureRaw = Number(item.texture);
  const texture = Number.isFinite(textureRaw)
    ? Math.min(1, Math.max(0, textureRaw))
    : undefined;
  const roles = parseRoles(item);
  const layer =
    typeof item.layer === "string"
      ? item.layer
      : roles
        ? primaryFromRoles(roles)
        : "default";
  const color =
    typeof item.color === "string" && item.color
      ? item.color
      : LAYER_COLORS[layer] ?? DEFAULT_POINT_COLOR;
  return { t, strength, texture, color, layer, roles };
}
