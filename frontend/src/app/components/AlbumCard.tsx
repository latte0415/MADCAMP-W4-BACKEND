import { motion } from 'motion/react';
import { VinylDisk } from './VinylDisk';

interface AlbumCardProps {
  title: string;
  year: number;
  type: 'dance' | 'magic';
  thumbnail?: string;
  depth: number;
  focused: boolean;
  onClick?: () => void;
  onHover?: (hover: boolean) => void;
  opening?: boolean;
}

export function AlbumCard({
  title,
  year,
  type,
  thumbnail,
  depth,
  focused,
  onClick,
  onHover,
  opening,
}: AlbumCardProps) {
  const accent = type === 'magic' ? '#7c3aed' : '#22d3ee';
  const cover = thumbnail
    ? `url(${thumbnail})`
    : type === 'magic'
      ? 'radial-gradient(circle at 20% 20%, rgba(124,58,237,0.55), transparent 55%), radial-gradient(circle at 80% 30%, rgba(244,114,182,0.45), transparent 45%), linear-gradient(160deg, rgba(14,16,26,0.9), rgba(25,29,40,0.6))'
      : 'radial-gradient(circle at 25% 25%, rgba(56,189,248,0.5), transparent 55%), radial-gradient(circle at 70% 70%, rgba(16,185,129,0.4), transparent 45%), linear-gradient(160deg, rgba(12,15,22,0.9), rgba(25,30,38,0.6))';

  return (
    <motion.div
      className="relative w-52 h-80 rounded-2xl border border-white/10 overflow-visible bg-zinc-900 shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
      style={{ filter: `blur(${Math.max(0, depth * 1.6)}px)` }}
      animate={{
        scale: focused ? 1.1 : 1 - depth * 0.16,
        opacity: 1 - depth * 0.22,
        boxShadow: focused
          ? '0 30px 60px rgba(0,0,0,0.65)'
          : '0 16px 32px rgba(0,0,0,0.4)',
      }}
      transition={{ type: 'spring', stiffness: 140, damping: 20 }}
      onClick={focused ? onClick : undefined}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      <div className="absolute -left-3 top-1 h-[98%] w-3 rounded-l-xl bg-gradient-to-b from-zinc-800 to-zinc-950 shadow-[inset_0_0_8px_rgba(0,0,0,0.6)]" />
      <div
        className="absolute inset-0 rounded-2xl overflow-hidden"
        style={{
          backgroundImage: cover,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-white/15 via-transparent to-black/70" />
      <div className="absolute inset-0 rounded-2xl mix-blend-soft-light opacity-40 [background-image:radial-gradient(rgba(255,255,255,0.15)_1px,transparent_1px)] [background-size:3px_3px]" />

      <div className="relative z-10 flex h-full flex-col justify-between p-5">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-300">
          <span className="inline-flex size-2 rounded-full" style={{ background: accent }} />
          {type}
        </div>

        <div>
          <h3 className="text-lg font-semibold text-white leading-tight">{title}</h3>
          <p className="text-sm text-zinc-400">{year}</p>
        </div>
      </div>

      {focused && (
        <>
          <div className="absolute left-0 right-0 top-1/2 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent" />
          <div className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70 shadow-[0_0_12px_rgba(255,255,255,0.8)]" />
          <div className="absolute left-0 top-1/2 h-10 w-24 -translate-y-1/2 bg-white/5 blur-[6px]" />
        </>
      )}

      <VinylDisk focused={focused} accent={accent} opening={opening} />

      {/* Reflection */}
      <div
        className="absolute left-0 right-0 -bottom-24 h-20 opacity-30 blur-[1px]"
        style={{
          transform: 'scaleY(-1)',
          backgroundImage: cover,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          maskImage: 'linear-gradient(to bottom, rgba(255,255,255,0.6), transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, rgba(255,255,255,0.6), transparent)',
        }}
      />
    </motion.div>
  );
}
