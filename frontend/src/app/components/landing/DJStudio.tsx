import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Project } from '../../types';

interface DJStudioProps {
  projects: Project[];
  onOpenProject: (project: Project) => void;
  onNewProject?: () => void;
  userName?: string;
  onLogin?: () => void;
  onLogout?: () => void;
}

export function DJStudio({
  projects,
  onOpenProject,
  onNewProject,
  userName = '게스트',
  onLogin,
  onLogout,
}: DJStudioProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loadedProject, setLoadedProject] = useState<Project | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);

  const currentProject = projects[selectedIndex];
  const isPlaying = loadedProject !== null;

  const handleSelectAlbum = (index: number) => {
    setSelectedIndex(index);
  };

  const handleLoadToTurntable = () => {
    if (currentProject && currentProject.status === 'done') {
      setLoadedProject(currentProject);
      setIsSpinning(true);
    }
  };

  const handleBack = () => {
    setLoadedProject(null);
    setIsSpinning(false);
  };

  const handleEnterProject = () => {
    if (loadedProject) {
      onOpenProject(loadedProject);
      return;
    }
    if (currentProject) {
      onOpenProject(currentProject);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isPlaying) setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!isPlaying) setSelectedIndex((prev) => Math.min(projects.length - 1, prev + 1));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleBack();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (loadedProject) {
          handleEnterProject();
        } else if (currentProject) {
          if (currentProject.status === 'done') {
            handleLoadToTurntable();
          } else {
            onOpenProject(currentProject);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndex, projects.length, currentProject, loadedProject, isPlaying]);

  const handleWheel = (e: React.WheelEvent) => {
    if (isPlaying) return;
    const delta = e.deltaY > 0 ? 1 : -1;
    setSelectedIndex((prev) => Math.max(0, Math.min(projects.length - 1, prev + delta)));
  };

  return (
    <section
      className="relative h-screen w-full overflow-hidden"
      style={{ background: '#0a0a0a' }}
      onWheel={handleWheel}
    >
      {/* Header */}
      <header className="absolute top-8 left-10 right-10 z-30 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-white text-sm font-medium tracking-wide">D+M LAB</span>
          <span className="text-neutral-600 text-xs">jukebox</span>
        </div>

        <div className="flex items-center gap-6">
          <span className="text-neutral-600 text-xs">{userName}</span>
          {onLogin && userName === '게스트' ? (
            <button
              onClick={onLogin}
              className="text-neutral-500 hover:text-white text-xs transition-colors"
            >
              sign in
            </button>
          ) : onLogout ? (
            <button
              onClick={onLogout}
              className="text-neutral-500 hover:text-white text-xs transition-colors"
            >
              sign out
            </button>
          ) : null}
          {onNewProject && (
            <button
              onClick={onNewProject}
              className="text-xs text-white px-4 py-2"
              style={{ border: '1px solid #333', background: 'transparent' }}
            >
              + new
            </button>
          )}
        </div>
      </header>

      {/* Main content */}
      <div className="absolute inset-0 flex items-center overflow-hidden">
        {/* Left: Vinyl stack - stays visible */}
        <div className="absolute left-0 h-full flex items-center">
          <div className="pl-10 w-[350px]">
            <div className="relative" style={{ height: 550 }}>
              {/* Stack frame */}
              <div
                className="absolute -left-3 -right-3 -top-3 -bottom-3"
                style={{
                  border: '1px solid #1a1a1a',
                  background: '#080808',
                }}
              />

              {/* Vinyl stack */}
              <div className="relative h-full flex flex-col justify-center">
                {projects.length === 0 ? (
                  <div className="text-center px-4">
                    <p className="text-neutral-600 text-sm mb-4">no records</p>
                    {onNewProject && (
                      <button
                        onClick={onNewProject}
                        className="text-xs text-white px-4 py-2"
                        style={{ border: '1px solid #333', background: 'transparent' }}
                      >
                        add first
                      </button>
                    )}
                  </div>
                ) : (
                  projects.map((project, index) => {
                    const offset = index - selectedIndex;
                    const isSelected = offset === 0;
                    const y = offset * 48;

                    if (Math.abs(offset) > 5) return null;

                    return (
                      <motion.div
                        key={project.id}
                        className="absolute left-0 right-0 cursor-pointer"
                        style={{ height: 44 }}
                        animate={{
                          y,
                          x: isSelected ? 40 : 0,
                          opacity: isSelected ? 1 : Math.max(0.15, 0.5 - Math.abs(offset) * 0.08),
                        }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        onClick={() => {
                          handleSelectAlbum(index);
                          if (isSelected) {
                            onOpenProject(project);
                          }
                        }}
                        onDoubleClick={() => {
                          if (!isSelected) return;
                          if (project.status === 'done') {
                            handleLoadToTurntable();
                          } else {
                            onOpenProject(project);
                          }
                        }}
                      >
                        <div
                          className="absolute inset-0 flex items-center"
                          style={{
                            background: isSelected ? '#141414' : '#0c0c0c',
                            borderTop: `1px solid ${isSelected ? '#2a2a2a' : '#1a1a1a'}`,
                            borderBottom: '1px solid #111',
                          }}
                        >
                          {/* Vinyl edge */}
                          <div
                            className="absolute left-3 w-9 h-9 rounded-full"
                            style={{
                              background: '#0a0a0a',
                              border: '1px solid #1a1a1a',
                            }}
                          >
                            <div
                              className="absolute inset-[28%] rounded-full"
                              style={{
                                background: project.mode === 'magic' ? '#4a4a7a' : '#e0e0e0',
                              }}
                            />
                          </div>

                          {/* Info */}
                          <div className="ml-16 flex-1 pr-4">
                            <div
                              className="text-[11px] font-medium truncate"
                              style={{ color: isSelected ? '#ddd' : '#444' }}
                            >
                              {project.title}
                            </div>
                            <div
                              className="text-[9px] uppercase tracking-wider"
                              style={{
                                color: isSelected
                                  ? project.mode === 'magic' ? '#7777bb' : '#666'
                                  : '#333',
                              }}
                            >
                              {project.mode} · {Math.round(project.duration)}s
                            </div>
                          </div>

                          {/* Index */}
                          <div
                            className="absolute right-4 text-[10px] font-mono"
                            style={{ color: isSelected ? '#555' : '#222' }}
                          >
                            {String(index + 1).padStart(2, '0')}
                          </div>

                          {/* Selection indicator - orange accent */}
                          {isSelected && (
                            <div
                              className="absolute left-0 top-0 bottom-0 w-[2px]"
                              style={{ background: '#d97706' }}
                            />
                          )}
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Navigation */}
            <div className="mt-8 flex items-center gap-4">
              <button
                onClick={() => setSelectedIndex((prev) => Math.max(0, prev - 1))}
                className="text-neutral-600 hover:text-white text-sm transition-colors"
              >
                ▲
              </button>
              <span className="text-neutral-600 text-xs font-mono">
                {projects.length > 0 ? `${selectedIndex + 1}/${projects.length}` : '—'}
              </span>
              <button
                onClick={() => setSelectedIndex((prev) => Math.min(projects.length - 1, prev + 1))}
                className="text-neutral-600 hover:text-white text-sm transition-colors"
              >
                ▼
              </button>
            </div>
          </div>
        </div>

        {/* Center: Selected album display - stays visible */}
        <div className="absolute left-[380px] flex items-center">
          <AnimatePresence mode="wait">
            {currentProject && (
              <motion.div
                key={currentProject.id}
                className="relative"
                style={{ width: 480, height: 480 }}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.25 }}
              >
                {/* Vinyl peeking - BEHIND album */}
                <motion.div
                  className="absolute"
                  style={{
                    width: 360,
                    height: 360,
                    top: 60,
                    left: 0,
                    zIndex: 0,
                  }}
                  initial={{ x: 0, rotate: 0 }}
                  animate={{ x: 180, rotate: 15 }}
                  transition={{ type: 'spring', stiffness: 120, damping: 18, delay: 0.1 }}
                >
                  <motion.div
                    className="w-full h-full rounded-full relative"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 8, ease: 'linear', repeat: Infinity }}
                    style={{
                      background: `
                        radial-gradient(circle,
                          #080808 0%, #080808 16%,
                          #0f0f0f 17%, #0a0a0a 20%,
                          #111 21%, #0c0c0c 25%,
                          #0f0f0f 26%, #0a0a0a 30%,
                          #111 31%, #0c0c0c 35%,
                          #0f0f0f 36%, #0a0a0a 40%,
                          #111 41%, #0c0c0c 45%,
                          #0f0f0f 46%, #0a0a0a 50%,
                          #111 51%, #0c0c0c 55%,
                          #0f0f0f 56%, #0a0a0a 60%,
                          #111 61%, #080808 100%
                        )
                      `,
                      boxShadow: '4px 4px 25px rgba(0,0,0,0.6)',
                    }}
                  >
                    {/* Irregular highlight 1 - arc */}
                    <div
                      className="absolute inset-0 rounded-full"
                      style={{
                        background: `
                          conic-gradient(
                            from 30deg,
                            transparent 0deg,
                            rgba(255,255,255,0.03) 20deg,
                            rgba(255,255,255,0.06) 40deg,
                            transparent 80deg,
                            transparent 180deg,
                            rgba(255,255,255,0.02) 200deg,
                            rgba(255,255,255,0.04) 220deg,
                            transparent 260deg,
                            transparent 360deg
                          )
                        `,
                      }}
                    />
                    {/* Irregular highlight 2 - spots */}
                    <div
                      className="absolute rounded-full"
                      style={{
                        top: '15%',
                        left: '20%',
                        width: '25%',
                        height: '8%',
                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent)',
                        transform: 'rotate(-30deg)',
                        filter: 'blur(2px)',
                      }}
                    />
                    <div
                      className="absolute rounded-full"
                      style={{
                        bottom: '25%',
                        right: '15%',
                        width: '20%',
                        height: '6%',
                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent)',
                        transform: 'rotate(45deg)',
                        filter: 'blur(2px)',
                      }}
                    />

                    {/* Label */}
                    <div
                      className="absolute rounded-full"
                      style={{
                        top: '50%',
                        left: '50%',
                        width: '30%',
                        height: '30%',
                        transform: 'translate(-50%, -50%)',
                        background: currentProject.mode === 'magic' ? '#4a4a7a' : '#e8e8e8',
                        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)',
                      }}
                    >
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <div className="text-[7px] uppercase tracking-widest" style={{ color: currentProject.mode === 'magic' ? '#aaa' : '#666' }}>
                          D+M
                        </div>
                      </div>
                      <div
                        className="absolute rounded-full"
                        style={{
                          top: '50%',
                          left: '50%',
                          width: 10,
                          height: 10,
                          transform: 'translate(-50%, -50%)',
                          background: '#0a0a0a',
                        }}
                      />
                    </div>
                  </motion.div>
                </motion.div>

                {/* Album sleeve - IN FRONT */}
                <div
                  className="absolute"
                  style={{
                    width: 380,
                    height: 380,
                    left: 0,
                    top: 50,
                    zIndex: 1,
                    background: currentProject.thumbnailUrl
                      ? `url(${currentProject.thumbnailUrl})`
                      : '#f0f0f0',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    boxShadow: '6px 8px 30px rgba(0,0,0,0.6)',
                  }}
                  onClick={() => onOpenProject(currentProject)}
                >
                  {/* Overlay for text readability when thumbnail exists */}
                  {currentProject.thumbnailUrl && (
                    <div
                      className="absolute inset-0"
                      style={{
                        background: 'linear-gradient(180deg, rgba(0,0,0,0.3) 0%, transparent 40%, transparent 60%, rgba(0,0,0,0.6) 100%)',
                      }}
                    />
                  )}

                  {/* Project info - always show */}
                  <div className="absolute top-6 left-6 right-6">
                    <div
                      className="text-[10px] uppercase tracking-[0.2em] mb-1"
                      style={{ color: currentProject.thumbnailUrl ? 'rgba(255,255,255,0.7)' : '#888' }}
                    >
                      {currentProject.mode} mode
                    </div>
                    <div
                      className="text-lg font-medium leading-tight"
                      style={{ color: currentProject.thumbnailUrl ? '#fff' : '#222' }}
                    >
                      {currentProject.title}
                    </div>
                  </div>

                  {/* Bottom info */}
                  <div className="absolute bottom-6 left-6 right-6">
                    <div
                      className="text-[10px] tracking-wide mb-2"
                      style={{ color: currentProject.thumbnailUrl ? 'rgba(255,255,255,0.5)' : '#999' }}
                    >
                      {Math.round(currentProject.duration)}s · {currentProject.status}
                    </div>
                    <div
                      className="text-[9px] uppercase tracking-widest"
                      style={{ color: currentProject.thumbnailUrl ? 'rgba(255,255,255,0.3)' : '#bbb' }}
                    >
                      D+M LAB
                    </div>
                  </div>

                  {/* Index number */}
                  <div
                    className="absolute top-6 right-6 text-[11px] font-mono"
                    style={{ color: currentProject.thumbnailUrl ? 'rgba(255,255,255,0.4)' : '#aaa' }}
                  >
                    {String(selectedIndex + 1).padStart(2, '0')}
                  </div>
                </div>

                {/* Play button */}
                <div className="absolute -bottom-2 left-0 flex items-center gap-3" style={{ zIndex: 2 }}>
                  <button
                    onClick={() => onOpenProject(currentProject)}
                    className="text-xs px-4 py-2 transition-colors"
                    style={{
                      border: '1px solid #333',
                      color: '#ddd',
                      background: 'transparent',
                    }}
                  >
                    open
                  </button>
                  {currentProject.status === 'done' && !isPlaying && (
                    <button
                      onClick={handleLoadToTurntable}
                      className="text-xs px-4 py-2 transition-colors"
                      style={{
                        border: '1px solid #d97706',
                        color: '#d97706',
                        background: 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#d97706';
                        e.currentTarget.style.color = '#0a0a0a';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = '#d97706';
                      }}
                    >
                      play →
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right: Turntable - slides in when playing */}
        <motion.div
          className="absolute right-0 h-full flex items-center"
          style={{ perspective: '1200px' }}
          animate={{
            x: isPlaying ? 0 : 450,
          }}
          transition={{ type: 'spring', stiffness: 180, damping: 28 }}
        >
          <div
            className="relative mr-[-100px]"
            style={{
              width: 550,
              height: 600,
              transformStyle: 'preserve-3d',
              transform: 'rotateY(-15deg)',
            }}
          >
            {/* Turntable base with depth */}
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(145deg, #111 0%, #0a0a0a 100%)',
                border: '1px solid #1a1a1a',
                boxShadow: '-10px 0 40px rgba(0,0,0,0.5)',
              }}
            >
              {/* Side depth */}
              <div
                className="absolute top-0 bottom-0 -left-4 w-4"
                style={{
                  background: 'linear-gradient(90deg, #080808 0%, #0c0c0c 100%)',
                  transform: 'rotateY(90deg)',
                  transformOrigin: 'right',
                }}
              />

              {/* Inner frame */}
              <div
                className="absolute inset-5"
                style={{ border: '1px solid #151515' }}
              />

              {/* Decorative gear */}
              <div
                className="absolute"
                style={{
                  top: 25,
                  left: 25,
                  width: 50,
                  height: 50,
                  border: '2px solid #1a1a1a',
                  borderRadius: '50%',
                }}
              >
                <motion.div
                  className="absolute inset-1 rounded-full"
                  style={{
                    border: '1px solid #151515',
                    borderStyle: 'dashed',
                  }}
                  animate={{ rotate: isSpinning ? 360 : 0 }}
                  transition={{ duration: 4, ease: 'linear', repeat: isSpinning ? Infinity : 0 }}
                />
              </div>

              {/* Platter */}
              <div
                className="absolute rounded-full"
                style={{
                  top: 90,
                  left: 80,
                  width: 340,
                  height: 340,
                  background: 'radial-gradient(circle, #0c0c0c 0%, #080808 100%)',
                  border: '3px solid #151515',
                  boxShadow: 'inset 0 0 30px rgba(0,0,0,0.8)',
                }}
              >
                {/* Platter rings */}
                <div className="absolute inset-3 rounded-full" style={{ border: '1px solid #1a1a1a' }} />
                <div className="absolute inset-6 rounded-full" style={{ border: '1px solid #141414' }} />
                <div className="absolute inset-10 rounded-full" style={{ border: '1px solid #121212' }} />

                {/* Vinyl on platter */}
                <AnimatePresence>
                  {loadedProject && (
                    <motion.div
                      className="absolute inset-5 rounded-full"
                      initial={{ scale: 0.3, opacity: 0, y: -100 }}
                      animate={{ scale: 1, opacity: 1, y: 0, rotate: isSpinning ? 360 : 0 }}
                      exit={{ scale: 0.3, opacity: 0, y: -100 }}
                      transition={{
                        scale: { type: 'spring', stiffness: 200, damping: 20 },
                        y: { type: 'spring', stiffness: 200, damping: 20 },
                        rotate: { duration: 1.8, ease: 'linear', repeat: isSpinning ? Infinity : 0 },
                      }}
                      style={{
                        background: `
                          radial-gradient(circle,
                            #080808 0%, #080808 15%,
                            #111 16%, #0c0c0c 20%,
                            #111 25%, #0c0c0c 30%,
                            #111 35%, #0c0c0c 40%,
                            #111 45%, #0c0c0c 50%,
                            #111 55%, #080808 100%
                          )
                        `,
                      }}
                    >
                      {/* Vinyl shine */}
                      <div
                        className="absolute inset-0 rounded-full"
                        style={{
                          background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, transparent 40%)',
                        }}
                      />

                      {/* Center label */}
                      <div
                        className="absolute rounded-full flex items-center justify-center"
                        style={{
                          top: '50%',
                          left: '50%',
                          width: '28%',
                          height: '28%',
                          transform: 'translate(-50%, -50%)',
                          background: loadedProject.mode === 'magic' ? '#4a4a7a' : '#e8e8e8',
                        }}
                      >
                        <div className="text-center">
                          <div className="text-[6px] uppercase tracking-widest mb-0.5" style={{ color: loadedProject.mode === 'magic' ? '#aaa' : '#666' }}>
                            D+M LAB
                          </div>
                          <div className="text-[8px] font-medium truncate max-w-[60px]" style={{ color: loadedProject.mode === 'magic' ? '#ddd' : '#333' }}>
                            {loadedProject.title}
                          </div>
                        </div>
                        <div
                          className="absolute rounded-full"
                          style={{
                            top: '50%',
                            left: '50%',
                            width: 10,
                            height: 10,
                            transform: 'translate(-50%, -50%)',
                            background: '#0a0a0a',
                          }}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Spindle */}
                <div
                  className="absolute rounded-full z-10"
                  style={{
                    top: '50%',
                    left: '50%',
                    width: 18,
                    height: 18,
                    transform: 'translate(-50%, -50%)',
                    background: '#1a1a1a',
                    border: '1px solid #222',
                  }}
                />
              </div>

              {/* Tonearm mount */}
              <div
                className="absolute rounded-full"
                style={{
                  top: 70,
                  right: 50,
                  width: 30,
                  height: 30,
                  background: '#151515',
                  border: '2px solid #222',
                }}
              />

              {/* Tonearm */}
              <motion.div
                className="absolute"
                style={{
                  top: 80,
                  right: 60,
                  width: 130,
                  height: 4,
                  background: 'linear-gradient(180deg, #2a2a2a 0%, #1a1a1a 100%)',
                  transformOrigin: 'right center',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                }}
                animate={{ rotate: loadedProject && isSpinning ? -28 : -50 }}
                transition={{ type: 'spring', stiffness: 80, damping: 15 }}
              >
                <div
                  className="absolute"
                  style={{ left: -8, top: -6, width: 20, height: 16, background: '#2a2a2a' }}
                />
                <div
                  className="absolute"
                  style={{ left: -3, top: 12, width: 2, height: 8, background: '#d97706' }}
                />
              </motion.div>

              {/* Controls */}
              <div className="absolute bottom-8 left-8 right-8 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-2 h-2"
                    style={{ background: loadedProject ? '#d97706' : '#1a1a1a' }}
                  />
                  <span className="text-[9px] text-neutral-700">POWER</span>
                </div>
                <span className="text-[10px] text-neutral-600 tracking-wider">33 RPM</span>
              </div>
            </div>

          </div>
        </motion.div>

        {/* Controls - outside 3D transform */}
        <AnimatePresence>
          {loadedProject && (
            <motion.div
              className="absolute bottom-24 right-10 flex items-center gap-6 z-50"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ delay: 0.3 }}
            >
              <button
                onClick={handleBack}
                className="text-xs text-neutral-500 hover:text-white transition-colors"
              >
                ← back
              </button>
              <button
                onClick={handleEnterProject}
                className="text-xs px-5 py-2 transition-colors"
                style={{
                  border: '1px solid #d97706',
                  color: '#d97706',
                  background: 'transparent',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#d97706';
                  e.currentTarget.style.color = '#0a0a0a';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#d97706';
                }}
              >
                enter project →
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom hint */}
      <div className="absolute bottom-8 left-10 text-neutral-600 text-xs tracking-wide">
        {isPlaying ? 'esc to go back · enter to open' : '↑ ↓ select · enter to play'}
      </div>

      {/* Now playing indicator */}
      <AnimatePresence>
        {loadedProject && (
          <motion.div
            className="absolute top-8 left-1/2 -translate-x-1/2 flex items-center gap-3"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <div className="w-2 h-2 rounded-full" style={{ background: '#d97706' }} />
            <span className="text-neutral-400 text-xs">
              now playing: <span className="text-white">{loadedProject.title}</span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
