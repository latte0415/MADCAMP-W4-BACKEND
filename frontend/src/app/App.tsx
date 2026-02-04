import { useEffect, useState } from 'react';
import { VinylLibrary3D } from './components/VinylLibrary3D';
import { ProjectDetail } from './components/ProjectDetail';
import { UploadDialog } from './components/UploadDialog';
import { Project, ProjectMode } from './types';
import {
  getLibrary,
  mapLibraryItem,
  getProjectDetail,
  fetchJson,
  parseMusicKeypoints,
  parseMotionKeypoints,
  mapProjectDetail,
  presignUpload,
  uploadFileToS3,
  commitMedia,
  createAnalysis,
  getAnalysisStatus,
  getMe,
  logout,
} from './api';

type View = 'library' | 'detail';

export default function App() {
  const [view, setView] = useState<View>('library');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [userName, setUserName] = useState<string>('게스트');
  const [loadingProject, setLoadingProject] = useState(false);

  const refreshLibrary = async () => {
    const items = await getLibrary();
    setProjects(items.map(mapLibraryItem));
  };

  const handleSelectProject = async (project: Project) => {
    setLoadingProject(true);
    try {
      const detail = await getProjectDetail(project.id);
      const musicJson = await fetchJson(detail.results?.music_json);
      const motionJson = await fetchJson(detail.results?.motion_json);
      const magicJson = await fetchJson(detail.results?.magic_json);

      const musicKeypoints = parseMusicKeypoints(musicJson);
      const motionKeypoints = [
        ...parseMotionKeypoints(motionJson),
        ...parseMotionKeypoints(magicJson),
      ];
      setSelectedProject(mapProjectDetail(detail, musicKeypoints, motionKeypoints));
      setView('detail');
    } finally {
      setLoadingProject(false);
    }
  };

  const handleBack = () => {
    setView('library');
    setSelectedProject(null);
  };

  const handleNewProject = () => {
    setUploadDialogOpen(true);
  };

  const handleUpload = (data: {
    title: string;
    mode: ProjectMode;
    video?: File;
    audio?: File;
  }) => {
    (async () => {
      if (!data.video) {
        alert('영상 파일이 필요합니다.');
        return;
      }

      setUploadDialogOpen(false);

      const videoPresign = await presignUpload(data.video, 'video');
      await uploadFileToS3(videoPresign.upload_url, data.video);
      const videoMedia = await commitMedia({
        s3_key: videoPresign.s3_key,
        type: 'video',
        content_type: data.video.type,
        duration_sec: null,
      });

      let audioId: number | null = null;
      if (data.audio) {
        const audioPresign = await presignUpload(data.audio, 'audio');
        await uploadFileToS3(audioPresign.upload_url, data.audio);
        const audioMedia = await commitMedia({
          s3_key: audioPresign.s3_key,
          type: 'audio',
          content_type: data.audio.type,
          duration_sec: null,
        });
        audioId = audioMedia.id;
      }

      const req = await createAnalysis({
        video_id: videoMedia.id,
        audio_id: audioId,
        mode: data.mode,
        title: data.title,
      });

      const tempProject: Project = {
        id: String(req.id),
        title: data.title,
        mode: data.mode,
        duration: 0,
        createdAt: new Date(),
        musicKeypoints: [],
        motionKeypoints: [],
        status: 'queued',
      };
      setProjects(prev => [tempProject, ...prev]);

      const poll = setInterval(async () => {
        const st = await getAnalysisStatus(req.id);
        if (st.status === 'done' || st.status === 'failed') {
          clearInterval(poll);
          await refreshLibrary();
        } else {
          setProjects(prev =>
            prev.map(p => (p.id === String(req.id) ? { ...p, status: st.status as any } : p))
          );
        }
      }, 2000);
    })();
  };

  useEffect(() => {
    getMe()
      .then(me => setUserName(me.name || me.email || 'User'))
      .catch(() => setUserName('게스트'));
    refreshLibrary().catch(() => {});
  }, []);

  return (
    <div className="size-full bg-zinc-950 text-white">
      {view === 'library' ? (
        <VinylLibrary3D
          userName={userName}
          onLogin={() => (window.location.href = '/auth/google/login')}
          onLogout={async () => {
            await logout();
            setUserName('게스트');
          }}
          projects={projects}
          onSelectProject={handleSelectProject}
          onNewProject={handleNewProject}
          loading={loadingProject}
        />
      ) : selectedProject ? (
        <ProjectDetail
          project={selectedProject}
          onBack={handleBack}
          userName={userName}
          onLogin={() => (window.location.href = '/auth/google/login')}
          onLogout={async () => {
            await logout();
            setUserName('게스트');
          }}
        />
      ) : null}

      <UploadDialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        onUpload={handleUpload}
      />
    </div>
  );
}
