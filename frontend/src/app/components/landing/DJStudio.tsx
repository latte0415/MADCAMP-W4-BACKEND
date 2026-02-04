import { useState, useEffect, useMemo } from 'react';
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

// Dust particles in spotlight
function SpotlightDust({ isActive }: { isActive: boolean }) {
  const particles = useMemo(() => {
    return Array.from({ length: 30 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 1,
      duration: Math.random() * 3 + 2,
      delay: Math.random() * 2,
    }));
  }, []);

  if (!isActive) return null;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-amber-100/60"
          style={{
            width: p.size,
            height: p.size,
            left: `${p.x}%`,
          }}
          animate={{
            y: ['0%', '100%'],
            opacity: [0, 1, 1, 0],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      ))}
    </div>
  );
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
  const [isPlaying, setIsPlaying] = useState(false);

  const visibleRange = 3;
  const currentProject = projects[selectedIndex];

  const handleSelectAlbum = (index: number) => {
    setSelectedIndex(index);
  };

  const handlePlayRecord = () => {
    if (!currentProject || currentProject.status !== 'done') return;
    setLoadedProject(currentProject);
    setIsPlaying(true);
  };

  const handleEnterProject = () => {
    if (loadedProject) {
      onOpenProject(loadedProject);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(projects.length - 1, prev + 1));
      } else if (e.key === 'Enter' && currentProject) {
        e.preventDefault();
        handlePlayRecord();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndex, projects.length, currentProject]);

  const handleWheel = (e: React.WheelEvent) => {
    const delta = e.deltaY > 0 ? 1 : -1;
    setSelectedIndex((prev) => Math.max(0, Math.min(projects.length - 1, prev + delta)));
  };

  // Truss lights configuration
  const trussLights = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => ({
      id: i,
      x: 10 + i * 11.5,
      isSpot: i === 3 || i === 4,
    }));
  }, []);

  return (
    <section
      className="relative h-screen w-full overflow-hidden"
      style={{ background: '#0a0908' }}
      onWheel={handleWheel}
    >
      {/* Stage background - dark gradient */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at 50% 0%, #1a1614 0%, #0a0908 50%, #050404 100%)',
        }}
      />

      {/* Velvet curtains - left */}
      <div
        className="absolute left-0 top-0 bottom-0 w-32 pointer-events-none"
        style={{
          background: `
            linear-gradient(90deg,
              #1a0a0a 0%,
              #2a1010 20%,
              #1a0a0a 40%,
              #2a1010 60%,
              #1a0808 80%,
              transparent 100%
            )
          `,
          boxShadow: 'inset -20px 0 40px rgba(0,0,0,0.8)',
        }}
      />

      {/* Velvet curtains - right */}
      <div
        className="absolute right-0 top-0 bottom-0 w-32 pointer-events-none"
        style={{
          background: `
            linear-gradient(-90deg,
              #1a0a0a 0%,
              #2a1010 20%,
              #1a0a0a 40%,
              #2a1010 60%,
              #1a0808 80%,
              transparent 100%
            )
          `,
          boxShadow: 'inset 20px 0 40px rgba(0,0,0,0.8)',
        }}
      />

      {/* Truss structure at top */}
      <div className="absolute top-0 left-0 right-0 h-20 pointer-events-none">
        {/* Main horizontal truss bar */}
        <div
          className="absolute top-8 left-20 right-20 h-3"
          style={{
            background: 'linear-gradient(180deg, #3a3632 0%, #1a1816 50%, #0a0908 100%)',
            boxShadow: '0 4px 8px rgba(0,0,0,0.6)',
          }}
        />
        {/* Truss cross pattern */}
        <div
          className="absolute top-4 left-20 right-20 h-8"
          style={{
            backgroundImage: `
              repeating-linear-gradient(
                60deg,
                transparent 0px,
                transparent 20px,
                rgba(40,36,32,0.3) 20px,
                rgba(40,36,32,0.3) 22px
              ),
              repeating-linear-gradient(
                -60deg,
                transparent 0px,
                transparent 20px,
                rgba(40,36,32,0.3) 20px,
                rgba(40,36,32,0.3) 22px
              )
            `,
          }}
        />

        {/* Stage lights on truss */}
        {trussLights.map((light) => (
          <div
            key={light.id}
            className="absolute"
            style={{
              left: `${light.x}%`,
              top: 14,
            }}
          >
            {/* Light housing */}
            <div
              className="w-6 h-8 rounded-b-lg"
              style={{
                background: 'linear-gradient(180deg, #2a2826 0%, #1a1816 100%)',
                boxShadow: '0 2px 4px rgba(0,0,0,0.5)',
              }}
            />
            {/* Light glow (inactive) */}
            <div
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-2 rounded-b"
              style={{
                background: light.isSpot ? 'rgba(255,200,150,0.3)' : 'rgba(255,200,150,0.1)',
              }}
            />
          </div>
        ))}
      </div>

      {/* Main spotlight beam - follows selected album */}
      <motion.div
        className="absolute pointer-events-none"
        style={{
          top: 0,
          width: 350,
          height: '85%',
        }}
        animate={{
          left: `calc(35% + ${(selectedIndex - Math.floor(projects.length / 2)) * 30}px)`,
        }}
        transition={{ type: 'spring', stiffness: 100, damping: 20 }}
      >
        {/* Spotlight cone */}
        <div
          className="absolute inset-0"
          style={{
            background: `
              linear-gradient(
                180deg,
                rgba(255,220,180,0.15) 0%,
                rgba(255,200,150,0.08) 30%,
                rgba(255,180,120,0.03) 70%,
                transparent 100%
              )
            `,
            clipPath: 'polygon(40% 0%, 60% 0%, 85% 100%, 15% 100%)',
          }}
        />
        {/* Spotlight dust particles */}
        <div
          className="absolute"
          style={{
            top: '10%',
            left: '30%',
            right: '30%',
            bottom: '20%',
          }}
        >
          <SpotlightDust isActive={projects.length > 0} />
        </div>
      </motion.div>

      {/* Haze/fog effect at bottom */}
      <div
        className="absolute bottom-0 left-0 right-0 h-40 pointer-events-none"
        style={{
          background: 'linear-gradient(to top, rgba(255,250,240,0.03) 0%, transparent 100%)',
        }}
      />

      {/* Stage floor - reflective black */}
      <div
        className="absolute bottom-0 left-0 right-0 h-1/3 pointer-events-none"
        style={{
          background: `
            linear-gradient(
              to top,
              rgba(10,9,8,1) 0%,
              rgba(15,14,12,0.95) 30%,
              rgba(20,18,16,0.5) 60%,
              transparent 100%
            )
          `,
        }}
      >
        {/* Floor reflection line */}
        <div
          className="absolute top-0 left-1/4 right-1/4 h-px"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(255,200,150,0.1), transparent)',
          }}
        />
      </div>

      {/* Header */}
      <header className="absolute top-24 left-12 right-12 z-30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
            style={{
              background: 'radial-gradient(circle at 30% 30%, #fbbf24 0%, #d97706 100%)',
              color: '#0a0806',
              boxShadow: '0 0 20px rgba(251,191,36,0.4), 0 4px 8px rgba(0,0,0,0.4)',
            }}
          >
            ♫
          </div>
          <span className="text-amber-100/60 font-medium tracking-wide text-sm">
            Dance + Magic Lab
          </span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-amber-200/20 text-xs">{userName}</span>
          {onLogin && userName === '게스트' ? (
            <button
              onClick={onLogin}
              className="text-amber-200/30 hover:text-amber-100 text-xs transition-colors"
            >
              Sign In
            </button>
          ) : onLogout ? (
            <button
              onClick={onLogout}
              className="text-amber-200/30 hover:text-amber-100 text-xs transition-colors"
            >
              Sign Out
            </button>
          ) : null}
          {onNewProject && (
            <button
              onClick={onNewProject}
              className="px-3 py-1.5 text-xs font-medium rounded"
              style={{
                background: 'linear-gradient(180deg, #d97706 0%, #b45309 100%)',
                color: '#0a0806',
                boxShadow: '0 2px 8px rgba(217,119,6,0.3), 0 1px 2px rgba(0,0,0,0.3)',
              }}
            >
              + New Project
            </button>
          )}
        </div>
      </header>

      {/* Main stage area */}
      <div className="absolute inset-0 pt-32 pb-8 flex flex-col">
        {/* Albums on stage */}
        <div className="flex-1 relative flex items-end justify-center pb-32">
          {projects.length === 0 ? (
            <div className="text-center mb-20">
              <div className="text-6xl mb-4 opacity-20">🎭</div>
              <p className="text-amber-200/20 mb-6 text-sm">The stage is empty</p>
              {onNewProject && (
                <button
                  onClick={onNewProject}
                  className="px-6 py-3 rounded text-sm font-medium"
                  style={{
                    background: 'linear-gradient(180deg, #d97706 0%, #b45309 100%)',
                    color: '#0a0806',
                    boxShadow: '0 4px 20px rgba(217,119,6,0.3)',
                  }}
                >
                  Create First Project
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Album lineup */}
              <div className="relative h-[400px] flex items-end justify-center">
                {projects.map((project, index) => {
                  const offset = index - selectedIndex;
                  if (Math.abs(offset) > visibleRange) return null;

                  const isSelected = offset === 0;
                  const xOffset = offset * 180;
                  const zIndex = 10 - Math.abs(offset);
                  const scale = isSelected ? 1 : 0.75 - Math.abs(offset) * 0.08;
                  const brightness = isSelected ? 1 : 0.2 - Math.abs(offset) * 0.05;

                  const albumSize = 280;

                  return (
                    <motion.div
                      key={project.id}
                      className="absolute cursor-pointer"
                      style={{
                        width: albumSize,
                        height: albumSize + 40,
                        zIndex,
                        bottom: 0,
                      }}
                      animate={{
                        x: xOffset,
                        scale,
                        filter: `brightness(${brightness})`,
                      }}
                      transition={{ type: 'spring', stiffness: 200, damping: 25 }}
                      onClick={() => (isSelected ? handlePlayRecord() : handleSelectAlbum(index))}
                    >
                      {/* Album standing upright */}
                      <div
                        className="absolute bottom-10 left-0 right-0"
                        style={{
                          height: albumSize,
                          perspective: '800px',
                        }}
                      >
                        {/* Album cover */}
                        <motion.div
                          className="absolute inset-0"
                          style={{
                            background: project.thumbnailUrl
                              ? `url(${project.thumbnailUrl})`
                              : project.mode === 'magic'
                                ? 'linear-gradient(135deg, #1a1520 0%, #2d1f3d 100%)'
                                : 'linear-gradient(135deg, #1a1510 0%, #2d2510 100%)',
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            boxShadow: isSelected
                              ? '0 20px 60px rgba(0,0,0,0.8), 0 0 100px rgba(255,200,150,0.1)'
                              : '0 10px 30px rgba(0,0,0,0.6)',
                            transformStyle: 'preserve-3d',
                          }}
                          animate={{
                            rotateY: isSelected ? 0 : offset > 0 ? -15 : 15,
                          }}
                          transition={{ type: 'spring', stiffness: 150, damping: 20 }}
                        >
                          {/* Spotlight hit on selected */}
                          {isSelected && (
                            <div
                              className="absolute inset-0"
                              style={{
                                background:
                                  'linear-gradient(180deg, rgba(255,220,180,0.15) 0%, transparent 50%)',
                              }}
                            />
                          )}

                          {/* Album art pattern */}
                          {!project.thumbnailUrl && (
                            <div
                              className="absolute inset-6"
                              style={{
                                background:
                                  project.mode === 'magic'
                                    ? 'radial-gradient(circle at 30% 30%, rgba(139,92,246,0.4) 0%, transparent 60%)'
                                    : 'radial-gradient(circle at 30% 30%, rgba(251,191,36,0.4) 0%, transparent 60%)',
                              }}
                            />
                          )}

                          {/* Project info */}
                          <div className="absolute bottom-4 left-4 right-4">
                            <div
                              className="text-[9px] uppercase tracking-[0.2em] mb-1 font-semibold"
                              style={{
                                color: project.mode === 'magic' ? '#a78bfa' : '#fbbf24',
                                textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                              }}
                            >
                              {project.mode}
                            </div>
                            <div
                              className="text-white text-base font-bold truncate"
                              style={{ textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}
                            >
                              {project.title}
                            </div>
                          </div>

                          {/* Edge shadow */}
                          <div
                            className="absolute inset-0"
                            style={{
                              boxShadow:
                                'inset 3px 0 8px rgba(255,255,255,0.05), inset -3px 0 8px rgba(0,0,0,0.3)',
                            }}
                          />
                        </motion.div>

                        {/* LP peeking out - only selected */}
                        <AnimatePresence>
                          {isSelected && (
                            <motion.div
                              className="absolute"
                              style={{
                                width: albumSize * 0.85,
                                height: albumSize * 0.85,
                                top: '50%',
                                right: -albumSize * 0.35,
                              }}
                              initial={{ x: -50, y: '-50%', opacity: 0 }}
                              animate={{ x: 0, y: '-50%', opacity: 1 }}
                              exit={{ x: -50, opacity: 0 }}
                              transition={{ type: 'spring', stiffness: 120, damping: 18 }}
                            >
                              <div
                                className="w-full h-full rounded-full"
                                style={{
                                  background: `
                                    radial-gradient(circle, #030303 12%, transparent 12.5%),
                                    radial-gradient(circle, ${project.mode === 'magic' ? '#8b5cf6' : '#d97706'} 12.5%, ${project.mode === 'magic' ? '#8b5cf6' : '#d97706'} 16%, transparent 16.5%),
                                    radial-gradient(circle, #080808 16.5%, #080808 18%, transparent 18%),
                                    conic-gradient(from 0deg, #0a0a0a, #151515, #0a0a0a, #151515, #0a0a0a, #151515, #0a0a0a),
                                    #080808
                                  `,
                                  boxShadow: '0 10px 40px rgba(0,0,0,0.7)',
                                }}
                              >
                                {/* Vinyl shine from spotlight */}
                                <div
                                  className="absolute inset-0 rounded-full"
                                  style={{
                                    background:
                                      'linear-gradient(160deg, rgba(255,220,180,0.12) 0%, transparent 40%)',
                                  }}
                                />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Floor reflection */}
                      {isSelected && (
                        <div
                          className="absolute bottom-0 left-0 right-0 h-10"
                          style={{
                            background: `linear-gradient(to top,
                              rgba(${project.mode === 'magic' ? '139,92,246' : '251,191,36'},0.1) 0%,
                              transparent 100%)`,
                            filter: 'blur(8px)',
                          }}
                        />
                      )}
                    </motion.div>
                  );
                })}
              </div>

              {/* Project info panel */}
              <AnimatePresence mode="wait">
                {currentProject && (
                  <motion.div
                    key={currentProject.id}
                    className="absolute bottom-8 left-1/2 -translate-x-1/2 text-center"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="text-amber-200/30 text-xs tracking-widest mb-2">
                      {selectedIndex + 1} / {projects.length}
                    </div>
                    <h2 className="text-2xl font-bold text-amber-50 mb-1">{currentProject.title}</h2>
                    <div className="text-amber-200/40 text-sm mb-4">
                      {currentProject.mode} · {Math.round(currentProject.duration)}s ·{' '}
                      {currentProject.status}
                    </div>

                    {currentProject.status === 'done' && (
                      <motion.button
                        onClick={handlePlayRecord}
                        className="px-6 py-2 rounded text-sm font-medium"
                        style={{
                          background: 'linear-gradient(180deg, #d97706 0%, #b45309 100%)',
                          color: '#0a0806',
                          boxShadow: '0 4px 20px rgba(217,119,6,0.3), 0 0 40px rgba(217,119,6,0.1)',
                        }}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        Load to Turntable
                      </motion.button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </div>

        {/* Turntable at bottom right */}
        <AnimatePresence>
          {loadedProject && (
            <motion.div
              className="absolute bottom-8 right-12 z-40"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 50 }}
            >
              <div
                className="relative"
                style={{
                  width: 200,
                  height: 200,
                }}
              >
                {/* Turntable base */}
                <div
                  className="absolute inset-0 rounded-lg"
                  style={{
                    background: 'linear-gradient(145deg, #1a1816 0%, #0f0e0c 100%)',
                    boxShadow: '0 10px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.03)',
                  }}
                >
                  {/* Platter */}
                  <div
                    className="absolute rounded-full"
                    style={{
                      top: 20,
                      left: 20,
                      right: 20,
                      bottom: 20,
                      background: '#080706',
                      boxShadow: 'inset 0 0 20px rgba(0,0,0,0.8)',
                    }}
                  />

                  {/* Vinyl */}
                  <motion.div
                    className="absolute rounded-full"
                    style={{
                      top: 25,
                      left: 25,
                      right: 25,
                      bottom: 25,
                      background: `
                        radial-gradient(circle, #030303 15%, transparent 15.5%),
                        radial-gradient(circle, ${loadedProject.mode === 'magic' ? '#8b5cf6' : '#d97706'} 15.5%, ${loadedProject.mode === 'magic' ? '#8b5cf6' : '#d97706'} 20%, transparent 20.5%),
                        conic-gradient(from 0deg, #0c0c0c, #181818, #0c0c0c, #181818, #0c0c0c),
                        #0a0a0a
                      `,
                    }}
                    animate={{ rotate: isPlaying ? 360 : 0 }}
                    transition={{ duration: 1.5, ease: 'linear', repeat: isPlaying ? Infinity : 0 }}
                  />

                  {/* Tonearm */}
                  <motion.div
                    className="absolute"
                    style={{
                      top: 15,
                      right: 15,
                      width: 50,
                      height: 3,
                      background: 'linear-gradient(180deg, #353330 0%, #1a1816 100%)',
                      transformOrigin: 'right center',
                      borderRadius: 2,
                    }}
                    animate={{ rotate: isPlaying ? -25 : -45 }}
                  />
                </div>

                {/* Enter button */}
                <motion.button
                  className="absolute -bottom-12 left-0 right-0 py-2 rounded text-xs font-medium"
                  style={{
                    background: 'linear-gradient(180deg, #d97706 0%, #b45309 100%)',
                    color: '#0a0806',
                    boxShadow: '0 4px 15px rgba(217,119,6,0.3)',
                  }}
                  onClick={handleEnterProject}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Enter Project →
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Controls hint */}
      <div className="absolute bottom-4 left-12 text-amber-200/15 text-xs tracking-wide">
        ← → browse · enter to load
      </div>
    </section>
  );
}
