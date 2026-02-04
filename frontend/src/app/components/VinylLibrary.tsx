import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Project } from '../types';
import { VinylRecord } from './VinylRecord';
import { Calendar, Clock, Activity, Music, Play, Plus } from 'lucide-react';
import { Button } from './ui/button';

interface VinylLibraryProps {
  projects: Project[];
  onSelectProject: (project: Project) => void;
  onNewProject?: () => void;
}

export function VinylLibrary({ projects, onSelectProject, onNewProject }: VinylLibraryProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const hoveredProject = hoveredIndex !== null ? projects[hoveredIndex] : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 relative overflow-hidden">
      {/* Ambient background effect */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/10 via-transparent to-transparent" />
      
      {/* Header */}
      <div className="relative z-10 pt-12 pb-6 px-12">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Record Collection</h1>
            <p className="text-zinc-400">Browse your motion sync projects</p>
          </div>
          {onNewProject && (
            <Button
              onClick={onNewProject}
              className="gap-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 px-6 h-11"
            >
              <Plus className="size-4" />
              Add New
            </Button>
          )}
        </div>
      </div>

      <div className="relative h-[calc(100vh-180px)] flex items-center">
        {/* Vinyl shelf */}
        <div className="flex-1 flex items-end justify-center px-12 pb-20">
          {/* Wooden shelf */}
          <div className="relative">
            {/* Records row */}
            <div className="flex items-end justify-center gap-6 mb-4">
              {projects.map((project, index) => (
                <VinylRecord
                  key={project.id}
                  project={project}
                  index={index}
                  isHovered={hoveredIndex === index}
                  onHover={(hover) => setHoveredIndex(hover ? index : null)}
                  onClick={() => project.status === 'done' && onSelectProject(project)}
                />
              ))}
            </div>

            {/* Shelf surface */}
            <div className="relative w-full h-8 bg-gradient-to-b from-amber-900/40 to-amber-950/60 rounded-lg shadow-2xl border-t-2 border-amber-800/30">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-700/10 to-transparent" />
              {/* Wood grain texture */}
              <div className="absolute inset-0 opacity-20"
                   style={{
                     backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(139, 69, 19, 0.1) 2px, rgba(139, 69, 19, 0.1) 4px)',
                   }}
              />
            </div>

            {/* Shelf shadow */}
            <div className="absolute -bottom-4 left-0 right-0 h-8 bg-gradient-to-b from-black/40 to-transparent blur-xl" />
          </div>
        </div>

        {/* Project details panel */}
        <AnimatePresence>
          {hoveredProject && (
            <motion.div
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 100 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="absolute right-0 top-0 bottom-0 w-[420px] bg-gradient-to-l from-zinc-900/95 via-zinc-900/90 to-transparent backdrop-blur-2xl border-l border-white/10"
            >
              <div className="h-full flex flex-col justify-center px-10 py-12">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="space-y-6"
                >
                  {/* Status badge */}
                  <div className="flex items-center gap-2">
                    <div className={`size-2 rounded-full ${
                      hoveredProject.status === 'done' 
                        ? 'bg-green-500 animate-pulse' 
                        : 'bg-yellow-500 animate-pulse'
                    }`} />
                    <span className={`text-xs font-semibold uppercase tracking-wider ${
                      hoveredProject.status === 'done' 
                        ? 'text-green-500' 
                        : 'text-yellow-500'
                    }`}>
                      {hoveredProject.status === 'done' ? 'Ready' : 'Processing'}
                    </span>
                  </div>

                  {/* Title */}
                  <div>
                    <h2 className="text-3xl font-bold text-white mb-2 leading-tight">
                      {hoveredProject.title}
                    </h2>
                    <p className="text-zinc-400 capitalize">
                      {hoveredProject.mode} Collection • {formatDate(hoveredProject.createdAt)}
                    </p>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                      <div className="flex items-center gap-2 text-zinc-500 text-xs mb-1">
                        <Clock className="size-3.5" />
                        <span>Duration</span>
                      </div>
                      <div className="text-white text-xl font-semibold">
                        {formatDuration(hoveredProject.duration)}
                      </div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                      <div className="flex items-center gap-2 text-zinc-500 text-xs mb-1">
                        <Music className="size-3.5" />
                        <span>Music</span>
                      </div>
                      <div className="text-white text-xl font-semibold">
                        {hoveredProject.musicKeypoints.length}
                      </div>
                    </div>
                  </div>

                  {/* Track info */}
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                      Contents
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between text-zinc-400 hover:text-white transition-colors py-1">
                        <div className="flex items-center gap-3">
                          <span className="text-zinc-600 font-mono text-xs">01</span>
                          <span>Low Frequency</span>
                        </div>
                        <span className="text-xs text-zinc-600">
                          {hoveredProject.musicKeypoints.filter(k => k.frequency === 'low').length}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-zinc-400 hover:text-white transition-colors py-1">
                        <div className="flex items-center gap-3">
                          <span className="text-zinc-600 font-mono text-xs">02</span>
                          <span>Mid Frequency</span>
                        </div>
                        <span className="text-xs text-zinc-600">
                          {hoveredProject.musicKeypoints.filter(k => k.frequency === 'mid').length}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-zinc-400 hover:text-white transition-colors py-1">
                        <div className="flex items-center gap-3">
                          <span className="text-zinc-600 font-mono text-xs">03</span>
                          <span>High Frequency</span>
                        </div>
                        <span className="text-xs text-zinc-600">
                          {hoveredProject.musicKeypoints.filter(k => k.frequency === 'high').length}
                        </span>
                      </div>
                      <div className="h-px bg-white/5 my-2" />
                      <div className="flex items-center justify-between text-zinc-400 hover:text-white transition-colors py-1">
                        <div className="flex items-center gap-3">
                          <Activity className="size-3.5 text-zinc-600" />
                          <span>Motion Points</span>
                        </div>
                        <span className="text-xs text-zinc-600">
                          {hoveredProject.motionKeypoints.length}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Play button */}
                  {hoveredProject.status === 'done' && (
                    <Button
                      onClick={() => onSelectProject(hoveredProject)}
                      className="w-full gap-3 bg-white text-black hover:bg-white/90 h-12 text-base font-semibold"
                    >
                      <Play className="size-5 fill-current" />
                      Open Project
                    </Button>
                  )}

                  {/* Catalog number */}
                  <div className="pt-4 border-t border-white/5">
                    <div className="flex items-center justify-between text-xs text-zinc-600">
                      <span>MOTION SYNC RECORDS</span>
                      <span className="font-mono">MSR-{hoveredProject.id.padStart(4, '0')}</span>
                    </div>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Instructions */}
        {hoveredIndex === null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 text-center"
          >
            <p className="text-zinc-500 text-sm mb-1">
              Hover over a record to see details
            </p>
            <p className="text-zinc-700 text-xs">
              Click to open the timeline editor
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
