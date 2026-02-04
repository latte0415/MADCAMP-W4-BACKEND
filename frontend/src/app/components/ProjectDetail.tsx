import { useState, useRef, useEffect } from 'react';
import { Project } from '../types';
import { Header } from './Header';
import { VideoPlayer, VideoPlayerHandle } from './VideoPlayer';
import { Timeline } from './Timeline';
import { AudioWaveformTimeline } from './AudioWaveformTimeline';
import { MusicAnalysisSection } from './MusicAnalysisSection';
import { Button } from './ui/button';
import { Upload, Music, Loader2 } from 'lucide-react';

interface ProjectDetailProps {
  project: Project;
  onBack: () => void;
  onOpenUploadDialog?: () => void;
  userName?: string;
  onLogin?: () => void;
  onLogout?: () => void;
}

export function ProjectDetail({
  project,
  onBack,
  onOpenUploadDialog,
  userName = '게스트',
  onLogin,
  onLogout,
}: ProjectDetailProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const videoPlayerRef = useRef<VideoPlayerHandle>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  const handlePlayPause = () => {
    setIsPlaying((prev) => !prev);
  };

  const handleTimeUpdate = (time: number) => {
    setCurrentTime(time);
  };

  const handleSeek = (time: number) => {
    videoPlayerRef.current?.seek(time);
    setCurrentTime(time);
  };

  useEffect(() => {
    const el = previewVideoRef.current;
    if (!el || hoverTime === null) return;
    el.currentTime = hoverTime;
  }, [hoverTime]);

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('ko-KR', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const lastEditedAt = project.completedAt ?? project.createdAt;
  const isAnalyzing = project.status === 'queued' || project.status === 'running';
  const hasNoMusicResult =
    project.status === 'done' && project.musicKeypoints.length === 0 && !project.audioUrl;

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <Header onBack={onBack} showBack userName={userName} onLogin={onLogin} onLogout={onLogout} />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">
          {/* 정보 섹션 */}
          <section className="mb-8">
            <h1 className="text-2xl font-bold text-white mb-2">{project.title}</h1>
            <div className="text-sm text-zinc-400">
              마지막 편집일: {formatDate(lastEditedAt)}
            </div>
          </section>

          {/* 비디오 섹션 */}
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-white mb-4">비디오</h2>
            {!project.videoUrl ? (
              <div className="rounded-lg border border-white/10 bg-zinc-900/50 p-8 text-center">
                <p className="text-zinc-400 mb-4">영상이 없습니다.</p>
                <Button
                  variant="outline"
                  className="bg-white/5 border-white/10 hover:bg-white/10"
                  onClick={onOpenUploadDialog}
                >
                  <Upload className="size-4 mr-2" />
                  영상 업로드
                </Button>
                <p className="text-xs text-zinc-500 mt-2">
                  새 프로젝트에서 영상을 업로드할 수 있습니다.
                </p>
              </div>
            ) : (
              <>
                <div className="relative mb-4">
                  <VideoPlayer
                    ref={videoPlayerRef}
                    videoUrl={project.videoUrl}
                    isPlaying={isPlaying}
                    onPlayPause={handlePlayPause}
                    onTimeUpdate={handleTimeUpdate}
                    currentTime={currentTime}
                  />
                  {hoverTime !== null && project.videoUrl && (
                    <div className="absolute bottom-4 left-4 z-10 w-40 overflow-hidden rounded border border-white/20 bg-black/80 shadow-lg">
                      <video
                        ref={previewVideoRef}
                        src={project.videoUrl}
                        muted
                        playsInline
                        preload="auto"
                        className="w-full aspect-video object-contain pointer-events-none"
                      />
                      <div className="px-2 py-1 text-xs text-zinc-300 text-center">
                        {Math.floor(hoverTime)}s
                      </div>
                    </div>
                  )}
                </div>
                <Timeline
                  duration={project.duration}
                  currentTime={currentTime}
                  musicKeypoints={project.musicKeypoints}
                  motionKeypoints={project.motionKeypoints}
                  onSeek={handleSeek}
                  onHoverTime={setHoverTime}
                />
              </>
            )}
          </section>

          {/* 오디오 섹션 */}
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-white mb-4">오디오</h2>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              {!project.audioUrl ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-white/5 border-white/10 hover:bg-white/10"
                    onClick={onOpenUploadDialog}
                  >
                    <Music className="size-4 mr-2" />
                    음악 업로드
                  </Button>
                  <span className="text-xs text-zinc-500">
                    오디오는 새 프로젝트 생성 시 함께 업로드할 수 있습니다.
                  </span>
                </>
              ) : null}
              {isAnalyzing && (
                <span className="flex items-center gap-2 text-sm text-zinc-400">
                  <Loader2 className="size-4 animate-spin" />
                  분석 중...
                </span>
              )}
              {hasNoMusicResult && (
                <span className="text-sm text-zinc-500">
                  이 프로젝트는 음악 분석이 완료되지 않았습니다.
                </span>
              )}
            </div>
            <div className="space-y-4">
              <AudioWaveformTimeline
                audioUrl={project.audioUrl}
                duration={project.duration}
                currentTime={currentTime}
                onSeek={handleSeek}
              />
              {(project.musicKeypoints.length > 0 || (project.bassNotes?.length ?? 0) > 0) && (
                <MusicAnalysisSection
                  duration={project.duration}
                  currentTime={currentTime}
                  musicKeypoints={project.musicKeypoints}
                  bassNotes={project.bassNotes}
                  onSeek={handleSeek}
                />
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
