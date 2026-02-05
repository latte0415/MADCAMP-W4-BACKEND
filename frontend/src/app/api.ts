import {
  BassNote,
  MotionKeypoint,
  MusicKeypoint,
  Project,
  ProjectMode,
  ProjectStatus,
  MusicAnalysisDetail,
  DrumKeypointByBandItem,
  TextureBlockItem,
  BassAnalysisDetail,
  VocalAnalysisDetail,
  OtherAnalysisDetail,
} from './types';

type LibraryItem = {
  id: number;
  title: string | null;
  mode: ProjectMode;
  status: string;
  created_at: string;
  finished_at?: string | null;
  video_duration_sec?: number | null;
};

type ProjectDetailResponse = {
  id: number;
  title: string | null;
  mode: ProjectMode;
  status: string;
  error_message?: string | null;
  created_at: string;
  finished_at?: string | null;
  video?: { url?: string | null; duration_sec?: number | null };
  audio?: { url?: string | null; duration_sec?: number | null };
  results?: {
    motion_json?: string | null;
    music_json?: string | null;
    magic_json?: string | null;
    stems?: {
      drums?: string | null;
      bass?: string | null;
      vocal?: string | null;
      other?: string | null;
      drum_low?: string | null;
      drum_mid?: string | null;
      drum_high?: string | null;
    } | null;
  };
};

type PresignResponse = { upload_url: string; s3_key: string };

const DEFAULT_API_BASE = 'https://madcamp-w4-backend-production.up.railway.app:8080';
const API_BASE = (import.meta.env.VITE_API_URL || DEFAULT_API_BASE).replace(/\/+$/, '');

function apiUrl(path: string) {
  if (!path.startsWith('/')) return path;
  if (!API_BASE) return path;
  return `${API_BASE}${path}`;
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(apiUrl(url), { credentials: 'include', ...options });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text || res.statusText) as Error & { status?: number; body?: string };
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res.json() as Promise<T>;
}

export async function getMe() {
  return apiFetch<{ id: number; email?: string; name?: string }>('/auth/me');
}

export async function logout() {
  await apiFetch('/auth/logout', { method: 'POST' });
}

export async function getLibrary(): Promise<LibraryItem[]> {
  return apiFetch('/api/library');
}

export async function getProjectDetail(id: string | number): Promise<ProjectDetailResponse> {
  return apiFetch(`/api/project/${id}`);
}

export async function presignUpload(file: File, type: 'audio' | 'video'): Promise<PresignResponse> {
  return apiFetch('/api/media/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type,
      type,
    }),
  });
}

export async function commitMedia(payload: {
  s3_key: string;
  type: 'audio' | 'video';
  content_type?: string;
  duration_sec?: number | null;
}) {
  return apiFetch('/api/media/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateAnalysisAudio(requestId: number, audioId: number) {
  return apiFetch(`/api/analysis/${requestId}/audio`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_id: audioId }),
  });
}

export async function deleteAnalysisRequest(requestId: number) {
  return apiFetch(`/api/analysis/${requestId}`, {
    method: 'DELETE',
  });
}

export async function rerunMusicAnalysis(requestId: number) {
  return apiFetch(`/api/analysis/${requestId}/rerun-music`, {
    method: 'POST',
  });
}

export async function createAnalysis(payload: {
  video_id?: number | null;
  audio_id?: number | null;
  mode: ProjectMode;
  title?: string | null;
  params_json?: Record<string, any> | null;
}) {
  return apiFetch<{ id: number }>('/api/analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      video_id: payload.video_id ?? null,
      audio_id: payload.audio_id ?? null,
      mode: payload.mode,
      params_json: payload.params_json ?? null,
      title: payload.title ?? null,
      notes: null,
    }),
  });
}

export async function getAnalysisStatus(id: number) {
  return apiFetch<{
    status: string;
    message?: string;
    progress?: number;
    error_message?: string;
    log?: string;
  }>(
    `/api/analysis/${id}/status`
  );
}

