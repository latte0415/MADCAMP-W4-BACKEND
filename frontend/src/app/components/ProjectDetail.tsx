import { useState, useRef, useEffect } from 'react';
import { Project } from '../types';
import { Header } from './Header';
import { VideoPlayer, VideoPlayerHandle } from './VideoPlayer';
import { MainTimelineSection } from './MainTimelineSection';
import { AudioDetailAnalysisSection } from './AudioDetailAnalysisSection';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { Upload, Music, Loader2, Volume2, VolumeX } from 'lucide-react';

interface ProjectDetailProps {
  project: Project;
  loading?: boolean;
  onBack: () => void;
  onOpenUploadDialog?: () => void;
  onReplaceAudio?: (file: File) => void;
  onReplaceVideo?: (file: File) => void;
  onExtractAudioFromVideo?: () => void;
  onDelete?: () => void;
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
  onReplaceVideo,
  onExtractAudioFromVideo,
  onDelete,
  userName = '게스트',
  onLogin,
  onLogout,
}: ProjectDetailProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [audioClipStart, setAudioClipStart] = useState(0);
  const [selectionStart, setSelectionStart] = useState(0);
  const [hasAudioClip, setHasAudioClip] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [progressOpen, setProgressOpen] = useState(true);
  const [selectionBars, setSelectionBars] = useState(8);
  const [isMuted, setIsMuted] = useState(true);
  const rafRef = useRef<number | null>(null);
  const pendingTimeRef = useRef(0);
  const videoPlayerRef = useRef<VideoPlayerHandle>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const BAR_SECONDS = 4;
  const effectiveDuration = Math.max(project.duration || 0, videoDuration || 0);
  const selectionDuration = Math.min(effectiveDuration || 0, BAR_SECONDS * selectionBars);
  const audioClipDuration = Math.min(
    effectiveDuration || 0,
    Math.max(8, (effectiveDuration || 0) * 0.6),
  );

  const handlePlayPause = () => {
    setIsPlaying((prev) => !prev);
  };

  const handleToggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  const handleTimeUpdate = (time: number) => {
    pendingTimeRef.current = time;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setCurrentTime((prev) => {
        const next = pendingTimeRef.current;
        return Math.abs(next - prev) < 0.02 ? prev : next;
      });
    });
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

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    setAudioClipStart(0);
    setSelectionStart(0);
    setHasAudioClip(false);
    setVideoDuration(0);
    setSelectionBars(8);
  }, [project.id]);

  useEffect(() => {
    if (!project.audioUrl || hasAudioClip) return;
    setHasAudioClip(true);
    setAudioClipStart(0);
  }, [project.audioUrl, hasAudioClip]);

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
  const hasDerivedAudio =
    !project.audioUrl &&
    (project.musicKeypoints.length > 0 || (project.bassNotes?.length ?? 0) > 0);
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
  const statusMessage =
    project.statusMessage ??
    (hasError
      ? project.errorMessage ?? '분석에 실패했습니다. 다시 시도해 주세요.'
      : isAnalyzing
        ? '분석이 진행 중입니다.'
        : '프로젝트 정보를 불러오는 중입니다.');
  const statusMessageLower = statusMessage.toLowerCase();
  const isMusicMessage = statusMessageLower.includes('music') || statusMessageLower.includes('audio');
  const audioRequested =
    Boolean(project.audioUrl) ||
    (project.musicKeypoints?.length ?? 0) > 0 ||
    project.audioProgress !== undefined ||
    statusMessageLower.includes('music') ||
    statusMessageLower.includes('audio');
  const motionRequested =
    Boolean(project.videoUrl) ||
    project.motionKeypoints.length > 0 ||
    project.motionProgress !== undefined ||
    statusMessageLower.includes('motion') ||
    statusMessageLower.includes('magic');

  const deriveStageInfo = (message: string, status: Project['status']) => {
    const msg = message.toLowerCase();
    let analysis = '분석';
    if (msg.includes('music') || msg.includes('audio')) analysis = '음악 분석';
    else if (msg.includes('motion')) analysis = '모션 분석';
    else if (msg.includes('magic')) analysis = '매직 분석';
    else if (msg.includes('video')) analysis = '모션 분석';
    else if (project.mode === 'magic') analysis = '매직 분석';
    else if (project.mode === 'dance') analysis = '모션 분석';

    let stage = '대기';
    if (msg.includes('download')) stage = '다운로드';
    else if (msg.includes('extract')) stage = '오디오 추출';
    else if (msg.includes('stem')) stage = '스템 분리';
    else if (msg.includes('analyz') || msg.includes('running')) stage = '분석';
    else if (msg.includes('score')) stage = '스코어링';
    else if (msg.includes('upload')) stage = '업로드';
    else if (msg.includes('final')) stage = '마무리';
    else if (status === 'running') stage = '분석';
    else if (status === 'queued') stage = '대기';

    return { analysis, stage };
  };

  const deriveMotionStage = (message?: string) => {
    if (!message) return null;
    const msg = message.toLowerCase();
    if (msg.includes('music') || msg.includes('audio')) return null;
    if (!msg.includes('motion') && !msg.includes('magic') && !msg.includes('video')) return null;
    if (msg.includes('downloading video')) return '비디오 다운로드';
    if (msg.includes('preprocessing')) return '전처리';
    if (msg.includes('analyzing')) return '모션 분석';
    if (msg.includes('uploading results')) return '결과 업로드';
    if (msg.includes('finalizing')) return '마무리';
    return null;
  };

  const deriveAudioStage = (message?: string) => {
    if (!message) return null;
    const msg = message.toLowerCase();
    if (!msg.includes('music') && !msg.includes('audio')) return null;
    if (msg.includes('queued')) return '대기';
    if (msg.includes('downloading audio')) return '오디오 다운로드';
    if (msg.includes('downloading video')) return '비디오 다운로드';
    if (msg.includes('extracting audio')) return '오디오 추출';
    if (msg.includes('preparing pipeline')) return '파이프라인 준비';
    if (msg.includes('separating stems')) return '스템 분리';
    if (msg.includes('splitting drum bands')) return '드럼 밴드 분리';
    if (msg.includes('detecting onsets')) return '온셋 검출';
    if (msg.includes('selecting keypoints')) return '키포인트 선택';
    if (msg.includes('merging textures')) return '텍스처 병합';
    if (msg.includes('analyzing bass')) return '베이스 분석';
    if (msg.includes('building json')) return '결과 JSON 생성';
    if (msg.includes('uploading results')) return '결과 업로드';
    return null;
  };
  const inferProgressFallback = (stage: string, status: Project['status']) => {
    if (status === 'queued') return 0;
    if (status === 'failed') return 100;
    switch (stage) {
      case '다운로드':
        return 12;
      case '오디오 추출':
        return 28;
      case '스템 분리':
        return 40;
      case '분석':
        return 55;
      case '업로드':
        return 80;
      case '스코어링':
        return 92;
      case '마무리':
        return 96;
      default:
        return 10;
    }
  };
  const { analysis: analysisLabel, stage: stageLabel } = deriveStageInfo(
    statusMessage,
    project.status
  );
  const toPercent = (value?: number) =>
    Math.round(Math.max(0, Math.min(1, value ?? 0)) * 100);
  const progressItems = [
    {
      key: 'analysis-motion',
      label: '모션 분석',
      value: project.motionProgress,
      detail: deriveMotionStage(statusMessage) ?? undefined,
      enabled: motionRequested,
    },
    {
      key: 'analysis-audio',
      label: '오디오 분석',
      value: project.audioProgress,
      detail: deriveAudioStage(statusMessage) ?? undefined,
      enabled: audioRequested,
    },
  ].filter((item) => item.enabled);

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <Header
        onBack={onBack}
        showBack
        showLogo={false}
        variant="studio"
        userName={userName}
        onLogin={onLogin}
        onLogout={onLogout}
      />

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
              <div className="flex items-center justify-between gap-3">
                <span>
                  {hasError
                    ? '분석에 실패했습니다. 오디오를 교체하거나 다시 시도해 주세요.'
                    : isAnalyzing
                      ? '분석이 진행 중입니다. 결과가 준비되면 자동으로 업데이트됩니다.'
                      : '프로젝트 정보를 불러오는 중입니다.'}
                </span>
              </div>
            </div>
          )}
          {/* 정보 섹션 */}
          <section className="mb-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.4em] text-neutral-500 mb-2">
                  D+M LAB · PROJECT
                </div>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <span className="px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.25em] border border-white/10 text-neutral-300 leading-none">
                    {project.mode}
                  </span>
                  <h1 className="text-3xl font-semibold text-white leading-none">{project.title}</h1>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {onDelete && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-transparent border-red-500/40 text-red-200 hover:bg-red-500/10"
                    onClick={onDelete}
                  >
                    삭제
                  </Button>
                )}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'DURATION', value: formatDuration(project.duration) },
                { label: 'CREATED', value: formatDate(project.createdAt) },
                { label: 'LAST EDITED', value: formatDate(lastEditedAt) },
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

          {/* 진행률 섹션 */}
          <section className="mb-8">
            <div className="rounded border border-neutral-800 bg-neutral-950/80 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-3">
                  <div className="text-sm text-white">진행률</div>
                  {!audioRequested && (
                    <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-neutral-400">
                      오디오 없음
                    </span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-transparent border-neutral-700 text-zinc-100 hover:bg-white/5"
                  onClick={() => setProgressOpen((prev) => !prev)}
                >
                  {progressOpen ? '접기' : '펼치기'}
                </Button>
              </div>
              {progressOpen && (
                <>
                  <div className="flex flex-col gap-3">
                  {progressItems.map((item) => {
                    const isMotionRow = item.key === 'analysis-motion';
                    const isAudioRow = item.key === 'analysis-audio';
                    const motionDetail = isMotionRow ? deriveMotionStage(statusMessage) : null;
                    const audioDetail = isAudioRow ? deriveAudioStage(statusMessage) : null;
                    const percent =
                      item.value === undefined
                        ? item.key.startsWith('upload')
                          ? 0
                          : isAudioRow && !audioRequested
                            ? 0
                            : isMotionRow && isMusicMessage && !motionDetail
                              ? 0
                              : inferProgressFallback(stageLabel, project.status)
                        : toPercent(item.value);
                    const state =
                      hasError && item.label.includes('분석')
                        ? isAudioRow && !audioRequested
                          ? '대기'
                          : isMotionRow && isMusicMessage && !motionDetail
                            ? '대기'
                            : '실패'
                        : percent >= 100
                          ? '완료'
                          : item.value === undefined
                            ? '대기'
                            : '진행 중';
                      const barClass =
                        state === '실패'
                          ? 'bg-red-500/70'
                          : state === '완료'
                            ? 'bg-emerald-400/80'
                            : state === '진행 중'
                              ? 'bg-amber-400/80'
                              : 'bg-neutral-500/60';
                      return (
                        <div
                          key={item.key}
                          className="rounded border border-neutral-800 bg-black/20 px-4 py-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
                            <span className="font-medium text-neutral-200">{item.label}</span>
                            <span className="tabular-nums text-neutral-400">
                              {percent}% · {state}
                            </span>
                          </div>
                          <div className="mt-2">
                            <Progress
                              value={percent}
                              className="bg-white/10"
                              indicatorClassName={barClass}
                            />
                          </div>
                          {item.key === 'analysis-motion' &&
                            project.uploadVideoProgress !== undefined &&
                            project.uploadVideoProgress < 1 && (
                              <div className="mt-2 text-[11px] text-neutral-500">
                                업로드: {toPercent(project.uploadVideoProgress)}%
                              </div>
                            )}
                          {item.key === 'analysis-audio' &&
                            project.uploadAudioProgress !== undefined &&
                            project.uploadAudioProgress < 1 && (
                              <div className="mt-2 text-[11px] text-neutral-500">
                                업로드: {toPercent(project.uploadAudioProgress)}%
                              </div>
                            )}
                          {item.detail && (
                            <div className="mt-2 text-[11px] text-neutral-500">
                              단계: {item.detail}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 text-xs text-neutral-400">{statusMessage}</div>
                  <div className="mt-2 flex flex-wrap gap-4 text-xs text-neutral-500">
                    <span>분석: {analysisLabel}</span>
                    <span>단계: {stageLabel}</span>
                  </div>
                  {hasError && (
                    <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                      <div className="font-semibold">에러 발생</div>
                      <div className="mt-1">
                        {project.errorMessage ?? '분석 중 오류가 발생했습니다. 다시 시도해 주세요.'}
                      </div>
                      {project.statusLog && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-red-200/80">에러 상세 보기</summary>
                          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-[10px] text-red-100">
                            {project.statusLog}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {/* 비디오 섹션 */}
          <section className="mb-8">
            <div className="rounded border border-neutral-800 bg-neutral-950/80 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h2 className="text-lg font-semibold text-white">비디오</h2>
                <div className="flex items-center gap-3">
                  {onReplaceVideo && project.videoUrl && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-transparent border-neutral-700 text-zinc-100 hover:bg-white/5"
                        onClick={() => videoInputRef.current?.click()}
                      >
                        <Upload className="size-4 mr-2" />
                        비디오 교체
                      </Button>
                      <input
                        ref={videoInputRef}
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) onReplaceVideo(file);
                          e.currentTarget.value = '';
                        }}
                      />
                    </>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleToggleMute}
                    className="bg-transparent border-neutral-700 text-zinc-100 hover:bg-white/5"
                  >
                    {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                  </Button>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-[0.35em]">
                    Visual Timeline
                  </span>
                </div>
              </div>
              {!project.videoUrl ? (
                <div className="rounded border border-neutral-800 bg-neutral-950/80 p-8 text-center">
                  <p className="text-neutral-400 mb-4">영상이 없습니다.</p>
                  <Button
                    variant="outline"
                    className="bg-transparent border-neutral-700 text-zinc-100 hover:bg-white/5"
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
                      onDuration={setVideoDuration}
                      muted={isMuted}
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
                </>
              )}
            </div>
          </section>

          {/* 메인 타임라인 섹션 */}
          <section className="mb-8">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="text-sm text-neutral-400">오디오 컨트롤</div>
              <div className="flex flex-wrap items-center gap-3">
                {onReplaceAudio ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-transparent border-neutral-700 text-zinc-100 hover:bg-white/5"
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
                    {!project.audioUrl && project.videoUrl && onExtractAudioFromVideo && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-transparent border-neutral-700 text-zinc-100 hover:bg-white/5"
                        onClick={onExtractAudioFromVideo}
                        disabled={isAnalyzing}
                      >
                        <Music className="size-4 mr-2" />
                        영상에서 음악 추출
                      </Button>
                    )}
                  </>
                ) : !project.audioUrl ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-transparent border-neutral-700 text-zinc-100 hover:bg-white/5"
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
            <MainTimelineSection
              duration={effectiveDuration}
              currentTime={currentTime}
              isPlaying={isPlaying}
              onPlayPause={handlePlayPause}
              onSeek={handleSeek}
              videoKeypoints={project.motionKeypoints}
              audioUrl={project.audioUrl}
              audioAvailable={Boolean(project.audioUrl) || hasDerivedAudio}
              audioSourceLabel={hasDerivedAudio ? '오디오 있음 (영상 추출)' : undefined}
              hasAudioClip={hasAudioClip}
              onPlaceAudioClip={() => {
                setHasAudioClip(true);
                setAudioClipStart(Math.min(project.duration, currentTime));
              }}
              audioClipStart={audioClipStart}
              audioClipDuration={audioClipDuration}
              onAudioClipChange={setAudioClipStart}
              selectionStart={selectionStart}
              selectionDuration={selectionDuration}
              selectionBars={selectionBars}
              onSelectionBarsChange={(bars) => {
                setSelectionBars(bars);
                setSelectionStart((prev) =>
                  Math.min(prev, Math.max(0, effectiveDuration - bars * BAR_SECONDS))
                );
              }}
              onSelectionStart={setSelectionStart}
              onHoverTime={setHoverTime}
            />
          </section>

          {/* 오디오 상세 분석 섹션 */}
          <section className="mb-8">
            {project.musicKeypoints.length > 0 || (project.bassNotes?.length ?? 0) > 0 ? (
              <AudioDetailAnalysisSection
              audioUrl={project.audioUrl}
              duration={effectiveDuration}
              currentTime={currentTime}
              selectionStart={selectionStart}
              selectionDuration={selectionDuration}
              musicKeypoints={project.musicKeypoints}
              bassNotes={project.bassNotes}
              onSeek={handleSeek}
              />
            ) : (
              <div className="rounded border border-neutral-800 bg-neutral-950/80 p-4 text-sm text-neutral-500">
                선택한 구간에 대한 분석 데이터가 아직 없습니다.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
