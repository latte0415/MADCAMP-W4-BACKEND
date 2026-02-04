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
  loading?: boolean;
  onBack: () => void;
  onOpenUploadDialog?: () => void;
  onReplaceAudio?: (file: File) => void;
  userName?: string;
  onLogin?: () => void;
  onLogout?: () => void;
}

export function ProjectDetail({
  project,
  loading = false,
  onBack,
  onOpenUploadDialog,
  onReplaceAudio,
  userName = '게스트',
  onLogin,
  onLogout,
}: ProjectDetailProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const videoPlayerRef = useRef<VideoPlayerHandle>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

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

  const formatDuration = (seconds: number) => {
    if (!seconds || seconds <= 0) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const lastEditedAt = project.completedAt ?? project.createdAt;
  const isAnalyzing = project.status === 'queued' || project.status === 'running';
  const hasNoMusicResult =
    project.status === 'done' && project.musicKeypoints.length === 0 && !project.audioUrl;
  const hasError = project.status === 'failed';
  const statusLabel: Record<Project['status'], string> = {
    queued: '대기 중',
    running: '분석 중',
    done: '완료',
    failed: '실패',
    draft: '초안',
  };
  const statusClass: Record<Project['status'], string> = {
    queued: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    running: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    done: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    failed: 'border-red-500/40 bg-red-500/10 text-red-200',
    draft: 'border-neutral-500/40 bg-neutral-500/10 text-neutral-200',
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <Header onBack={onBack} showBack userName={userName} onLogin={onLogin} onLogout={onLogout} />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-10">
          {(loading || isAnalyzing || hasError) && (
            <div
              className={`mb-6 rounded border px-4 py-3 text-sm ${
                hasError
                  ? 'border-red-500/30 bg-red-500/10 text-red-200'
                  : isAnalyzing
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
                    : 'border-neutral-700/40 bg-neutral-900/60 text-neutral-300'
              }`}
            >
              {hasError
                ? '분석에 실패했습니다. 오디오를 교체하거나 다시 시도해 주세요.'
                : isAnalyzing
                  ? '분석이 진행 중입니다. 결과가 준비되면 자동으로 업데이트됩니다.'
                  : '프로젝트 정보를 불러오는 중입니다.'}
            </div>
          )}
          {/* 정보 섹션 */}
          <section className="mb-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.4em] text-neutral-500 mb-2">
                  D+M LAB · PROJECT
                </div>
                <h1 className="text-3xl font-semibold text-white mb-2">{project.title}</h1>
                <div className="text-sm text-zinc-400">
                  마지막 편집일: {formatDate(lastEditedAt)}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.25em] border border-white/10 text-neutral-300">
                  {project.mode}
                </span>
                <span
                  className={`px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.25em] border ${statusClass[project.status]}`}
                >
                  {statusLabel[project.status]}
                </span>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'DURATION', value: formatDuration(project.duration) },
                { label: 'CREATED', value: formatDate(project.createdAt) },
                { label: 'AUDIO', value: project.audioUrl ? '연결됨' : '없음' },
                {
                  label: 'MARKERS',
                  value: String(project.motionKeypoints.length + project.musicKeypoints.length),
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded border border-neutral-800 bg-neutral-950/80 px-4 py-3"
                >
                  <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-500">
                    {item.label}
                  </div>
                  <div className="text-sm text-white">{item.value}</div>
                </div>
              ))}
            </div>
          </section>

          {/* 비디오 섹션 */}
          <section className="mb-8">
            <div className="rounded border border-neutral-800 bg-neutral-950/80 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">비디오</h2>
                <span className="text-[10px] text-neutral-500 uppercase tracking-[0.35em]">
                  Visual Timeline
                </span>
              </div>
              {!project.videoUrl ? (
                <div className="rounded border border-neutral-800 bg-neutral-950/80 p-8 text-center">
                  <p className="text-neutral-400 mb-4">영상이 없습니다.</p>
                  <Button
                    variant="outline"
                    className="bg-transparent border-neutral-700 hover:bg-white/5"
                    onClick={onOpenUploadDialog}
                  >
                    <Upload className="size-4 mr-2" />
                    영상 업로드
                  </Button>
                  <p className="text-xs text-neutral-500 mt-2">
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
            </div>
          </section>

          {/* 오디오 섹션 */}
          <section className="mb-8">
            <div className="rounded border border-neutral-800 bg-neutral-950/80 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h2 className="text-lg font-semibold text-white">오디오</h2>
                <div className="flex flex-wrap items-center gap-3">
                  {onReplaceAudio ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-transparent border-neutral-700 hover:bg-white/5"
                        onClick={() => audioInputRef.current?.click()}
                      >
                        <Music className="size-4 mr-2" />
                        {project.audioUrl ? '오디오 교체' : '음악 업로드'}
                      </Button>
                      <input
                        ref={audioInputRef}
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) onReplaceAudio(file);
                          e.currentTarget.value = '';
                        }}
                      />
                    </>
                  ) : !project.audioUrl ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-transparent border-neutral-700 hover:bg-white/5"
                        onClick={onOpenUploadDialog}
                      >
                        <Music className="size-4 mr-2" />
                        음악 업로드
                      </Button>
                      <span className="text-xs text-neutral-500">
                        오디오는 새 프로젝트 생성 시 함께 업로드할 수 있습니다.
                      </span>
                    </>
                  ) : null}
                  {isAnalyzing && (
                    <span className="flex items-center gap-2 text-sm text-neutral-400">
                      <Loader2 className="size-4 animate-spin" />
                      분석 중...
                    </span>
                  )}
                  {hasNoMusicResult && (
                    <span className="text-sm text-neutral-500">
                      이 프로젝트는 음악 분석이 완료되지 않았습니다.
                    </span>
                  )}
                </div>
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
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