export function streamAnalysisStatus(
  requestId: number,
  onUpdate: (data: { status: string; message?: string; progress?: number; error_message?: string; log?: string }) => void,
  onError: (err?: any) => void
) {
  const source = new EventSource(apiUrl(`/api/analysis/${requestId}/events`), { withCredentials: true });

  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data || '{}');
      onUpdate(data);
    } catch (err) {
      onError(err);
      source.close();
    }
  };

  source.onerror = (err) => {
    onError(err);
    source.close();
  };

  return source;
}

export async function uploadFileToS3(
  url: string,
  file: File,
  onProgress?: (value: number) => void
) {
  return uploadFileToS3WithProgress(url, file, onProgress);
}

export function uploadFileToS3WithProgress(
  url: string,
  file: File,
  onProgress?: (value: number) => void
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', file.type);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const progress = event.total > 0 ? event.loaded / event.total : 0;
      onProgress?.(Math.max(0, Math.min(1, progress)));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else {
        reject(new Error('S3 upload failed'));
      }
    };
    xhr.onerror = () => reject(new Error('S3 upload failed'));
    xhr.send(file);
  });
}

export async function updateAnalysisVideo(requestId: number, videoId: number) {
  return apiFetch(`/api/analysis/${requestId}/video`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_id: videoId }),
  });
}

