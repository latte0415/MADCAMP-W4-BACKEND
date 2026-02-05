import { useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
// import { ProjectLibrary } from './components/ProjectLibrary';
import { ProjectDetail } from './components/ProjectDetail';
import { UploadDialog } from './components/UploadDialog';
import { Progress } from './components/ui/progress';
import { LandingPage } from './components/landing/LandingPage';
import type { NewProjectData } from './components/landing/DJStudio';
import { Project, ProjectMode } from './types';
import {
  getLibrary,
  mapLibraryItem,
  getProjectDetail,
  fetchJson,
  parseMusicKeypoints,
  parseMotionKeypoints,
  parseBassNotes,
  parseMusicDetail,
  parseStreamsSectionsData,
  mapProjectDetail,
  presignUpload,
  uploadFileToS3,
  commitMedia,
  createAnalysis,
  getAnalysisStatus,
  updateAnalysisAudio,
  updateAnalysisVideo,
  updateAnalysisExtractAudio,
  rerunMusicAnalysis,
  rerunMotionAnalysis,
  deleteAnalysisRequest,
  streamAnalysisStatus,
  deleteProject,
  getMe,
  logout,
} from './api';

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<null | { label: string; progress: number }>(
    null
  );
  const [userName, setUserName] = useState<string>('게스트');
  const [loadingProject, setLoadingProject] = useState(false);
  const navigate = useNavigate();
  const lastLoadedRef = useRef<string | null>(null);
  const activeStreamsRef = useRef<Set<number>>(new Set());
  const deletedTempIdsRef = useRef<Set<string>>(new Set());
  const detailCacheRef = useRef<Map<string, { project: Project; fetchedAt: number }>>(new Map());
  const jsonCacheRef = useRef<Map<string, { data: any; fetchedAt: number }>>(new Map());
  const inflightRef = useRef<Map<string, Promise<Project | null>>>(new Map());
  const cacheOrderRef = useRef<string[]>([]);

  const DETAIL_TTL = 30_000;
  const JSON_TTL = 5 * 60_000;
  const MAX_DETAIL_CACHE = 10;

  const isTempId = (id: string) => id.startsWith('temp-');

  const touchLRU = (id: string) => {
    const order = cacheOrderRef.current;
    const idx = order.indexOf(id);
    if (idx >= 0) order.splice(idx, 1);
    order.unshift(id);
  };

  const evictIfNeeded = () => {
    const order = cacheOrderRef.current;
    while (order.length > MAX_DETAIL_CACHE) {
      const evictId = order.pop();
      if (!evictId) break;
      detailCacheRef.current.delete(evictId);
    }
  };

  const isStale = (entry: { fetchedAt: number } | undefined, ttl: number) => {
    if (!entry) return true;
    return Date.now() - entry.fetchedAt > ttl;
  };

  const getCachedProject = (id: string) => {
    const entry = detailCacheRef.current.get(id);
    if (entry) touchLRU(id);
    return entry;
  };

  const setCachedProject = (id: string, project: Project) => {
    detailCacheRef.current.set(id, { project, fetchedAt: Date.now() });
    touchLRU(id);
    evictIfNeeded();
  };

  const patchProjectCache = (projectId: string, fields: Partial<Project>) => {
    const entry = detailCacheRef.current.get(projectId);
    if (!entry) return;
    const updated = { ...entry.project, ...fields };
    detailCacheRef.current.set(projectId, { project: updated, fetchedAt: entry.fetchedAt });
    touchLRU(projectId);
  };

  const fetchJsonCached = async (url?: string | null) => {
    if (!url) return null;
    const cached = jsonCacheRef.current.get(url);
    if (cached && !isStale(cached, JSON_TTL)) return cached.data;
    const data = await fetchJson(url);
    if (data !== null) {
      jsonCacheRef.current.set(url, { data, fetchedAt: Date.now() });
    }
    return data;
  };

  const mergeLibraryWithCache = (items: ReturnType<typeof mapLibraryItem>[]) => {
    return items.map((summary) => {
      const cached = detailCacheRef.current.get(summary.id)?.project;
      if (!cached) return summary;
      return {
        ...summary,
        videoUrl: cached.videoUrl ?? summary.videoUrl,
        audioUrl: cached.audioUrl ?? summary.audioUrl,
        thumbnailUrl: cached.thumbnailUrl ?? summary.thumbnailUrl,
        musicKeypoints: cached.musicKeypoints?.length ? cached.musicKeypoints : summary.musicKeypoints,
        motionKeypoints: cached.motionKeypoints?.length ? cached.motionKeypoints : summary.motionKeypoints,
        bassNotes: cached.bassNotes?.length ? cached.bassNotes : summary.bassNotes,
        musicDetail: cached.musicDetail ?? summary.musicDetail,
        streamsSectionsData: cached.streamsSectionsData ?? summary.streamsSectionsData,
        stemUrls: cached.stemUrls ?? summary.stemUrls,
        duration: summary.duration || cached.duration,
        errorMessage: summary.errorMessage ?? cached.errorMessage,
        statusMessage: summary.statusMessage ?? cached.statusMessage,
        statusLog: summary.statusLog ?? cached.statusLog,
        uploadVideoProgress: summary.uploadVideoProgress ?? cached.uploadVideoProgress,
        uploadAudioProgress: summary.uploadAudioProgress ?? cached.uploadAudioProgress,
        motionProgress: summary.motionProgress ?? cached.motionProgress,
        audioProgress: summary.audioProgress ?? cached.audioProgress,
      };
    });
  };

  const refreshLibrary = async () => {
    const items = await getLibrary();
    const mapped = items.map(mapLibraryItem);
    setProjects(mergeLibraryWithCache(mapped));
  };

  const openProjectById = async (
    id: string,
    onProgress?: (value: number, label?: string) => void
  ) => {
    const cached = getCachedProject(id);
    if (cached) {
      setSelectedProject(cached.project);
      setLoadingProject(false);
    } else {
      setLoadingProject(true);
    }

    const needsRevalidate = () => {
      if (!cached) return true;
      if (cached.project.status !== 'done') return true;
      if (isStale(cached, DETAIL_TTL)) return true;
      const hasMusic =
        cached.project.musicKeypoints.length > 0 ||
        (cached.project.bassNotes?.length ?? 0) > 0 ||
        Boolean(cached.project.musicDetail) ||
        Boolean(cached.project.streamsSectionsData);
      const hasMotion = cached.project.motionKeypoints.length > 0;
      const needsMusic = Boolean(cached.project.audioUrl);
      const needsMotion = Boolean(cached.project.videoUrl);
      if (needsMusic && !hasMusic) return true;
      if (needsMotion && !hasMotion) return true;
      return false;
    };

    if (!needsRevalidate()) {
      // Show gradual progress even for cached projects
      onProgress?.(30, '캐시에서 불러오는 중');
      await new Promise(r => setTimeout(r, 150));
      onProgress?.(70, '데이터 준비 중');
      await new Promise(r => setTimeout(r, 150));
      onProgress?.(100, '준비 완료');
      return true;
    }

    const inflight = inflightRef.current.get(id);
    if (inflight) {
      onProgress?.(40, '이미 로딩 중');
      const result = await inflight;
      onProgress?.(100, '준비 완료');
      return Boolean(result);
    }

    const fetchPromise = (async () => {
      try {
        onProgress?.(10, '프로젝트 불러오는 중');
        const detail = await getProjectDetail(id);
        onProgress?.(35, '음악 결과 불러오는 중');
        const musicJson = await fetchJsonCached(detail.results?.music_json);
        onProgress?.(65, '모션 결과 불러오는 중');
        const motionJson = await fetchJsonCached(detail.results?.motion_json);
        onProgress?.(85, '매직 결과 불러오는 중');
        const magicJson = await fetchJsonCached(detail.results?.magic_json);
        const musicKeypoints = parseMusicKeypoints(musicJson);
        const motionKeypoints = [
          ...parseMotionKeypoints(motionJson),
          ...parseMotionKeypoints(magicJson),
        ];
        const bassNotes = parseBassNotes(musicJson);
        const musicDetail = parseMusicDetail(musicJson);
        const streamsSectionsData = parseStreamsSectionsData(musicJson);
        const mapped = mapProjectDetail(
          detail,
          musicKeypoints,
          motionKeypoints,
          bassNotes,
          musicDetail,
          streamsSectionsData
        );
        setSelectedProject((prev) => (prev?.id === String(id) || !prev ? mapped : prev));
        setProjects((prev) =>
          prev.map((p) => (p.id === String(id) ? { ...p, ...mapped } : p))
        );
        setCachedProject(String(id), mapped);
        if (
          detail.status === 'queued' ||
          detail.status === 'running' ||
          detail.status === 'queued_music'
        ) {
          startStatusStreaming(Number(detail.id));
        }
        onProgress?.(100, '준비 완료');
        return mapped;
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 404) {
          setSelectedProject(null);
          navigate('/', { replace: true });
          return null;
        }
        console.error(err);
        return null;
      } finally {
        setLoadingProject(false);
        inflightRef.current.delete(id);
      }
    })();

    inflightRef.current.set(id, fetchPromise);
    const result = await fetchPromise;
    return Boolean(result);
  };

  const handleSelectProject = async (project: Project) => {
    // Only set selectedProject if it's not already loaded with full data
    // (openProjectById already sets selectedProject with full data)
    if (selectedProject?.id !== project.id) {
      setSelectedProject(project);
    }
    navigate(`/project/${project.id}`);
  };

  const handleEnterProject = async (
    project: Project,
    onProgress?: (value: number, label?: string) => void
  ): Promise<boolean> => {
    if (isTempId(project.id)) {
      return true; // Let DJStudio handle navigation
    }
    lastLoadedRef.current = project.id;
    const ok = await openProjectById(project.id, onProgress);
    return ok; // Return success, don't navigate - let DJStudio do it after showing progress
  };

  const handleBack = () => {
    setSelectedProject(null);
    navigate('/');
  };

  const handleNewProject = () => {
    setUploadDialogOpen(true);
  };

  const applyStatusToState = (
    requestId: number,
    payload: { status: string; message?: string; progress?: number; error_message?: string; log?: string }
  ) => {
    const normalized = payload.status === 'queued_music' ? 'queued' : payload.status;
    const status = normalized as any;
    const progress = typeof payload.progress === 'number' ? payload.progress : undefined;
    const statusMessage = payload.message ?? undefined;
    const errorMessage = payload.error_message ?? undefined;
    const statusLog = payload.log ?? undefined;
    const lowered = (statusMessage ?? '').toLowerCase();
    const isMotion =
      lowered.includes('motion') || lowered.includes('magic') || lowered.includes('video');
    const isAudio = lowered.includes('music') || lowered.includes('audio');
    const isGenericAnalysis = lowered.includes('analysis') || lowered.includes('score');

    const progressUpdate: Partial<Project> = {
      status,
      progress,
      statusMessage,
      errorMessage,
      statusLog,
    };

    if (progress !== undefined) {
      if (isMotion) progressUpdate.motionProgress = progress;
      if (isAudio) progressUpdate.audioProgress = progress;
      if (isGenericAnalysis && !isMotion && !isAudio) {
        progressUpdate.motionProgress = progress;
        progressUpdate.audioProgress = progress;
      }
    }
    if (status === 'done') {
      progressUpdate.motionProgress = 1;
      progressUpdate.audioProgress = 1;
    }

    setProjects(prev =>
      prev.map(p =>
        p.id === String(requestId)
          ? { ...p, ...progressUpdate }
          : p
      )
    );
    setSelectedProject(prev =>
      prev?.id === String(requestId)
        ? { ...prev, ...progressUpdate }
        : prev
    );
    patchProjectCache(String(requestId), progressUpdate);
  };

  const handleAnalysisComplete = async (requestId: number) => {
    const detail = await getProjectDetail(requestId);
    const musicJson = await fetchJsonCached(detail.results?.music_json);
    const motionJson = await fetchJsonCached(detail.results?.motion_json);
    const magicJson = await fetchJsonCached(detail.results?.magic_json);
    const musicKeypoints = parseMusicKeypoints(musicJson);
    const motionKeypoints = [
      ...parseMotionKeypoints(motionJson),
      ...parseMotionKeypoints(magicJson),
    ];
    const bassNotes = parseBassNotes(musicJson);
    const musicDetail = parseMusicDetail(musicJson);
    const streamsSectionsData = parseStreamsSectionsData(musicJson);
    const mapped = mapProjectDetail(
      detail,
      musicKeypoints,
      motionKeypoints,
      bassNotes,
      musicDetail,
      streamsSectionsData
    );
    setSelectedProject(prev => {
      if (prev?.id !== String(requestId)) return prev;
      if (prev.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.videoUrl);
      if (prev.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.audioUrl);
      return mapped;
    });
    setProjects(prev => prev.map(p => (p.id === String(requestId) ? { ...p, ...mapped } : p)));
    setCachedProject(String(requestId), mapped);
  };

  const handleCreateProject = (data: NewProjectData) => {
    handleUpload({
      title: data.title,
      mode: data.mode,
      video: data.videoFile,
      audio: data.audioFile,
      extractAudio: data.extractAudio,
    });
  };

  const startStatusPolling = (requestId: number) => {
    const poll = setInterval(async () => {
      const st = await getAnalysisStatus(requestId);
      applyStatusToState(requestId, st);
      if (st.status === 'done' || st.status === 'failed') {
        clearInterval(poll);
        if (st.status === 'done') {
          await handleAnalysisComplete(requestId);
        }
        await refreshLibrary();
      }
    }, 2000);
  };

  const startStatusStreaming = (requestId: number) => {
    if (activeStreamsRef.current.has(requestId)) return;
    activeStreamsRef.current.add(requestId);
    let completed = false;
    const source = streamAnalysisStatus(
      requestId,
      async (st) => {
        applyStatusToState(requestId, st);
        if (st.status === 'done' || st.status === 'failed') {
          completed = true;
          source.close();
          activeStreamsRef.current.delete(requestId);
          if (st.status === 'done') {
            await handleAnalysisComplete(requestId);
          }
          await refreshLibrary();
        }
      },
      () => {
        if (!completed) {
          activeStreamsRef.current.delete(requestId);
          startStatusPolling(requestId);
        }
      }
    );
  };

  const cleanupProjectUrls = (project: Project | null) => {
    if (!project) return;
    if (project.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(project.videoUrl);
    if (project.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(project.audioUrl);
  };

  const handleDeleteProject = async (project?: Project) => {
    const targetProject = project ?? selectedProject;
    if (!targetProject) return;
    const projectId = targetProject.id;
    const confirmDelete = window.confirm(
      '이 프로젝트를 삭제할까요?\n삭제하면 복구할 수 없습니다.'
    );
    if (!confirmDelete) return;

    cleanupProjectUrls(targetProject);
    setProjects(prev => prev.filter(p => p.id !== projectId));
    if (selectedProject?.id === projectId) {
      setSelectedProject(null);
      navigate('/');
    }

    if (isTempId(projectId)) {
      deletedTempIdsRef.current.add(projectId);
      return;
    }

    try {
      await deleteProject(Number(projectId));
      await refreshLibrary();
    } catch (err) {
      console.error(err);
      alert('프로젝트 삭제에 실패했습니다. 다시 시도해 주세요.');
      await refreshLibrary();
    }
  };

  const updateProjectFields = (projectId: string, fields: Partial<Project>) => {
    setProjects(prev => prev.map(p => (p.id === projectId ? { ...p, ...fields } : p)));
    setSelectedProject(prev => (prev?.id === projectId ? { ...prev, ...fields } : prev));
    patchProjectCache(projectId, fields);
  };

  const handleReplaceAudio = (file: File) => {
    (async () => {
      if (!selectedProject) return;
      const requestId = Number(selectedProject.id);
      if (!Number.isFinite(requestId)) {
        alert('프로젝트 ID가 올바르지 않습니다.');
        return;
      }

      const localAudioUrl = URL.createObjectURL(file);
      setSelectedProject(prev => {
        if (!prev) return prev;
        if (prev.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.audioUrl);
        return prev;
      });
      updateProjectFields(selectedProject.id, {
        audioUrl: localAudioUrl,
        status: 'queued',
        progress: 0,
        statusMessage: undefined,
        errorMessage: undefined,
        statusLog: undefined,
        musicKeypoints: [],
        bassNotes: [],
        uploadAudioProgress: 0,
        audioProgress: 0,
      });

      try {
        const audioPresign = await presignUpload(file, 'audio');
        await uploadFileToS3(audioPresign.upload_url, file, (value) => {
          updateProjectFields(selectedProject.id, { uploadAudioProgress: value });
        });
        const audioMedia = await commitMedia({
          s3_key: audioPresign.s3_key,
          type: 'audio',
          content_type: file.type,
          duration_sec: null,
        });

        await updateAnalysisAudio(requestId, audioMedia.id);
        await rerunMusicAnalysis(requestId);
        startStatusStreaming(requestId);
      } catch (err) {
        console.error(err);
        updateProjectFields(String(requestId), {
          status: 'failed',
          errorMessage: '오디오 교체 또는 재분석 요청에 실패했습니다.',
        });
        alert('오디오 교체 또는 재분석 요청에 실패했습니다. 다시 시도해 주세요.');
      }
    })();
  };

  const handleReplaceVideo = (file: File) => {
    (async () => {
      if (!selectedProject) return;
      const requestId = Number(selectedProject.id);
      if (!Number.isFinite(requestId)) {
        alert('프로젝트 ID가 올바르지 않습니다.');
        return;
      }

      const localVideoUrl = URL.createObjectURL(file);
      setSelectedProject(prev => {
        if (!prev) return prev;
        if (prev.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.videoUrl);
        return prev;
      });
      updateProjectFields(selectedProject.id, {
        videoUrl: localVideoUrl,
        status: 'queued',
        progress: 0,
        statusMessage: undefined,
        errorMessage: undefined,
        statusLog: undefined,
        motionKeypoints: [],
        uploadVideoProgress: 0,
        motionProgress: 0,
      });

      try {
        const videoPresign = await presignUpload(file, 'video');
        await uploadFileToS3(videoPresign.upload_url, file, (value) => {
          updateProjectFields(selectedProject.id, { uploadVideoProgress: value });
        });
        const videoMedia = await commitMedia({
          s3_key: videoPresign.s3_key,
          type: 'video',
          content_type: file.type,
          duration_sec: null,
        });

        await updateAnalysisVideo(requestId, videoMedia.id);
        await rerunMotionAnalysis(requestId);
        startStatusStreaming(requestId);
      } catch (err) {
        console.error(err);
        updateProjectFields(String(requestId), {
          status: 'failed',
          errorMessage: '비디오 교체 또는 재분석 요청에 실패했습니다.',
        });
        alert('비디오 교체 또는 재분석 요청에 실패했습니다. 다시 시도해 주세요.');
      }
    })();
  };

  const handleExtractAudioFromVideo = () => {
    (async () => {
      if (!selectedProject) return;
      const requestId = Number(selectedProject.id);
      if (!Number.isFinite(requestId)) {
        alert('프로젝트 ID가 올바르지 않습니다.');
        return;
      }
      if (!selectedProject.videoUrl) {
        alert('영상이 없습니다. 먼저 영상을 업로드해 주세요.');
        return;
      }

      updateProjectFields(selectedProject.id, {
        status: 'queued',
        progress: 0,
        statusMessage: undefined,
        errorMessage: undefined,
        statusLog: undefined,
        musicKeypoints: [],
        bassNotes: [],
        audioProgress: 0,
      });

      try {
        await updateAnalysisExtractAudio(requestId, true);
        await rerunMusicAnalysis(requestId);
        startStatusStreaming(requestId);
      } catch (err) {
        console.error(err);
        updateProjectFields(String(requestId), {
          status: 'failed',
          errorMessage: '영상에서 오디오 추출 요청에 실패했습니다.',
        });
        alert('영상에서 오디오 추출 요청에 실패했습니다. 다시 시도해 주세요.');
      }
    })();
  };

  const handleUpload = (data: {
    title: string;
    mode: ProjectMode;
    video?: File;
    audio?: File;
    extractAudio?: boolean;
  }) => {
    (async () => {
      if (!data.video && !data.audio) {
        alert('영상 또는 오디오 파일이 필요합니다.');
        return;
      }

      setUploadDialogOpen(false);
      setUploadStatus({ label: 'Preparing upload...', progress: 0 });

      const localVideoUrl = data.video ? URL.createObjectURL(data.video) : undefined;
      const localAudioUrl = data.audio ? URL.createObjectURL(data.audio) : undefined;
      const tempId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? `temp-${crypto.randomUUID()}`
          : `temp-${Date.now()}`;

      const tempProject: Project = {
        id: tempId,
        title: data.title,
        mode: data.mode,
        videoUrl: localVideoUrl,
        audioUrl: localAudioUrl,
        duration: 0,
        createdAt: new Date(),
        musicKeypoints: [],
        motionKeypoints: [],
        status: 'queued',
        progress: 0,
        statusMessage: undefined,
        errorMessage: undefined,
        statusLog: undefined,
        uploadVideoProgress: data.video ? 0 : undefined,
        uploadAudioProgress: data.audio ? 0 : undefined,
        motionProgress: data.video ? 0 : undefined,
        audioProgress: data.audio || data.extractAudio ? 0 : undefined,
      };
      setProjects(prev => [tempProject, ...prev]);
      setSelectedProject(tempProject);
      setCachedProject(tempId, tempProject);
      navigate(`/project/${tempId}`);

      try {
        let videoMedia: { id: number } | null = null;
        if (data.video) {
          const videoPresign = await presignUpload(data.video, 'video');
          setUploadStatus({ label: 'Uploading video...', progress: 0 });
          await uploadFileToS3(videoPresign.upload_url, data.video, (value) => {
            updateProjectFields(tempId, { uploadVideoProgress: value });
            setUploadStatus({
              label: 'Uploading video...',
              progress: Math.round(value * 100),
            });
          });
          videoMedia = await commitMedia({
            s3_key: videoPresign.s3_key,
            type: 'video',
            content_type: data.video.type,
            duration_sec: null,
          });
        }

        let audioId: number | null = null;
        if (data.audio) {
          const audioPresign = await presignUpload(data.audio, 'audio');
          setUploadStatus({ label: 'Uploading audio...', progress: 0 });
          await uploadFileToS3(audioPresign.upload_url, data.audio, (value) => {
            updateProjectFields(tempId, { uploadAudioProgress: value });
            setUploadStatus({
              label: 'Uploading audio...',
              progress: Math.round(value * 100),
            });
          });
          const audioMedia = await commitMedia({
            s3_key: audioPresign.s3_key,
            type: 'audio',
            content_type: data.audio.type,
            duration_sec: null,
          });
          audioId = audioMedia.id;
        }

        if (deletedTempIdsRef.current.has(tempId)) {
          deletedTempIdsRef.current.delete(tempId);
          await refreshLibrary();
          return;
        }
        setUploadStatus({ label: 'Starting analysis...', progress: 100 });
        const req = await createAnalysis({
          video_id: videoMedia?.id ?? null,
          audio_id: audioId,
          mode: data.mode,
          title: data.title,
          params_json: data.extractAudio ? { extract_audio: true } : null,
        });

        if (deletedTempIdsRef.current.has(tempId)) {
          deletedTempIdsRef.current.delete(tempId);
          try {
            await deleteAnalysisRequest(Number(req.id));
          } catch (err) {
            console.error(err);
          } finally {
            await refreshLibrary();
          }
          return;
        }

        navigate(`/project/${req.id}`, { replace: true });
        const finalizedProject: Partial<Project> = {
          id: String(req.id),
          status: 'queued',
          progress: 0,
          statusMessage: undefined,
          errorMessage: undefined,
          statusLog: undefined,
          uploadVideoProgress: data.video ? 1 : undefined,
          uploadAudioProgress: data.audio ? 1 : undefined,
        };
        setProjects(prev =>
          prev.map(p => (p.id === tempId ? { ...p, ...finalizedProject } : p))
        );
        setSelectedProject(prev =>
          prev?.id === tempId ? { ...prev, ...finalizedProject } : prev
        );
        const tempEntry = detailCacheRef.current.get(tempId);
        detailCacheRef.current.delete(tempId);
        cacheOrderRef.current = cacheOrderRef.current.filter(id => id !== tempId);
        if (tempEntry) {
          const updated = { ...tempEntry.project, ...finalizedProject } as Project;
          setCachedProject(String(req.id), updated);
        }

        startStatusStreaming(req.id);
        setTimeout(() => setUploadStatus(null), 800);
      } catch (err) {
        console.error(err);
        setSelectedProject(prev =>
          prev?.id === tempId
            ? { ...prev, status: 'failed', errorMessage: '업로드 또는 분석 요청에 실패했습니다.' }
            : prev
        );
        alert('업로드 또는 분석 요청에 실패했습니다. 다시 시도해 주세요.');
        setUploadStatus(null);
      }
    })();
  };

  useEffect(() => {
    getMe()
      .then(me => setUserName(me.name || me.email || 'User'))
      .catch(() => setUserName('게스트'));
    refreshLibrary().catch(() => {});
  }, []);

  const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
  const loginUrl = apiBase ? `${apiBase}/auth/google/login` : '/auth/google/login';

  const authProps = {
    userName,
    onLogin: () => (window.location.href = loginUrl),
    onLogout: async () => {
      await logout();
      setUserName('게스트');
    },
  };

  const ProjectRoute = () => {
    const params = useParams();
    const id = params.id;
    useEffect(() => {
      if (!id) return;
      const existing = projects.find(p => p.id === id);
      if (existing && selectedProject?.id !== id) {
        setSelectedProject(existing);
      }
      if (isTempId(id)) return;
      if (lastLoadedRef.current === id) return;
      lastLoadedRef.current = id;
      openProjectById(id);
    }, [id, projects]);

    if (!id) return null;
    const current =
      (selectedProject?.id === id ? selectedProject : null) ??
      projects.find(p => p.id === id) ??
      {
        id,
        title: `프로젝트 #${id}`,
        mode: 'dance',
        duration: 0,
        createdAt: new Date(),
        musicKeypoints: [],
        motionKeypoints: [],
        status: 'queued',
      };

    return (
      <ProjectDetail
        project={current}
        loading={loadingProject}
        onBack={handleBack}
        onOpenUploadDialog={() => setUploadDialogOpen(true)}
        onReplaceAudio={handleReplaceAudio}
        onReplaceVideo={handleReplaceVideo}
        onExtractAudioFromVideo={handleExtractAudioFromVideo}
        onDelete={handleDeleteProject}
        {...authProps}
      />
    );
  };

  return (
    <div className="size-full bg-zinc-950 text-white">
      {uploadStatus && (
        <div className="fixed left-1/2 top-6 z-50 w-[320px] -translate-x-1/2 rounded-xl border border-white/10 bg-neutral-900/90 px-4 py-3 shadow-xl backdrop-blur">
          <div className="text-xs uppercase tracking-[0.3em] text-neutral-500 mb-2">
            Upload
          </div>
          <div className="text-sm text-white mb-2">{uploadStatus.label}</div>
          <Progress value={uploadStatus.progress} className="h-2 bg-white/10" />
        </div>
      )}
      <Routes>
        <Route
          path="/"
          element={
            <LandingPage
              projects={projects}
              onSelectProject={handleSelectProject}
              onEnterProject={handleEnterProject}
              onCreateProject={handleCreateProject}
              onDeleteProject={handleDeleteProject}
              {...authProps}
            />
          }
        />
        {/* Legacy library is disabled for now */}
        <Route path="/library" element={<Navigate to="/" replace />} />
        <Route path="/project/:id" element={<ProjectRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <UploadDialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        onUpload={handleUpload}
      />
    </div>
  );
}
