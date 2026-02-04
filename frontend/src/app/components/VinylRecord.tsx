import { motion } from 'motion/react';
import { Project } from '../types';

interface VinylRecordProps {
  project: Project;
  index: number;
  isHovered: boolean;
  onHover: (hover: boolean) => void;
  onClick: () => void;
}

export function VinylRecord({
  project,
  index,
  isHovered,
  onHover,
  onClick,
}: VinylRecordProps) {
  const colors = [
    { vinyl: '#1a1a1a', label: '#3b82f6', accent: '#60a5fa' }, // blue
    { vinyl: '#2d1a1a', label: '#ef4444', accent: '#f87171' }, // red
    { vinyl: '#1a2d1a', label: '#22c55e', accent: '#4ade80' }, // green
    { vinyl: '#2d1a2d', label: '#a855f7', accent: '#c084fc' }, // purple
    { vinyl: '#1a2d2d', label: '#06b6d4', accent: '#22d3ee' }, // cyan
    { vinyl: '#2d2d1a', label: '#eab308', accent: '#fbbf24' }, // yellow
  ];

  const color = colors[index % colors.length];

  return (
    <motion.div
      className="relative cursor-pointer group"
      initial={{ y: 0, z: 0 }}
      animate={{
        y: isHovered ? -40 : 0,
        scale: isHovered ? 1.05 : 1,
      }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 25,
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onClick}
      style={{
        transformStyle: 'preserve-3d',
        zIndex: isHovered ? 100 : 10,
      }}
    >
      {/* Album sleeve standing upright */}
      <div className="relative w-64 h-80">
        {/* Spine (visible when not hovered) */}
        <motion.div
          className="absolute inset-0 rounded-sm overflow-hidden shadow-2xl"
          style={{
            background: `linear-gradient(180deg, ${color.label}, ${color.vinyl})`,
          }}
          animate={{
            rotateY: isHovered ? -25 : 0,
            x: isHovered ? -30 : 0,
          }}
          transition={{
            type: 'spring',
            stiffness: 400,
            damping: 25,
          }}
        >
          {/* Spine design (visible by default) */}
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="text-center w-full">
              {/* Vinyl icon on spine */}
              <motion.div
                className="w-16 h-16 mx-auto mb-4 rounded-full border-2 border-white/30 flex items-center justify-center"
                animate={{
                  rotate: isHovered ? 180 : 0,
                }}
                transition={{ duration: 0.6 }}
              >
                <div className="w-3 h-3 rounded-full bg-white/50" />
              </motion.div>

              {/* Title on spine */}
              <h3 className="text-white font-bold text-base mb-2 line-clamp-3 leading-tight">
                {project.title}
              </h3>
              <p className="text-white/70 text-xs uppercase tracking-widest">
                {project.mode}
              </p>
            </div>
          </div>

          {/* Wear & tear texture */}
          <div className="absolute inset-0 bg-gradient-to-b from-white/5 via-transparent to-black/20 pointer-events-none" />
          <div className="absolute inset-0 opacity-30 pointer-events-none" 
               style={{
                 backgroundImage: 'url("data:image/svg+xml,%3Csvg width="100" height="100" xmlns="http://www.w3.org/2000/svg"%3E%3Cfilter id="noise"%3E%3CfeTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" /%3E%3C/filter%3E%3Crect width="100" height="100" filter="url(%23noise)" opacity="0.3"/%3E%3C/svg%3E")',
               }}
          />
        </motion.div>

        {/* Full cover (shown on hover) */}
        <motion.div
          className="absolute inset-0 rounded-lg overflow-hidden shadow-2xl border-2 border-white/20"
          style={{
            background: `linear-gradient(135deg, ${color.label}60, ${color.vinyl}90)`,
          }}
          initial={{ opacity: 0, scale: 0.9, rotateY: -90 }}
          animate={{
            opacity: isHovered ? 1 : 0,
            scale: isHovered ? 1 : 0.9,
            rotateY: isHovered ? 0 : -90,
            x: isHovered ? -60 : 0,
          }}
          transition={{
            type: 'spring',
            stiffness: 400,
            damping: 25,
          }}
        >
          {/* Album cover design */}
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="text-center">
              {/* Center artwork */}
              <motion.div
                className="relative w-32 h-32 mx-auto mb-6 rounded-full"
                style={{
                  background: `conic-gradient(from 0deg, ${color.label}, ${color.accent}, ${color.label})`,
                }}
                animate={{
                  rotate: isHovered ? [0, 360] : 0,
                }}
                transition={{
                  duration: 3,
                  repeat: isHovered ? Infinity : 0,
                  ease: 'linear',
                }}
              >
                <div className="absolute inset-2 rounded-full bg-zinc-950" />
                <div className="absolute inset-4 rounded-full" 
                     style={{
                       background: `radial-gradient(circle, ${color.accent}, ${color.label})`,
                     }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-8 h-8 rounded-full bg-zinc-950 border-2 border-white/20" />
                </div>
              </motion.div>

              <h3 className="text-white font-bold text-xl mb-2 line-clamp-2">
                {project.title}
              </h3>
              <p className="text-white/70 text-sm uppercase tracking-wider mb-4">
                {project.mode} Collection
              </p>
              
              {/* Mini stats */}
              <div className="flex items-center justify-center gap-4 text-xs text-white/50">
                <span>{project.musicKeypoints.length} tracks</span>
                <span>•</span>
                <span>{Math.floor(project.duration / 60)}m</span>
              </div>
            </div>
          </div>

          {/* Gloss overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-black/40 pointer-events-none" />
        </motion.div>

        {/* Vinyl disc peeking out when hovered */}
        <motion.div
          className="absolute top-8 -right-6 w-72 h-72"
          initial={{ x: 0, opacity: 0 }}
          animate={{
            x: isHovered ? 40 : 0,
            opacity: isHovered ? 1 : 0,
          }}
          transition={{
            type: 'spring',
            stiffness: 400,
            damping: 25,
          }}
        >
          {/* Vinyl disc */}
          <div
            className="relative w-full h-full rounded-full shadow-2xl"
            style={{
              background: `radial-gradient(circle at 35% 35%, ${color.vinyl}dd, #000000)`,
            }}
          >
            {/* Grooves */}
            {[...Array(25)].map((_, i) => (
              <div
                key={i}
                className="absolute inset-0 rounded-full border border-white/[0.02]"
                style={{
                  transform: `scale(${1 - i * 0.035})`,
                }}
              />
            ))}

            {/* Center label */}
            <motion.div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full shadow-xl flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${color.label}, ${color.accent})`,
              }}
              animate={{
                rotate: isHovered ? 360 : 0,
              }}
              transition={{
                duration: 2,
                repeat: isHovered ? Infinity : 0,
                ease: 'linear',
              }}
            >
              <div className="text-center">
                <div className="text-white text-[10px] font-bold">MOTION</div>
                <div className="text-white/90 text-[8px]">SYNC</div>
                <div className="text-white/70 text-[8px] mt-0.5">RECORDS</div>
              </div>
            </motion.div>

            {/* Center hole */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black shadow-inner border border-white/10" />
          </div>
        </motion.div>

        {/* Shadow underneath */}
        <motion.div
          className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-48 h-4 bg-black/50 rounded-full blur-xl"
          animate={{
            scale: isHovered ? 1.2 : 1,
            opacity: isHovered ? 0.7 : 0.3,
          }}
        />
      </div>
    </motion.div>
  );
}