export async function updateAnalysisExtractAudio(requestId: number, enabled: boolean) {
  return apiFetch(`/api/analysis/${requestId}/extract-audio`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

export async function rerunMotionAnalysis(requestId: number) {
  return apiFetch(`/api/analysis/${requestId}/rerun-motion`, {
    method: 'POST',
  });
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function getIntensity(obj: Record<string, any>) {
  const v = obj?.strength ?? obj?.score ?? obj?.value ?? obj?.intensity ?? 0.7;
  return clamp01(typeof v === 'number' ? v : 0.7);
}

export async function fetchJson(url?: string | null) {
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

export function parseMusicKeypoints(data: any): MusicKeypoint[] {
  if (!data) return [];
  const out: MusicKeypoint[] = [];

  if (data.keypoints_by_band) {
    (['low', 'mid', 'high'] as const).forEach((band) => {
      const items = data.keypoints_by_band?.[band] ?? [];
      for (const item of items) {
        const time = Number(item.t ?? item.time ?? 0);
        out.push({
          time,
          frequency: band,
          intensity: getIntensity(item),
        });
      }
    });
    return out;
  }

  if (Array.isArray(data.keypoints)) {
    for (const item of data.keypoints) {
      const frequency = item.frequency ?? item.band ?? 'mid';
      const time = Number(item.t ?? item.time ?? 0);
      if (!['low', 'mid', 'high'].includes(frequency)) continue;
      out.push({
        time,
        frequency,
        intensity: getIntensity(item),
      });
    }
  }

  return out;
}

export function parseBassNotes(data: any): BassNote[] {
  if (!data?.bass?.notes || !Array.isArray(data.bass.notes)) return [];
  const out: BassNote[] = [];
  for (const item of data.bass.notes) {
    const start = Number(item.start ?? item.time ?? 0);
    const end = Number(item.end ?? start);
    const duration = Number(item.duration ?? Math.max(0, end - start));
    out.push({
      time: start,
      duration,
      ...item,
    });
  }
  return out;
}

const toNumber = (value: any, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function parseMusicDetail(data: any): MusicAnalysisDetail | undefined {
  if (!data) return undefined;
  const keypointsByBand: MusicAnalysisDetail['keypointsByBand'] = {};
  const rawKeypoints = data.keypoints_by_band ?? null;
  if (rawKeypoints && typeof rawKeypoints === 'object') {
    (['low', 'mid', 'high'] as const).forEach((band) => {
      const items = Array.isArray(rawKeypoints[band]) ? rawKeypoints[band] : [];
      if (items.length === 0) return;
      keypointsByBand[band] = items.map((item: any) => ({
        time: toNumber(item.time ?? item.t ?? 0),
        score: Number.isFinite(Number(item.score)) ? Number(item.score) : undefined,
        intensity: Number.isFinite(Number(item.intensity)) ? Number(item.intensity) : undefined,
      })) as DrumKeypointByBandItem[];
    });
  }

  const textureBlocksByBand: MusicAnalysisDetail['textureBlocksByBand'] = {};
  const rawTextures = data.texture_blocks_by_band ?? null;
  if (rawTextures && typeof rawTextures === 'object') {
    (['low', 'mid', 'high'] as const).forEach((band) => {
      const items = Array.isArray(rawTextures[band]) ? rawTextures[band] : [];
      if (items.length === 0) return;
      textureBlocksByBand[band] = items.map((item: any) => ({
        start: toNumber(item.start ?? 0),
        end: toNumber(item.end ?? 0),
        intensity: Number.isFinite(Number(item.intensity)) ? Number(item.intensity) : undefined,
        density: Number.isFinite(Number(item.density)) ? Number(item.density) : undefined,
      })) as TextureBlockItem[];
    });
  }

  const bass: BassAnalysisDetail | undefined = data.bass
    ? {
        notes: parseBassNotes(data),
        groove_curve: Array.isArray(data.bass?.groove_curve) ? data.bass.groove_curve : undefined,
        bass_curve_v3: Array.isArray(data.bass?.bass_curve_v3) ? data.bass.bass_curve_v3 : undefined,
      }
    : undefined;

  const vocal: VocalAnalysisDetail | undefined = data.vocal
    ? {
        vocal_curve: Array.isArray(data.vocal?.vocal_curve) ? data.vocal.vocal_curve : undefined,
        vocal_phrases: Array.isArray(data.vocal?.vocal_phrases) ? data.vocal.vocal_phrases : undefined,
        vocal_turns: Array.isArray(data.vocal?.vocal_turns) ? data.vocal.vocal_turns : undefined,
        vocal_onsets: Array.isArray(data.vocal?.vocal_onsets) ? data.vocal.vocal_onsets : undefined,
      }
    : undefined;

  const other: OtherAnalysisDetail | undefined = data.other
    ? {
        other_curve: Array.isArray(data.other?.other_curve) ? data.other.other_curve : undefined,
        other_regions: Array.isArray(data.other?.other_regions) ? data.other.other_regions : undefined,
        other_keypoints: Array.isArray(data.other?.other_keypoints) ? data.other.other_keypoints : undefined,
      }
    : undefined;

  const hasKeypoints = Object.keys(keypointsByBand).length > 0;
  const hasTextures = Object.keys(textureBlocksByBand).length > 0;
  const hasBass = bass?.notes?.length || bass?.groove_curve?.length || bass?.bass_curve_v3?.length;
  const hasVocal = vocal?.vocal_curve?.length;
  const hasOther = other?.other_curve?.length || other?.other_regions?.length || other?.other_keypoints?.length;

  if (!hasKeypoints && !hasTextures && !hasBass && !hasVocal && !hasOther) return undefined;

  return {
    keypointsByBand: hasKeypoints ? keypointsByBand : undefined,
    textureBlocksByBand: hasTextures ? textureBlocksByBand : undefined,
    bass: hasBass ? bass : undefined,
    vocal: hasVocal ? vocal : undefined,
    other: hasOther ? other : undefined,
  };
}

export function parseMotionKeypoints(data: any): MotionKeypoint[] {
  if (!data) return [];
  const out: MotionKeypoint[] = [];

  const events = Array.isArray(data.events) ? data.events : [];
  for (const evt of events) {
    const type = evt.type ?? evt.kind;
    if (type === 'hit') {
      out.push({
        time: Number(evt.t ?? evt.time ?? 0),
        type: 'hit',
        intensity: getIntensity(evt),
      });
    } else if (type === 'hold') {
      const start = Number(evt.t_start ?? evt.start ?? evt.t ?? 0);
      const end = Number(evt.t_end ?? evt.end ?? start);
      out.push({
        time: start,
        type: 'hold',
        duration: Math.max(0, end - start),
        intensity: getIntensity(evt),
      });
    } else if (type === 'appear' || type === 'vanish') {
      out.push({
        time: Number(evt.t ?? evt.time ?? 0),
        type,
        intensity: getIntensity(evt),
      });
    }
  }

  return out;
}

export function mapLibraryItem(item: LibraryItem): Project {
  const status = (item.status as ProjectStatus) || 'draft';
  const isDone = status === 'done';
  return {
    id: String(item.id),
    title: item.title ?? `프로젝트 #${item.id}`,
    mode: item.mode,
    duration: Number(item.video_duration_sec ?? 0),
    createdAt: new Date(item.created_at),
    completedAt: item.finished_at ? new Date(item.finished_at) : undefined,
    musicKeypoints: [],
    motionKeypoints: [],
    bassNotes: [],
    status,
    motionProgress: isDone ? 1 : undefined,
    audioProgress: isDone ? 1 : undefined,
  };
}

export function mapProjectDetail(
  detail: ProjectDetailResponse,
  musicKeypoints: MusicKeypoint[],
  motionKeypoints: MotionKeypoint[],
  bassNotes: BassNote[] = [],
  musicDetail?: MusicAnalysisDetail
): Project {
  const status = (detail.status as ProjectStatus) || 'draft';
  const maxMusic = musicKeypoints.reduce((m, k) => Math.max(m, k.time), 0);
  const maxMotion = motionKeypoints.reduce((m, k) => {
    if (k.type === 'hold' && k.duration) return Math.max(m, k.time + k.duration);
    return Math.max(m, k.time);
  }, 0);
  const maxBass = bassNotes.reduce((m, n) => Math.max(m, n.time + (n.duration ?? 0)), 0);
  const duration = Math.max(
    Number(detail.video?.duration_sec ?? 0),
    Number(detail.audio?.duration_sec ?? 0),
    maxMusic,
    maxMotion,
    maxBass,
    1
  );
  const isDone = status === 'done';
  const stems = detail.results?.stems ?? null;
  const stemUrls =
    stems && (stems.drums || stems.bass || stems.vocal || stems.other || stems.drum_low || stems.drum_mid || stems.drum_high)
      ? {
          drums: stems.drums ?? undefined,
          bass: stems.bass ?? undefined,
          vocal: stems.vocal ?? undefined,
          other: stems.other ?? undefined,
          drumBands: {
            low: stems.drum_low ?? undefined,
            mid: stems.drum_mid ?? undefined,
            high: stems.drum_high ?? undefined,
          },
        }
      : undefined;
  return {
    id: String(detail.id),
    title: detail.title ?? `프로젝트 #${detail.id}`,
    mode: detail.mode,
    duration,
    createdAt: new Date(detail.created_at),
    completedAt: detail.finished_at ? new Date(detail.finished_at) : undefined,
    videoUrl: detail.video?.url ?? undefined,
    audioUrl: detail.audio?.url ?? undefined,
    musicKeypoints,
    motionKeypoints,
    bassNotes,
    musicDetail,
    stemUrls,
    status,
    errorMessage: detail.error_message ?? undefined,
    motionProgress: isDone && detail.video?.url ? 1 : undefined,
    audioProgress: isDone && (detail.audio?.url || musicKeypoints.length > 0) ? 1 : undefined,
    uploadVideoProgress: detail.video?.url ? 1 : undefined,
    uploadAudioProgress: detail.audio?.url ? 1 : undefined,
  };
}
