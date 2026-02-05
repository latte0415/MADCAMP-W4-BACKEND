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
  mapProjectDetail,
  presignUpload,
  uploadFileToS3,
  commitMedia,
  createAnalysis,
  getAnalysisStatus,
  updateAnalysisAudio,
  rerunMusicAnalysis,
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
    } catch (err) {
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

  const handleCreateProject = (data: NewProjectData) => {
    handleUpload({
      title: data.title,
      mode: data.mode,
      video: data.videoFile,
      audio: data.audioFile,
      extractAudio: data.extractAudio,
    });
  };

  const handleDeleteProject = async (project: Project) => {
    try {
      await deleteProject(Number(project.id));
      setProjects(prev => prev.filter(p => p.id !== project.id));
      if (selectedProject?.id === project.id) {
        setSelectedProject(null);
        navigate('/');
      }
    } catch (err) {
      console.error('Failed to delete project:', err);
      alert('프로젝트 삭제에 실패했습니다.');
    }
  };

  const startStatusPolling = (requestId: number) => {
    const poll = setInterval(async () => {
      const st = await getAnalysisStatus(requestId);
        if (st.status === 'done' || st.status === 'failed') {
          clearInterval(poll);
          if (st.status === 'done') {
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
          } else {
            setSelectedProject(prev =>
              prev?.id === String(requestId)
                ? { ...prev, status: 'failed', errorMessage: st.error_message ?? '분석에 실패했습니다.' }
                : prev
            );
            setProjects(prev =>
              prev.map(p =>
                p.id === String(requestId)
                  ? { ...p, status: 'failed', errorMessage: st.error_message ?? '분석에 실패했습니다.' }
                  : p
              )
            );
          }
          await refreshLibrary();
        } else {
          setProjects(prev =>
            prev.map(p =>
              p.id === String(requestId)
                ? { ...p, status: st.status as any, errorMessage: undefined }
                : p
            )
          );
          setSelectedProject(prev =>
            prev?.id === String(requestId)
              ? { ...prev, status: st.status as any, errorMessage: undefined }
              : prev
          );
        }
      }, 2000);
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
        return {
          ...prev,
          audioUrl: localAudioUrl,
          status: 'queued',
          musicKeypoints: [],
          bassNotes: [],
        };
      });
      setProjects(prev =>
        prev.map(p =>
          p.id === selectedProject.id
            ? { ...p, audioUrl: localAudioUrl, status: 'queued' }
            : p
        )
      );

      try {
        const audioPresign = await presignUpload(file, 'audio');
        await uploadFileToS3(audioPresign.upload_url, file);
        const audioMedia = await commitMedia({
          s3_key: audioPresign.s3_key,
          type: 'audio',
          content_type: file.type,
          duration_sec: null,
        });

        await updateAnalysisAudio(requestId, audioMedia.id);
        await rerunMusicAnalysis(requestId);
        startStatusPolling(requestId);
      } catch (err) {
        console.error(err);
      setSelectedProject(prev =>
        prev?.id === String(requestId)
          ? { ...prev, status: 'failed', errorMessage: '오디오 교체 또는 재분석 요청에 실패했습니다.' }
          : prev
      );
      alert('오디오 교체 또는 재분석 요청에 실패했습니다. 다시 시도해 주세요.');
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
      };
      setProjects(prev => [tempProject, ...prev]);
      setSelectedProject(tempProject);
      navigate(`/project/${tempId}`);

      try {
        let videoMedia: { id: number } | null = null;
        if (data.video) {
          const videoPresign = await presignUpload(data.video, 'video');
          setUploadStatus({ label: 'Uploading video...', progress: 0 });
          await uploadFileToS3(videoPresign.upload_url, data.video, (p) =>
            setUploadStatus({ label: 'Uploading video...', progress: p })
          );
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
          await uploadFileToS3(audioPresign.upload_url, data.audio, (p) =>
            setUploadStatus({ label: 'Uploading audio...', progress: p })
          );
          const audioMedia = await commitMedia({
            s3_key: audioPresign.s3_key,
            type: 'audio',
            content_type: data.audio.type,
            duration_sec: null,
          });
          audioId = audioMedia.id;
        }

        setUploadStatus({ label: 'Starting analysis...', progress: 100 });
        const req = await createAnalysis({
          video_id: videoMedia?.id ?? null,
          audio_id: audioId,
          mode: data.mode,
          title: data.title,
          params_json: data.extractAudio ? { extract_audio: true } : null,
        });

        navigate(`/project/${req.id}`, { replace: true });
        setProjects(prev =>
          prev.map(p =>
            p.id === tempId ? { ...p, id: String(req.id), status: 'queued' } : p
          )
        );
        setSelectedProject(prev =>
          prev?.id === tempId ? { ...prev, id: String(req.id), status: 'queued' } : prev
        );

        startStatusPolling(req.id);
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
