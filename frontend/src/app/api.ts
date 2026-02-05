import { BassNote, MotionKeypoint, MusicKeypoint, Project, ProjectMode, ProjectStatus } from './types';

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
  };
};

type PresignResponse = { upload_url: string; s3_key: string };

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...options });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
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

export async function rerunMusicAnalysis(requestId: number) {
  return apiFetch(`/api/analysis/${requestId}/rerun-music`, {
    method: 'POST',
  });
}

export async function deleteProject(requestId: number) {
  return apiFetch<{ ok: boolean; deleted_keys: number }>(`/api/project/${requestId}`, {
    method: 'DELETE',
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
  return apiFetch<{ status: string; message?: string; progress?: number; error_message?: string }>(
    `/api/analysis/${id}/status`
  );
}

export function uploadFileToS3(
  url: string,
  file: File,
  onProgress?: (percent: number) => void
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (evt) => {
      if (!evt.lengthComputable) return;
      const percent = Math.round((evt.loaded / evt.total) * 100);
      onProgress?.(percent);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error('S3 upload failed'));
      }
    };
    xhr.onerror = () => reject(new Error('S3 upload failed'));
    xhr.send(file);
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
  };
}

export function mapProjectDetail(
  detail: ProjectDetailResponse,
  musicKeypoints: MusicKeypoint[],
  motionKeypoints: MotionKeypoint[],
  bassNotes: BassNote[] = []
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
    maxMusic,
    maxMotion,
    maxBass,
    1
  );
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
    status,
    errorMessage: detail.error_message ?? undefined,
  };
}
