import { useState, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Environment } from '@react-three/drei';
import { motion, AnimatePresence } from 'motion/react';
import * as THREE from 'three';
import { Project } from '../types';
import { VinylRecord3D } from './VinylRecord3D';
import { Calendar, Clock, Activity, Music, Play, Plus } from 'lucide-react';
import { Button } from './ui/button';

interface VinylLibrary3DProps {
  projects: Project[];
  onSelectProject: (project: Project) => void;
  onNewProject?: () => void;
  userName?: string;
  onLogin?: () => void;
  onLogout?: () => void;
  loading?: boolean;
}

function Shelf() {
  return (
    <group position={[0, -1, 0]}>
      {/* Main shelf surface */}
      <mesh position={[0, 0, 0]} receiveShadow>
        <boxGeometry args={[8, 0.1, 1.5]} />
        <meshStandardMaterial
          color="#4a2511"
          roughness={0.8}
          metalness={0.1}
        />
      </mesh>

      {/* Wood grain texture overlay */}
      <mesh position={[0, 0.051, 0]} receiveShadow>
        <boxGeometry args={[8, 0.001, 1.5]} />
        <meshStandardMaterial
          color="#5a3520"
          roughness={0.6}
          transparent
          opacity={0.5}
        />
      </mesh>

      {/* Front edge */}
      <mesh position={[0, -0.1, 0.75]}>
        <boxGeometry args={[8, 0.2, 0.05]} />
        <meshStandardMaterial
          color="#3a1f0f"
          roughness={0.7}
        />
      </mesh>

      {/* Back panel */}
      <mesh position={[0, 0.6, -0.7]} receiveShadow>
        <boxGeometry args={[8, 1.5, 0.05]} />
        <meshStandardMaterial
          color="#1a1a1a"
          roughness={0.9}
        />
      </mesh>
    </group>
  );
}

function Scene({
  projects,
  onSelectProject,
  hoveredIndex,
  setHoveredIndex,
}: {
  projects: Project[];
  onSelectProject: (project: Project) => void;
  hoveredIndex: number | null;
  setHoveredIndex: (index: number | null) => void;
}) {
  return (
    <>
      {/* Camera */}
      <PerspectiveCamera makeDefault position={[0, 0.5, 4.5]} fov={50} />
      
      {/* Lights */}
      <ambientLight intensity={0.3} />
      <directionalLight
        position={[5, 5, 5]}
        intensity={1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <spotLight
        position={[0, 4, 2]}
        angle={0.5}
        penumbra={0.5}
        intensity={0.8}
        castShadow
      />
      
      {/* Rim lights for dramatic effect */}
      <pointLight position={[-3, 1, 1]} intensity={0.3} color="#3b82f6" />
      <pointLight position={[3, 1, 1]} intensity={0.3} color="#ef4444" />

      {/* Environment for reflections */}
      <Environment preset="city" />

      {/* Shelf */}
      <Shelf />

      {/* Vinyl Records */}
      {projects.map((project, index) => {
        const spacing = 0.9;
        const startX = -(projects.length - 1) * spacing / 2;
        
        return (
          <VinylRecord3D
            key={project.id}
            project={project}
            position={[startX + index * spacing, 0, 0]}
            index={index}
            isHovered={hoveredIndex === index}
            onHover={(hover) => setHoveredIndex(hover ? index : null)}
            onClick={() => project.status === 'done' && onSelectProject(project)}
          />
        );
      })}

      {/* OrbitControls for camera movement */}
      <OrbitControls
        enableZoom={true}
        enablePan={true}
        minPolarAngle={Math.PI / 4}
        maxPolarAngle={Math.PI / 2}
        minDistance={3}
        maxDistance={8}
      />
    </>
  );
}

export function VinylLibrary3D({
  projects,
  onSelectProject,
  onNewProject,
  userName = '게스트',
  onLogin,
  onLogout,
  loading = false,
}: VinylLibrary3DProps) {
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
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 pt-12 pb-6 px-12">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Record Collection</h1>
            <p className="text-zinc-400">Browse your motion sync projects in 3D</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm text-zinc-400">{userName}</div>
            {onLogin && userName === '게스트' ? (
              <Button
                onClick={onLogin}
                className="gap-2 bg-white/10 hover:bg-white/20 px-5 h-10"
              >
                Sign In
              </Button>
            ) : onLogout ? (
              <Button
                onClick={onLogout}
                className="gap-2 bg-white/10 hover:bg-white/20 px-5 h-10"
              >
                Sign Out
              </Button>
            ) : null}
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
      </div>

      {/* 3D Canvas */}
      <div className="h-screen">
        <Canvas 
          shadows 
          gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
          dpr={[1, 2]}
        >
          <Suspense fallback={null}>
            <Scene
              projects={projects}
              onSelectProject={onSelectProject}
              hoveredIndex={hoveredIndex}
              setHoveredIndex={setHoveredIndex}
            />
          </Suspense>
        </Canvas>
      </div>

      {/* Project details panel */}
      <AnimatePresence>
        {hoveredProject && (
          <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="absolute right-0 top-0 bottom-0 w-[420px] bg-gradient-to-l from-zinc-900/95 via-zinc-900/90 to-transparent backdrop-blur-2xl border-l border-white/10 pointer-events-none"
          >
            <div className="h-full flex flex-col justify-center px-10 py-12 pointer-events-auto">
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
                      : hoveredProject.status === 'failed'
                        ? 'bg-red-500'
                        : 'bg-yellow-500 animate-pulse'
                  }`} />
                  <span className={`text-xs font-semibold uppercase tracking-wider ${
                    hoveredProject.status === 'done'
                      ? 'text-green-500'
                      : hoveredProject.status === 'failed'
                        ? 'text-red-500'
                        : 'text-yellow-500'
                  }`}>
                    {hoveredProject.status === 'done' ? 'Ready' : hoveredProject.status === 'failed' ? 'Failed' : 'Processing'}
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
          className="absolute bottom-8 left-1/2 -translate-x-1/2 text-center pointer-events-none"
        >
          <p className="text-zinc-500 text-sm mb-1">
            Hover over a record to see details • Drag to rotate • Scroll to zoom
          </p>
          <p className="text-zinc-700 text-xs">
            Click to open the timeline editor
          </p>
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
