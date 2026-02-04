import { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { motion } from 'motion/react';

function ParticleWave() {
  const meshRef = useRef<THREE.Points>(null);
  const mousePos = useRef({ x: 0, y: 0 });
  const targetMouse = useRef({ x: 0, y: 0 });

  const { size } = useThree();

  const count = 4000;
  const separation = 0.2;

  const { positions, colors } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    const cols = Math.ceil(Math.sqrt(count * (size.width / size.height)));
    const rows = Math.ceil(count / cols);

    let idx = 0;
    for (let i = 0; i < cols && idx < count; i++) {
      for (let j = 0; j < rows && idx < count; j++) {
        const x = (i - cols / 2) * separation;
        const y = (j - rows / 2) * separation;
        positions[idx * 3] = x;
        positions[idx * 3 + 1] = y;
        positions[idx * 3 + 2] = 0;

        // Grayscale palette
        const brightness = 0.3 + Math.random() * 0.5;
        colors[idx * 3] = brightness;
        colors[idx * 3 + 1] = brightness;
        colors[idx * 3 + 2] = brightness;

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

        const waveZ =
          Math.sin(baseX * 1.2 + time * 0.6) * 0.1 +
          Math.cos(baseY * 1.2 + time * 0.5) * 0.1;

        const dx = baseX - mousePos.current.x * 4;
        const dy = baseY - mousePos.current.y * 2.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const mouseInfluence = Math.exp(-dist * 0.5) * 0.2;

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
        size={0.025}
        vertexColors
        transparent
        opacity={0.6}
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
    <section className="relative h-screen w-full overflow-hidden" style={{ background: '#050505' }}>
      {/* Particle canvas */}
      <div className="absolute inset-0">
        <Canvas
          camera={{ position: [0, 0, 5], fov: 50 }}
          gl={{ antialias: true, alpha: true }}
        >
          <ParticleWave />
        </Canvas>
      </div>

      {/* Subtle grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.02]"
        style={{
          backgroundImage: `
            linear-gradient(90deg, #fff 1px, transparent 1px),
            linear-gradient(0deg, #fff 1px, transparent 1px)
          `,
          backgroundSize: '100px 100px',
        }}
      />

      {/* Content - left aligned */}
      <div className="relative z-10 flex h-full flex-col justify-center px-12 md:px-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          {/* Title */}
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-medium tracking-tight text-white mb-2">
            DANCE + MAGIC
          </h1>
          <h2 className="text-4xl md:text-6xl lg:text-7xl font-medium tracking-tight text-neutral-500 mb-8">
            ANALYSIS LAB
          </h2>

          {/* Divider line */}
          <div className="w-48 h-px bg-neutral-700 mb-8" />

          {/* Subtitle */}
          <p className="text-neutral-500 text-sm md:text-base mb-12 max-w-md leading-relaxed">
            experimental motion archive.
            <br />
            where movement meets visual analysis.
          </p>

          {/* CTA Button - no rounded corners */}
          <motion.button
            onClick={onScrollDown}
            className="text-sm text-white px-8 py-4 tracking-wide transition-colors"
            style={{
              border: '1px solid #333',
              background: 'transparent',
            }}
            whileHover={{
              borderColor: '#666',
            }}
            whileTap={{
              scale: 0.98,
            }}
          >
            enter studio →
          </motion.button>
        </motion.div>
      </div>

      {/* Scroll indicator - bottom right */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="absolute bottom-12 right-12"
      >
        <motion.div
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          className="flex flex-col items-end gap-3 cursor-pointer"
          onClick={onScrollDown}
        >
          <span className="text-[10px] uppercase tracking-[0.2em] text-neutral-600">scroll</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="text-neutral-600"
          >
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
        </motion.div>
      </motion.div>

      {/* Vertical accent line */}
      <div
        className="absolute top-20 bottom-20 left-8 w-px pointer-events-none"
        style={{ background: '#1a1a1a' }}
      />
    </section>
  );
}
