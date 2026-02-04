import { motion } from 'motion/react';

interface VinylDiskProps {
  focused: boolean;
  accent: string;
  opening?: boolean;
}

export function VinylDisk({ focused, accent, opening }: VinylDiskProps) {
  return (
    <motion.div
      className="absolute -right-14 top-1/2 size-52 -translate-y-1/2 rounded-full bg-zinc-900 shadow-[0_24px_70px_rgba(0,0,0,0.85)] z-20"
      animate={{
        x: focused ? 88 : 10,
        scale: focused ? 1.08 : 0.92,
        opacity: focused ? 1 : 0.25,
      }}
      transition={{ type: 'spring', stiffness: 140, damping: 20 }}
    >
      <motion.div
        className="absolute inset-2 rounded-full border border-white/10 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.15),transparent_45%),radial-gradient(circle_at_60%_70%,rgba(255,255,255,0.08),transparent_55%),linear-gradient(140deg,#1a1d24,#050608)]"
        animate={{
          rotate: focused ? 360 : 0,
        }}
        transition={{
          duration: opening ? 2.2 : 10,
          ease: 'linear',
          repeat: focused ? Infinity : 0,
        }}
      />
      <div className="absolute inset-[40%] rounded-full bg-zinc-950 border border-white/10" />
      <div
        className="absolute inset-[46%] rounded-full"
        style={{ background: accent }}
      />
      <div className="absolute inset-6 rounded-full border border-white/5" />
      <div className="absolute inset-8 rounded-full border border-white/5" />
      <div className="absolute right-6 top-6 size-6 rounded-full bg-white/20 blur-[2px]" />
      <div className="absolute inset-0 mix-blend-soft-light opacity-40 [background-image:radial-gradient(rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:3px_3px]" />
      {opening && (
        <motion.div
          className="absolute inset-0 rounded-full border-2 border-white/60"
          animate={{ scale: 1.2, opacity: 0 }}
          transition={{ duration: 0.5 }}
        />
      )}
    </motion.div>
  );
}
