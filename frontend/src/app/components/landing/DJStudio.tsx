import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Project, ProjectMode } from '../../types';
import { GenerativeAlbumArt } from './GenerativeAlbumArt';
import { RecordingOverlay } from './RecordingOverlay';
import { Progress } from '../ui/progress';

export interface NewProjectData {
  title: string;
  mode: ProjectMode;
  videoFile?: File;
  audioFile?: File;
  extractAudio?: boolean;
}

interface DJStudioProps {
  projects: Project[];
  onOpenProject: (project: Project) => void;
  onEnterProject?: (
    project: Project,
    onProgress?: (value: number, label?: string) => void
  ) => Promise<boolean> | boolean | void;
  onNewProject?: () => void;
  onCreateProject?: (data: NewProjectData) => void;
  onDeleteProject?: (project: Project) => void;
  userName?: string;
  onLogin?: () => void;
  onLogout?: () => void;
}

export function DJStudio({
  projects,
  onOpenProject,
  onEnterProject,
  onNewProject,
  onCreateProject,
  onDeleteProject,
  userName = '게스트',
  onLogin,
  onLogout,
}: DJStudioProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loadedProject, setLoadedProject] = useState<Project | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showLpOnAlbum, setShowLpOnAlbum] = useState(true);
  const [lpVisible, setLpVisible] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingLpVisible, setRecordingLpVisible] = useState(false);

  // Loading state - starts when play is clicked
  const [isLoading, setIsLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadLabel, setLoadLabel] = useState('프로젝트 불러오는 중');
  const [loadSuccess, setLoadSuccess] = useState(false);

  const currentProject = projects[selectedIndex];
  const isPlaying = loadedProject !== null;
  const targetProject = loadedProject ?? currentProject;
  const canEnter = isPlaying && loadProgress >= 100 && loadSuccess;

  const handleStartRecording = () => {
    if (isTransitioning || isRecording) return;
    // Stop playing if active
    if (isPlaying) {
      setLoadedProject(null);
      setIsSpinning(false);
      setShowLpOnAlbum(true);
      setIsLoading(false);
      setLoadProgress(0);
      setLoadSuccess(false);
    }
    setIsRecording(true);
    setRecordingLpVisible(true);
  };

  const handleCancelRecording = () => {
    setRecordingLpVisible(false);
    setTimeout(() => {
      setIsRecording(false);
    }, 300);
  };

  const handleSubmitRecording = (data: NewProjectData) => {
    if (onCreateProject) {
      onCreateProject(data);
    }
    setRecordingLpVisible(false);
    setTimeout(() => {
      setIsRecording(false);
    }, 300);
  };

  const handleSelectAlbum = (index: number) => {
    if (isTransitioning || isLoading) return;
    if (index !== selectedIndex) {
      setLpVisible(false);
      setSelectedIndex(index);
      setTimeout(() => {
        setLpVisible(true);
      }, 350);
    }
  };

  const handleLoadToTurntable = () => {
    if (currentProject && currentProject.status === 'done' && !isTransitioning && !isLoading) {
      // Start transition animation
      setIsTransitioning(true);
      setLoadedProject(currentProject);
      setShowLpOnAlbum(false);

      // Start loading data simultaneously
      setIsLoading(true);
      setLoadProgress(0);
      setLoadLabel('프로젝트 불러오는 중');
      setLoadSuccess(false);

      if (onEnterProject) {
        Promise.resolve(
          onEnterProject(currentProject, (value, label) => {
            setLoadProgress(Math.max(0, Math.min(100, Math.round(value))));
            if (label) setLoadLabel(label);
          })
        )
          .then((success) => {
            setLoadSuccess(success !== false);
            setIsLoading(false);
          })
          .catch(() => {
            setLoadSuccess(false);
            setIsLoading(false);
          });
      } else {
        // No onEnterProject, simulate instant load
        setLoadProgress(100);
        setLoadLabel('준비 완료');
        setLoadSuccess(true);
        setIsLoading(false);
      }

      setTimeout(() => {
        setIsSpinning(true);
        setIsTransitioning(false);
      }, 700);
    }
  };

  const handleBack = () => {
    setLoadedProject(null);
    setIsSpinning(false);
    setShowLpOnAlbum(true);
    setIsLoading(false);
    setLoadProgress(0);
    setLoadSuccess(false);
  };

  const handleEnterProject = () => {
    if (!canEnter) return;
    const project = loadedProject;
    if (!project) return;
    onOpenProject(project);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTransitioning) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isRecording) {
          handleCancelRecording();
        } else {
          handleBack();
        }
        return;
      }
      if (isRecording) return;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isPlaying) setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!isPlaying) setSelectedIndex((prev) => Math.min(projects.length - 1, prev + 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (canEnter) {
          handleEnterProject();
        } else if (!isPlaying && currentProject && currentProject.status === 'done') {
          handleLoadToTurntable();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndex, projects.length, currentProject, loadedProject, isPlaying, isTransitioning, isRecording, isLoading, canEnter]);

  const handleWheel = (e: React.WheelEvent) => {
    if (isPlaying || isTransitioning || isRecording || isLoading) return;
    const delta = e.deltaY > 0 ? 1 : -1;
    setSelectedIndex((prev) => Math.max(0, Math.min(projects.length - 1, prev + delta)));
  };

  useEffect(() => {
    if (!isPlaying) {
      setShowLpOnAlbum(true);
    }
  }, [selectedIndex, isPlaying]);

  return (
    <section
      className="relative h-screen w-full overflow-hidden"
      style={{ background: '#080808' }}
      onWheel={handleWheel}
    >
      {/* Header */}
      <header className="absolute top-8 left-10 right-10 z-30 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-white text-sm font-medium tracking-wide">D+M LAB</span>
          <span className="text-neutral-500 text-xs">jukebox</span>
        </div>
        <div className="flex items-center gap-6">
          <span className="text-neutral-500 text-xs">{userName}</span>
          {onLogin && userName === '게스트' ? (
            <button onClick={onLogin} className="text-neutral-400 hover:text-white text-xs transition-colors">sign in</button>
          ) : onLogout ? (
            <button onClick={onLogout} className="text-neutral-400 hover:text-white text-xs transition-colors">sign out</button>
          ) : null}
          {(onNewProject || onCreateProject) && (
            <button
              onClick={isRecording ? handleCancelRecording : (onCreateProject ? handleStartRecording : onNewProject)}
              className="text-xs text-white px-4 py-2 transition-colors"
              style={{
                border: isRecording ? '1px solid #d97706' : '1px solid #444',
                background: isRecording ? 'rgba(217, 119, 6, 0.2)' : 'transparent',
                color: isRecording ? '#d97706' : '#fff',
              }}
            >
              {isRecording ? '● rec' : '+ new'}
            </button>
          )}
        </div>
      </header>

      {/* Main content */}
      <div className="absolute inset-0 flex items-center overflow-hidden">
        {/* Left: Vinyl stack */}
        <div className="absolute left-0 h-full flex items-center">
          <div className="pl-10 w-[320px]">
            <div className="relative" style={{ height: 580 }}>
              <div className="absolute -left-3 -right-3 -top-3 -bottom-3" style={{ border: '1px solid #2a2a2a', background: '#0a0a0a' }} />
              <div className="relative h-full flex flex-col justify-center">
                {projects.length === 0 ? (
                  <div className="text-center px-4">
                    <p className="text-neutral-500 text-sm mb-4">no records</p>
                    {(onNewProject || onCreateProject) && (
                      <button
                        onClick={onCreateProject ? handleStartRecording : onNewProject}
                        className="text-xs text-white px-4 py-2"
                        style={{ border: '1px solid #444', background: 'transparent' }}
                      >
                        add first
                      </button>
                    )}
                  </div>
                ) : (
                  projects.map((project, index) => {
                    const offset = index - selectedIndex;
                    const isSelected = offset === 0;
                    const y = offset * 52;
                    if (Math.abs(offset) > 5) return null;

                    return (
                      <motion.div
                        key={project.id}
                        className="absolute left-0 right-0 cursor-pointer"
                        style={{ height: 46 }}
                        animate={{
                          y,
                          x: isSelected ? 35 : 0,
                          opacity: isSelected ? 1 : Math.max(0.2, 0.5 - Math.abs(offset) * 0.08),
                        }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        onClick={() => {
                          handleSelectAlbum(index);
                        }}
                        onDoubleClick={() => {
                          if (!isSelected) return;
                          if (project.status === 'done') {
                            handleLoadToTurntable();
                          }
                        }}
                      >
                        <div
                          className="absolute inset-0 flex items-center"
                          style={{
                            background: isSelected ? '#1a1a1a' : '#0e0e0e',
                            borderTop: `1px solid ${isSelected ? '#3a3a3a' : '#252525'}`,
                            borderBottom: '1px solid #1a1a1a',
                          }}
                        >
                          <div className="absolute left-3 w-9 h-9 rounded-full" style={{ background: '#0c0c0c', border: '1px solid #333' }}>
                            <div className="absolute inset-[28%] rounded-full" style={{ background: project.mode === 'magic' ? '#5a5a9a' : '#e8e8e8' }} />
                          </div>
                          <div className="ml-[52px] flex-1 pr-3 flex items-center">
                            <div className="text-[14px] font-medium truncate" style={{ color: isSelected ? '#eee' : '#666' }}>{project.title}</div>
                          </div>
                          <div className="absolute right-3 text-[12px] font-mono" style={{ color: isSelected ? '#666' : '#333' }}>{String(index + 1).padStart(2, '0')}</div>
                          {isSelected && <div className="absolute left-0 top-0 bottom-0 w-[2px]" style={{ background: '#d97706' }} />}
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
            </div>
            <div className="mt-6 flex items-center gap-4">
              <button onClick={() => setSelectedIndex((prev) => Math.max(0, prev - 1))} className="text-neutral-500 hover:text-white text-base">▲</button>
              <span className="text-neutral-500 text-sm font-mono">{projects.length > 0 ? `${selectedIndex + 1}/${projects.length}` : '—'}</span>
              <button onClick={() => setSelectedIndex((prev) => Math.min(projects.length - 1, prev + 1))} className="text-neutral-500 hover:text-white text-base">▼</button>
            </div>
          </div>
        </div>

        {/* Album display - positioned relative to left list */}
        <div className="absolute h-full flex items-center z-10" style={{ left: 400, marginTop: -60 }}>
          <AnimatePresence mode="wait">
            {isRecording ? (
              <motion.div
                key="recording"
                className="relative"
                style={{ width: 680, height: 680 }}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.25 }}
              >
                <RecordingOverlay
                  onSubmit={handleSubmitRecording}
                  onCancel={handleCancelRecording}
                />
              </motion.div>
            ) : currentProject && (
              <motion.div
                key={currentProject.id}
                className="relative"
                style={{ width: 680, height: 680 }}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{
                  opacity: 1,
                  scale: isPlaying ? 0.82 : 1,
                  x: isPlaying ? -80 : 0,
                  y: isPlaying ? 30 : 0,
                }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.25 }}
              >
                {/* Album sleeve - ENLARGED */}
                <motion.div
                  className="absolute overflow-hidden"
                  style={{
                    width: 580,
                    height: 580,
                    left: 0,
                    top: 50,
                    zIndex: 2,
                    background: currentProject.thumbnailUrl ? `url(${currentProject.thumbnailUrl})` : 'transparent',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    boxShadow: '8px 10px 40px rgba(0,0,0,0.7), 0 0 1px rgba(255,255,255,0.15)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                  animate={{
                    filter: isPlaying ? 'brightness(0.6)' : 'brightness(1)',
                  }}
                >
                  {/* Generative art background when no thumbnail */}
                  {!currentProject.thumbnailUrl && (
                    <GenerativeAlbumArt
                      seed={currentProject.id + currentProject.title}
                      mode={currentProject.mode === 'magic' ? 'magic' : 'dance'}
                      size={580}
                    />
                  )}
                  {/* Gradient overlay */}
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, transparent 40%, transparent 55%, rgba(0,0,0,0.65) 100%)' }} />
                  <div className="absolute top-10 left-10 right-10 z-10">
                    <div className="text-[12px] uppercase tracking-[0.2em] mb-2" style={{ color: 'rgba(255,255,255,0.8)' }}>{currentProject.mode} mode</div>
                    <div className="text-2xl font-medium leading-tight text-white">{currentProject.title}</div>
                  </div>
                  <div className="absolute bottom-10 left-10 right-10 z-10">
                    <div className="text-[12px] tracking-wide mb-2" style={{ color: 'rgba(255,255,255,0.6)' }}>{Math.round(currentProject.duration)}s · {currentProject.status}</div>
                    <div className="text-[11px] uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>D+M LAB</div>
                  </div>
                  <div className="absolute top-10 right-10 text-[14px] font-mono z-10" style={{ color: 'rgba(255,255,255,0.5)' }}>{String(selectedIndex + 1).padStart(2, '0')}</div>

                  {/* Delete button - corner icon */}
                  {onDeleteProject && !isPlaying && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`"${currentProject.title}" 프로젝트를 삭제하시겠습니까?`)) {
                          onDeleteProject(currentProject);
                        }
                      }}
                      className="absolute bottom-4 right-4 w-9 h-9 flex items-center justify-center rounded-full transition-all opacity-30 hover:opacity-100 z-20"
                      style={{ background: 'rgba(0,0,0,0.5)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.8)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.5)'; }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#fff' }}>
                        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
                      </svg>
                    </button>
                  )}

                  {/* Playing indicator overlay */}
                  {isPlaying && (
                    <motion.div
                      className="absolute inset-0 flex items-center justify-center z-20"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <div className="flex items-center gap-1.5">
                        {[0, 1, 2].map((i) => (
                          <motion.div
                            key={i}
                            className="w-1.5 bg-amber-500 rounded-full"
                            animate={{ height: [10, 24, 10] }}
                            transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </motion.div>

                {/* Buttons - only show when not playing */}
                {!isPlaying && (
                  <div className="absolute -bottom-2 left-0 flex items-center gap-3" style={{ zIndex: 2 }}>
                    {currentProject.status === 'done' && !isTransitioning && (
                      <button
                        onClick={handleLoadToTurntable}
                        className="text-sm px-5 py-2.5 transition-colors"
                        style={{ border: '1px solid #d97706', color: '#d97706', background: 'transparent' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#d97706'; e.currentTarget.style.color = '#080808'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#d97706'; }}
                      >
                        play →
                      </button>
                    )}
                    {currentProject.status !== 'done' && (
                      <span className="text-sm text-neutral-500">{currentProject.status === 'failed' ? 'failed' : 'processing...'}</span>
                    )}
                    {isTransitioning && <span className="text-sm text-neutral-400">loading...</span>}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right: Turntable */}
        <motion.div
          className="absolute right-0 h-full flex items-center"
          style={{ perspective: '1200px' }}
          animate={{ x: isPlaying || isTransitioning || isRecording ? 0 : 400 }}
          transition={{ type: 'spring', stiffness: 180, damping: 28 }}
        >
          <div className="relative mr-[-80px]" style={{ width: 520, height: 580, transformStyle: 'preserve-3d', transform: 'rotateY(-12deg)' }}>
            <div className="absolute inset-0" style={{ background: 'linear-gradient(145deg, #151515 0%, #0c0c0c 100%)', border: '1px solid #333', boxShadow: '-10px 0 40px rgba(0,0,0,0.5)' }}>
              <div className="absolute top-0 bottom-0 -left-4 w-4" style={{ background: 'linear-gradient(90deg, #0a0a0a 0%, #111 100%)', transform: 'rotateY(90deg)', transformOrigin: 'right' }} />
              <div className="absolute inset-4" style={{ border: '1px solid #2a2a2a' }} />

              {/* Gear */}
              <div className="absolute" style={{ top: 20, left: 20, width: 50, height: 50, border: '2px solid #3a3a3a', borderRadius: '50%' }}>
                <motion.div className="absolute inset-1 rounded-full" style={{ border: '1px dashed #333' }} animate={{ rotate: isSpinning ? 360 : 0 }} transition={{ duration: 4, ease: 'linear', repeat: isSpinning ? Infinity : 0 }} />
              </div>

              {/* Platter */}
              <div className="absolute rounded-full" style={{ top: 80, left: 80, width: 340, height: 340, background: 'radial-gradient(circle, #141414 0%, #0a0a0a 100%)', border: '3px solid #333', boxShadow: 'inset 0 0 30px rgba(0,0,0,0.8)' }}>
                <div className="absolute inset-3 rounded-full" style={{ border: '1px solid #2a2a2a' }} />
                <div className="absolute inset-6 rounded-full" style={{ border: '1px solid #252525' }} />
                <div className="absolute inset-10 rounded-full" style={{ border: '1px solid #202020' }} />

                <div className="absolute rounded-full z-10" style={{ top: '50%', left: '50%', width: 18, height: 18, transform: 'translate(-50%, -50%)', background: '#222', border: '1px solid #444' }} />
              </div>

              <div className="absolute bottom-6 left-6 right-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isRecording ? (
                    <motion.div
                      className="w-2.5 h-2.5"
                      style={{ background: '#ef4444' }}
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    />
                  ) : (
                    <div className="w-2.5 h-2.5" style={{ background: loadedProject ? '#d97706' : '#2a2a2a' }} />
                  )}
                  <span className="text-[9px]" style={{ color: isRecording ? '#ef4444' : '#666' }}>
                    {isRecording ? 'REC' : 'POWER'}
                  </span>
                </div>
                <span className="text-[10px] text-neutral-500 tracking-wider">33 RPM</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Controls - show when playing */}
        <AnimatePresence>
          {loadedProject && (
            <motion.div
              className="absolute bottom-24 right-12 flex flex-col items-end gap-4 z-50"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ delay: 0.2 }}
            >
              {/* Loading progress */}
              <div className="w-[280px]">
                <div className="flex items-center justify-between text-[11px] mb-2">
                  <span style={{ color: loadProgress >= 100 ? '#fbbf24' : '#a1a1aa' }}>{loadLabel}</span>
                  <span style={{ color: loadProgress >= 100 ? '#fbbf24' : '#a1a1aa' }}>{loadProgress}%</span>
                </div>
                <Progress
                  value={loadProgress}
                  className="h-2 bg-white/10"
                  indicatorClassName={loadProgress >= 100 ? 'bg-amber-400' : 'bg-amber-400/60'}
                />
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-6">
                <button onClick={handleBack} className="text-sm text-neutral-400 hover:text-white transition-colors">← back</button>
                <button
                  onClick={handleEnterProject}
                  disabled={!canEnter}
                  className="text-sm px-6 py-2.5 transition-all"
                  style={{
                    border: canEnter ? '1px solid #d97706' : '1px solid #444',
                    color: canEnter ? '#d97706' : '#555',
                    background: 'transparent',
                    opacity: canEnter ? 1 : 0.5,
                    cursor: canEnter ? 'pointer' : 'not-allowed',
                  }}
                  onMouseEnter={(e) => {
                    if (!canEnter) return;
                    e.currentTarget.style.background = '#d97706';
                    e.currentTarget.style.color = '#080808';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = canEnter ? '#d97706' : '#555';
                  }}
                >
                  {canEnter ? 'enter project →' : isLoading ? 'loading...' : 'enter project →'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Floating LP - animates between album and turntable - slides out from behind album */}
      {!isRecording && (currentProject || loadedProject) && (
        <motion.div
          key={`lp-${currentProject?.id ?? loadedProject?.id}`}
          className="absolute pointer-events-none"
          style={{ zIndex: 1 }}
          initial={{
            left: 380,
            top: 'calc(50% - 310px)',
            width: 560,
            height: 560,
            opacity: 0,
          }}
          animate={{
            left: showLpOnAlbum ? (lpVisible ? 620 : 420) : 'calc(100% - 335px)',
            top: showLpOnAlbum ? 'calc(50% - 310px)' : 'calc(50% - 190px)',
            width: showLpOnAlbum ? 560 : 300,
            height: showLpOnAlbum ? 560 : 300,
            opacity: lpVisible ? 1 : 0,
          }}
          transition={{
            type: 'spring',
            stiffness: 100,
            delay: (lpVisible && showLpOnAlbum) ? 0.35 : 0,
            damping: 18,
          }}
        >
          <motion.div
            className="w-full h-full rounded-full relative"
            animate={{ rotate: isSpinning ? 360 : 0 }}
            transition={{ duration: 1.8, ease: 'linear', repeat: isSpinning ? Infinity : 0 }}
            style={{
              background: `radial-gradient(circle,
                #0c0c0c 0%, #0c0c0c 16%,
                #1a1a1a 17%, #121212 20%,
                #1e1e1e 21%, #141414 25%,
                #1a1a1a 26%, #121212 30%,
                #1e1e1e 31%, #141414 35%,
                #1a1a1a 36%, #121212 40%,
                #1e1e1e 41%, #141414 45%,
                #1a1a1a 46%, #121212 50%,
                #1e1e1e 51%, #141414 55%,
                #1a1a1a 56%, #0c0c0c 100%
              )`,
              boxShadow: '4px 4px 30px rgba(0,0,0,0.7), 0 0 1px rgba(255,255,255,0.1)',
              border: '1px solid #333',
            }}
          >
            <div className="absolute inset-0 rounded-full" style={{
              background: `conic-gradient(from 30deg, transparent 0deg, rgba(255,255,255,0.06) 20deg, rgba(255,255,255,0.12) 40deg, transparent 80deg, transparent 180deg, rgba(255,255,255,0.04) 200deg, rgba(255,255,255,0.08) 220deg, transparent 260deg, transparent 360deg)`
            }} />
            <div className="absolute rounded-full" style={{ top: '15%', left: '20%', width: '25%', height: '8%', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)', transform: 'rotate(-30deg)', filter: 'blur(2px)' }} />
            <div className="absolute rounded-full" style={{ bottom: '25%', right: '15%', width: '20%', height: '6%', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)', transform: 'rotate(45deg)', filter: 'blur(2px)' }} />
            <div className="absolute rounded-full" style={{ top: '50%', left: '50%', width: '28%', height: '28%', transform: 'translate(-50%, -50%)', background: (loadedProject || currentProject)?.mode === 'magic' ? '#5a5a9a' : '#f0f0f0', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.1)' }}>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-[9px] uppercase tracking-widest" style={{ color: (loadedProject || currentProject)?.mode === 'magic' ? '#ccc' : '#555' }}>D+M</div>
              </div>
              <div className="absolute rounded-full" style={{ top: '50%', left: '50%', width: 14, height: 14, transform: 'translate(-50%, -50%)', background: '#0a0a0a', border: '1px solid #333' }} />
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* Floating Tonearm - above LP */}
      {(isPlaying || isTransitioning) && (
        <motion.div
          className="absolute pointer-events-none"
          style={{ zIndex: 15, right: 50, top: 'calc(50% - 230px)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          {/* Pivot */}
          <div className="absolute rounded-full" style={{ top: 0, right: 0, width: 28, height: 28, background: '#1a1a1a', border: '2px solid #3a3a3a' }} />
          {/* Arm */}
          <motion.div
            className="absolute"
            style={{ top: 9, right: 6, width: 155, height: 3, background: 'linear-gradient(180deg, #3a3a3a 0%, #252525 100%)', transformOrigin: 'right center', boxShadow: '0 2px 4px rgba(0,0,0,0.3)' }}
            animate={{ rotate: isSpinning ? -50 : -28 }}
            transition={{ type: 'spring', stiffness: 80, damping: 15 }}
          >
            <div className="absolute" style={{ left: -6, top: -5, width: 18, height: 14, background: '#3a3a3a' }} />
            <div className="absolute" style={{ left: -2, top: 11, width: 2, height: 7, background: '#d97706' }} />
          </motion.div>
        </motion.div>
      )}

      {/* Recording LP - animates from stack to turntable */}
      <AnimatePresence>
        {recordingLpVisible && (
          <motion.div
            className="absolute pointer-events-none"
            style={{ zIndex: 5 }}
            initial={{
              left: 140,
              top: 'calc(50% - 20px)',
              width: 45,
              height: 45,
              opacity: 0,
            }}
            animate={{
              left: 'calc(100% - 335px)',
              top: 'calc(50% - 190px)',
              width: 300,
              height: 300,
              opacity: 1,
            }}
            exit={{
              opacity: 0,
              scale: 0.8,
            }}
            transition={{
              type: 'spring',
              stiffness: 100,
              damping: 18,
            }}
          >
            <motion.div
              className="w-full h-full rounded-full relative"
              animate={{ rotate: 360 }}
              transition={{ duration: 3, ease: 'linear', repeat: Infinity }}
              style={{
                background: `radial-gradient(circle,
                  #0c0c0c 0%, #0c0c0c 16%,
                  #1a1a1a 17%, #121212 20%,
                  #1e1e1e 21%, #141414 25%,
                  #1a1a1a 26%, #121212 30%,
                  #1e1e1e 31%, #141414 35%,
                  #1a1a1a 36%, #121212 40%,
                  #1e1e1e 41%, #141414 45%,
                  #1a1a1a 46%, #121212 50%,
                  #1e1e1e 51%, #141414 55%,
                  #1a1a1a 56%, #0c0c0c 100%
                )`,
                boxShadow: '4px 4px 30px rgba(0,0,0,0.7), 0 0 1px rgba(255,255,255,0.1)',
                border: '1px solid #333',
              }}
            >
              <div className="absolute inset-0 rounded-full" style={{
                background: `conic-gradient(from 30deg, transparent 0deg, rgba(255,255,255,0.06) 20deg, rgba(255,255,255,0.12) 40deg, transparent 80deg, transparent 180deg, rgba(255,255,255,0.04) 200deg, rgba(255,255,255,0.08) 220deg, transparent 260deg, transparent 360deg)`
              }} />
              {/* Empty center - blank LP */}
              <div className="absolute rounded-full" style={{ top: '50%', left: '50%', width: '28%', height: '28%', transform: 'translate(-50%, -50%)', background: '#1a1a1a', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)' }}>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-[9px] uppercase tracking-widest text-neutral-600">NEW</div>
                </div>
                <div className="absolute rounded-full" style={{ top: '50%', left: '50%', width: 14, height: 14, transform: 'translate(-50%, -50%)', background: '#0a0a0a', border: '1px solid #333' }} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recording Tonearm */}
      {isRecording && (
        <motion.div
          className="absolute pointer-events-none"
          style={{ zIndex: 15, right: 50, top: 'calc(50% - 230px)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <div className="absolute rounded-full" style={{ top: 0, right: 0, width: 28, height: 28, background: '#1a1a1a', border: '2px solid #3a3a3a' }} />
          <motion.div
            className="absolute"
            style={{ top: 9, right: 6, width: 155, height: 3, background: 'linear-gradient(180deg, #3a3a3a 0%, #252525 100%)', transformOrigin: 'right center', boxShadow: '0 2px 4px rgba(0,0,0,0.3)' }}
            animate={{ rotate: -50 }}
            transition={{ type: 'spring', stiffness: 80, damping: 15, delay: 0.3 }}
          >
            <div className="absolute" style={{ left: -6, top: -5, width: 18, height: 14, background: '#3a3a3a' }} />
            <motion.div
              className="absolute"
              style={{ left: -2, top: 11, width: 2, height: 7, background: '#ef4444' }}
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          </motion.div>
        </motion.div>
      )}

      <div className="absolute bottom-8 left-10 text-neutral-500 text-sm tracking-wide">
        {isRecording ? '녹음 중... 파일을 업로드하세요' : isPlaying ? (canEnter ? 'enter to open project' : 'loading...') : '↑ ↓ select · enter to play'}
      </div>

      <AnimatePresence>
        {loadedProject && (
          <motion.div className="absolute top-8 left-1/2 -translate-x-1/2 flex items-center gap-3" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#d97706' }} />
            <span className="text-neutral-300 text-sm">now playing: <span className="text-white">{loadedProject.title}</span></span>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
