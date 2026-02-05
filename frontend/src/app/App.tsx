import { useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
// import { ProjectLibrary } from './components/ProjectLibrary';
import { ProjectDetail } from './components/ProjectDetail';
import { UploadDialog } from './components/UploadDialog';
import { LandingPage } from './components/landing/LandingPage';
import { Project, ProjectMode } from './types';
import {
  getLibrary,
  mapLibraryItem,
  getProjectDetail,
  fetchJson,
  parseMusicKeypoints,
  parseMotionKeypoints,
  parseBassNotes,
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
  getMe,
  logout,
} from './api';

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [userName, setUserName] = useState<string>('게스트');
  const [loadingProject, setLoadingProject] = useState(false);
  const navigate = useNavigate();
  const lastLoadedRef = useRef<string | null>(null);
  const activeStreamsRef = useRef<Set<number>>(new Set());
  const deletedTempIdsRef = useRef<Set<string>>(new Set());

  const isTempId = (id: string) => id.startsWith('temp-');

  const refreshLibrary = async () => {
    const items = await getLibrary();
    setProjects(items.map(mapLibraryItem));
  };

  const openProjectById = async (id: string) => {
    setLoadingProject(true);
    try {
      const detail = await getProjectDetail(id);
      const musicJson = await fetchJson(detail.results?.music_json);
      const motionJson = await fetchJson(detail.results?.motion_json);
      const magicJson = await fetchJson(detail.results?.magic_json);
      const musicKeypoints = parseMusicKeypoints(musicJson);
      const motionKeypoints = [
        ...parseMotionKeypoints(motionJson),
        ...parseMotionKeypoints(magicJson),
      ];
      const bassNotes = parseBassNotes(musicJson);
      setSelectedProject(mapProjectDetail(detail, musicKeypoints, motionKeypoints, bassNotes));
      if (detail.status === 'queued' || detail.status === 'running' || detail.status === 'queued_music') {
        startStatusStreaming(Number(detail.id));
      }
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404) {
        setSelectedProject(null);
        navigate('/', { replace: true });
        return;
      }
      console.error(err);
    } finally {
      setLoadingProject(false);
    }
  };

  const handleSelectProject = async (project: Project) => {
    setSelectedProject(project);
    navigate(`/project/${project.id}`);
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
  };

  const handleAnalysisComplete = async (requestId: number) => {
    const detail = await getProjectDetail(requestId);
    const musicJson = await fetchJson(detail.results?.music_json);
    const motionJson = await fetchJson(detail.results?.motion_json);
    const magicJson = await fetchJson(detail.results?.magic_json);
    const musicKeypoints = parseMusicKeypoints(musicJson);
    const motionKeypoints = [
      ...parseMotionKeypoints(motionJson),
      ...parseMotionKeypoints(magicJson),
    ];
    const bassNotes = parseBassNotes(musicJson);
    const mapped = mapProjectDetail(detail, musicKeypoints, motionKeypoints, bassNotes);
    setSelectedProject(prev => {
      if (prev?.id !== String(requestId)) return prev;
      if (prev.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.videoUrl);
      if (prev.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.audioUrl);
      return mapped;
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

  const handleDeleteProject = async () => {
    if (!selectedProject) return;
    const projectId = selectedProject.id;
    const confirmDelete = window.confirm(
      '이 프로젝트를 삭제할까요?\n삭제하면 복구할 수 없습니다.'
    );
    if (!confirmDelete) return;

    cleanupProjectUrls(selectedProject);
    setProjects(prev => prev.filter(p => p.id !== projectId));
    setSelectedProject(null);
    navigate('/');

    if (isTempId(projectId)) {
      deletedTempIdsRef.current.add(projectId);
      return;
    }

    try {
      await deleteAnalysisRequest(Number(projectId));
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
      navigate(`/project/${tempId}`);

      try {
        let videoMedia: { id: number } | null = null;
        if (data.video) {
          const videoPresign = await presignUpload(data.video, 'video');
          await uploadFileToS3(videoPresign.upload_url, data.video, (value) => {
            updateProjectFields(tempId, { uploadVideoProgress: value });
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
          await uploadFileToS3(audioPresign.upload_url, data.audio, (value) => {
            updateProjectFields(tempId, { uploadAudioProgress: value });
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
        setProjects(prev =>
          prev.map(p =>
            p.id === tempId
              ? {
                  ...p,
                  id: String(req.id),
                  status: 'queued',
                  progress: 0,
                  statusMessage: undefined,
                  errorMessage: undefined,
                  statusLog: undefined,
                  uploadVideoProgress: data.video ? 1 : undefined,
                  uploadAudioProgress: data.audio ? 1 : undefined,
                }
              : p
          )
        );
        setSelectedProject(prev =>
          prev?.id === tempId
            ? {
                ...prev,
                id: String(req.id),
                status: 'queued',
                progress: 0,
                statusMessage: undefined,
                errorMessage: undefined,
                statusLog: undefined,
                uploadVideoProgress: data.video ? 1 : undefined,
                uploadAudioProgress: data.audio ? 1 : undefined,
              }
            : prev
        );

        startStatusStreaming(req.id);
      } catch (err) {
        console.error(err);
        setSelectedProject(prev =>
          prev?.id === tempId
            ? { ...prev, status: 'failed', errorMessage: '업로드 또는 분석 요청에 실패했습니다.' }
            : prev
        );
        alert('업로드 또는 분석 요청에 실패했습니다. 다시 시도해 주세요.');
      }
    })();
  };

  useEffect(() => {
    getMe()
      .then(me => setUserName(me.name || me.email || 'User'))
      .catch(() => setUserName('게스트'));
    refreshLibrary().catch(() => {});
  }, []);

  const authProps = {
    userName,
    onLogin: () => (window.location.href = '/auth/google/login'),
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
      <Routes>
        <Route
          path="/"
          element={
            <LandingPage
              projects={projects}
              onSelectProject={handleSelectProject}
              onNewProject={handleNewProject}
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
