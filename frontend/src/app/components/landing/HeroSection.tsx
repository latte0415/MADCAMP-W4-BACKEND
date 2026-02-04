import { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { motion } from 'motion/react';

function ParticleWave() {
  const meshRef = useRef<THREE.Points>(null);
  const mousePos = useRef({ x: 0, y: 0 });
  const targetMouse = useRef({ x: 0, y: 0 });

  const { size } = useThree();

  const count = 5000;
  const separation = 0.18;

  const { positions, colors } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    const cols = Math.ceil(Math.sqrt(count * (size.width / size.height)));
    const rows = Math.ceil(count / cols);

    // Warm amber color palette
    const amber = { r: 0.96, g: 0.62, b: 0.04 }; // #f59e0b
    const warmWhite = { r: 0.996, g: 0.953, b: 0.78 }; // #fef3c7
    const brown = { r: 0.71, g: 0.33, b: 0.04 }; // #b45309

    let idx = 0;
    for (let i = 0; i < cols && idx < count; i++) {
      for (let j = 0; j < rows && idx < count; j++) {
        const x = (i - cols / 2) * separation;
        const y = (j - rows / 2) * separation;
        positions[idx * 3] = x;
        positions[idx * 3 + 1] = y;
        positions[idx * 3 + 2] = 0;

        // Gradient from amber to warm white
        const t = Math.random();
        const colorChoice = Math.random();

        if (colorChoice < 0.6) {
          // Amber
          colors[idx * 3] = amber.r;
          colors[idx * 3 + 1] = amber.g;
          colors[idx * 3 + 2] = amber.b;
        } else if (colorChoice < 0.85) {
          // Warm white
          colors[idx * 3] = warmWhite.r * 0.8;
          colors[idx * 3 + 1] = warmWhite.g * 0.8;
          colors[idx * 3 + 2] = warmWhite.b * 0.8;
        } else {
          // Brown
          colors[idx * 3] = brown.r;
          colors[idx * 3 + 1] = brown.g;
          colors[idx * 3 + 2] = brown.b;
        }

        idx++;
      }
    }

    return { positions, colors };
  }, [count, separation, size.width, size.height]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      targetMouse.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      targetMouse.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;

    mousePos.current.x += (targetMouse.current.x - mousePos.current.x) * 0.05;
    mousePos.current.y += (targetMouse.current.y - mousePos.current.y) * 0.05;

    const time = clock.getElapsedTime();
    const posAttr = meshRef.current.geometry.attributes.position;
    const arr = posAttr.array as Float32Array;

    const cols = Math.ceil(Math.sqrt(count * (size.width / size.height)));
    const rows = Math.ceil(count / cols);

    let idx = 0;
    for (let i = 0; i < cols && idx < count; i++) {
      for (let j = 0; j < rows && idx < count; j++) {
        const baseX = (i - cols / 2) * separation;
        const baseY = (j - rows / 2) * separation;

        // Gentler wave
        const waveZ =
          Math.sin(baseX * 1.5 + time * 0.8) * 0.12 +
          Math.cos(baseY * 1.5 + time * 0.6) * 0.12;

        const dx = baseX - mousePos.current.x * 4;
        const dy = baseY - mousePos.current.y * 2.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const mouseInfluence = Math.exp(-dist * 0.6) * 0.25;

        arr[idx * 3 + 2] = waveZ + mouseInfluence;
        idx++;
      }
    }

    posAttr.needsUpdate = true;
  });

  return (
    <points ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={count}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[colors, 3]}
          count={count}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.03}
        vertexColors
        transparent
        opacity={0.7}
        sizeAttenuation
      />
    </points>
  );
}

interface HeroSectionProps {
  onScrollDown?: () => void;
}

export function HeroSection({ onScrollDown }: HeroSectionProps) {
  return (
    <section className="relative h-screen w-full overflow-hidden" style={{ background: '#0d0b09' }}>
      {/* Particle canvas */}
      <div className="absolute inset-0">
        <Canvas
          camera={{ position: [0, 0, 5], fov: 50 }}
          gl={{ antialias: true, alpha: true }}
        >
          <ParticleWave />
        </Canvas>
      </div>

      {/* Warm gradient overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse at 50% 30%, rgba(245,158,11,0.05) 0%, transparent 50%),
            linear-gradient(to bottom, transparent 60%, #0d0b09 100%)
          `,
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex h-full flex-col items-center justify-center px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-center"
        >
          {/* Logo/Icon */}
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.1 }}
            className="w-20 h-20 mx-auto mb-8 rounded-full flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              boxShadow: '0 10px 40px rgba(245,158,11,0.3), 0 0 80px rgba(245,158,11,0.1)',
            }}
          >
            <span className="text-4xl">♫</span>
          </motion.div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tight">
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: 'linear-gradient(135deg, #fef3c7 0%, #f59e0b 50%, #d97706 100%)',
              }}
            >
              DANCE + MAGIC
            </span>
            <br />
            <span className="text-amber-50/90">ANALYSIS LAB</span>
          </h1>

          <p className="mt-6 text-lg md:text-xl text-amber-200/60 max-w-2xl mx-auto">
            Experimental motion archive and interactive vinyl collection.
            <br />
            Where movement meets visual magic.
          </p>

          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            onClick={onScrollDown}
            className="mt-10 px-8 py-3 rounded-full font-medium transition-all"
            style={{
              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              color: '#0d0b09',
              boxShadow: '0 10px 30px rgba(245,158,11,0.3)',
            }}
            whileHover={{
              scale: 1.05,
              boxShadow: '0 15px 40px rgba(245,158,11,0.4)',
            }}
            whileTap={{ scale: 0.98 }}
          >
            Enter the Studio
          </motion.button>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="absolute bottom-12 left-1/2 -translate-x-1/2"
        >
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            className="flex flex-col items-center gap-2 cursor-pointer"
            onClick={onScrollDown}
          >
            <span className="text-xs uppercase tracking-widest text-amber-200/40">Scroll</span>
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-amber-500/60"
            >
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
