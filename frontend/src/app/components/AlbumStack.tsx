import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Project } from '../types';
import { useCarouselPhysics } from './useCarouselPhysics';
import { AlbumCard } from './AlbumCard';
import { Button } from './ui/button';

interface AlbumStackProps {
  projects: Project[];
  onSelectProject: (project: Project) => void;
  onNewProject?: () => void;
  userName?: string;
  onLogin?: () => void;
  onLogout?: () => void;
  loading?: boolean;
}

export function AlbumStack({
  projects,
  onSelectProject,
  onNewProject,
  userName = '게스트',
  onLogin,
  onLogout,
  loading = false,
}: AlbumStackProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const spacing = 260;
  const { offset, bind } = useCarouselPhysics({ itemCount: projects.length, spacing });

  const focusIndex = Math.round(offset);
  const hoveredProject = hoveredIndex !== null ? projects[hoveredIndex] : projects[focusIndex];

  const positions = useMemo(() => {
    return projects.map((_, index) => index - offset);
  }, [projects, offset]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1c202a_0%,#0d0f14_55%,#0a0b10_100%)] text-white relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(255,255,255,0.12),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_80%,rgba(255,255,255,0.08),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,rgba(0,0,0,0.2),rgba(0,0,0,0.8))]" />
      <div className="pointer-events-none absolute inset-0 mix-blend-soft-light opacity-30 [background-image:radial-gradient(rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:3px_3px]" />
      <div className="pointer-events-none absolute left-0 right-0 bottom-24 h-28 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(0,0,0,0.5))]" />
      <div className="pointer-events-none absolute left-1/2 bottom-32 h-16 w-[88%] -translate-x-1/2 rounded-2xl bg-[linear-gradient(90deg,#3a281b,#2b1f16)] opacity-70 shadow-[0_20px_40px_rgba(0,0,0,0.45)]" />
      <div className="pointer-events-none absolute left-1/2 bottom-20 h-3 w-[86%] -translate-x-1/2 rounded-full bg-[#1a1310] opacity-80" />

      <header className="absolute top-0 left-0 right-0 z-10 pt-8 pb-6 px-12">
        <div className="w-full flex items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">Dance + Magic Analysis Lab</h1>
            <p className="text-zinc-400 mt-2">Experimental motion archive · interactive vinyl collection</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-400">{userName}</span>
            {onLogin && userName === '게스트' ? (
              <Button onClick={onLogin} className="bg-white/10 hover:bg-white/20 px-5 h-10">
                Sign In
              </Button>
            ) : onLogout ? (
              <Button onClick={onLogout} className="bg-white/10 hover:bg-white/20 px-5 h-10">
                Sign Out
              </Button>
            ) : null}
            {onNewProject && (
              <Button onClick={onNewProject} className="px-6 h-11 bg-cyan-400 text-black hover:bg-cyan-300">
                New Project
              </Button>
            )}
          </div>
        </div>
      </header>

      <div
        className="relative h-screen flex items-center justify-center"
        style={{ perspective: '1800px' }}
        {...bind}
      >
        <div className="relative w-full h-[640px] translate-y-10">
          <div className="absolute left-[8%] top-1/2 -translate-y-1/2 h-[420px] w-[220px] rounded-[120px] bg-gradient-to-b from-zinc-900 via-zinc-800 to-zinc-950 shadow-[0_40px_80px_rgba(0,0,0,0.6)] border border-white/5" />
          <div className="absolute left-[10%] top-1/2 -translate-y-1/2 h-[360px] w-[160px] rounded-[100px] bg-gradient-to-b from-zinc-800 via-zinc-900 to-black opacity-80" />
          <div className="absolute left-[12%] top-1/2 -translate-y-1/2 h-[300px] w-[110px] rounded-[80px] bg-gradient-to-b from-zinc-950 via-zinc-900 to-black opacity-90" />

          {projects.map((project, index) => {
            const pos = positions[index];
            const distance = Math.min(Math.abs(pos), 4);
            const isFocused = Math.abs(pos) < 0.15;
            const translateX = pos * 140;
            const translateY = pos * -12;
            const translateZ = -distance * 140;
            const rotateY = pos * -14;
            const rotateZ = pos * 3;

            return (
              <motion.div
                key={project.id}
                className="absolute top-1/2 left-[18%]"
                style={{ transformStyle: 'preserve-3d' }}
                animate={{
                  x: translateX,
                  y: translateY,
                  z: translateZ,
                  rotateY,
                  rotateZ,
                }}
                transition={{ type: 'spring', stiffness: 140, damping: 20 }}
                onClick={() => {
                  if (!isFocused || project.status !== 'done') return;
                  setOpeningId(project.id);
                  setTimeout(() => onSelectProject(project), 500);
                }}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <AlbumCard
                  title={project.title}
                  type={project.mode}
                  year={project.createdAt.getFullYear()}
                  depth={distance}
                  focused={isFocused}
                  opening={openingId === project.id}
                />
              </motion.div>
            );
          })}
        </div>
      </div>

      {hoveredProject && (
        <motion.div
          initial={{ opacity: 0, x: 140 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 140 }}
          transition={{ type: 'spring', stiffness: 140, damping: 20 }}
          className="absolute right-6 top-10 bottom-10 w-[360px] rounded-3xl bg-white/5 backdrop-blur-2xl border border-white/10 shadow-[0_30px_80px_rgba(0,0,0,0.65)]"
        >
          <div className="h-full flex flex-col justify-between px-8 py-10 space-y-6">
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-400">
              {hoveredProject.mode} collection
            </div>
            <div>
              <h2 className="text-3xl font-semibold">{hoveredProject.title}</h2>
              <p className="text-zinc-400 mt-2">
                {hoveredProject.createdAt.toLocaleDateString()}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <div className="text-zinc-500">Duration</div>
                <div className="text-white text-xl font-semibold">
                  {Math.round(hoveredProject.duration)}s
                </div>
              </div>
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <div className="text-zinc-500">Status</div>
                <div className="inline-flex items-center gap-2 px-3 py-1 mt-2 rounded-full text-xs uppercase tracking-wider bg-white/10">
                  {hoveredProject.status}
                </div>
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Preview</div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[0, 1, 2].map(i => (
                  <div key={i} className="h-16 rounded-lg bg-white/10 border border-white/10" />
                ))}
              </div>
            </div>
            {hoveredProject.status === 'done' && (
              <Button
                onClick={() => onSelectProject(hoveredProject)}
                className="bg-white text-black hover:bg-white/90 h-12"
              >
                Open Project
              </Button>
            )}
          </div>
        </motion.div>
      )}

      {loading && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
          <div className="bg-zinc-900/80 border border-white/10 px-6 py-3 rounded-full text-sm">
            Loading project...
          </div>
        </div>
      )}
    </div>
  );
}
