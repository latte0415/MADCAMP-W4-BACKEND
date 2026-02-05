import { useMemo, ReactNode } from 'react';

interface GenerativeAlbumArtProps {
  seed: string;
  mode: 'dance' | 'magic';
  size?: number;
}

// Simple seeded random number generator
function seededRandom(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  return function() {
    hash = Math.sin(hash) * 10000;
    return hash - Math.floor(hash);
  };
}

export function GenerativeAlbumArt({ seed, mode, size = 450 }: GenerativeAlbumArtProps) {
  const elements = useMemo(() => {
    const random = seededRandom(seed);
    const result: ReactNode[] = [];

    // Color palettes - brighter
    const danceColors = ['#ff8c42', '#ffa559', '#ffd166', '#ffb347', '#ff6b6b', '#ff8585'];
    const magicColors = ['#a78bfa', '#c4b5fd', '#818cf8', '#a5b4fc', '#e879f9', '#d946ef'];
    const colors = mode === 'magic' ? magicColors : danceColors;

    // Background gradient - much brighter base
    const bgAngle = Math.floor(random() * 360);
    const bgColor1 = mode === 'magic' ? '#4a3a6a' : '#5a4030';
    const bgColor2 = mode === 'magic' ? '#2a2045' : '#3a2818';

    // Base background
    result.push(
      <div
        key="bg"
        className="absolute inset-0"
        style={{
          background: `linear-gradient(${bgAngle}deg, ${bgColor1} 0%, ${bgColor2} 100%)`,
        }}
      />
    );

    // Large ambient glow spots - much brighter
    const glowCount = 4 + Math.floor(random() * 3);
    for (let i = 0; i < glowCount; i++) {
      const x = random() * 100;
      const y = random() * 100;
      const glowSize = 200 + random() * 300;
      const color = colors[Math.floor(random() * colors.length)];

      result.push(
        <div
          key={`glow-${i}`}
          className="absolute"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            width: glowSize,
            height: glowSize,
            background: `radial-gradient(circle, ${color}99 0%, ${color}55 40%, transparent 70%)`,
            transform: 'translate(-50%, -50%)',
            filter: 'blur(60px)',
          }}
        />
      );
    }

    // Mesh gradient layer - stronger
    const meshColor1 = colors[Math.floor(random() * colors.length)];
    const meshColor2 = colors[Math.floor(random() * colors.length)];
    const meshColor3 = colors[Math.floor(random() * colors.length)];
    const meshAngle = Math.floor(random() * 360);
    result.push(
      <div
        key="mesh"
        className="absolute inset-0"
        style={{
          background: `
            linear-gradient(${meshAngle}deg, ${meshColor1}50 0%, transparent 40%),
            linear-gradient(${meshAngle + 120}deg, ${meshColor2}40 0%, transparent 40%),
            linear-gradient(${meshAngle + 240}deg, ${meshColor3}30 0%, transparent 40%)
          `,
        }}
      />
    );

    // Generate circles
    const circleCount = 3 + Math.floor(random() * 4);
    for (let i = 0; i < circleCount; i++) {
      const x = random() * 100;
      const y = random() * 100;
      const r = 20 + random() * 60;
      const color = colors[Math.floor(random() * colors.length)];
      const opacity = 0.25 + random() * 0.35;

      result.push(
        <div
          key={`circle-${i}`}
          className="absolute rounded-full"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            width: r,
            height: r,
            background: `radial-gradient(circle, ${color}${Math.floor(opacity * 255).toString(16).padStart(2, '0')} 0%, transparent 70%)`,
            transform: 'translate(-50%, -50%)',
          }}
        />
      );
    }

    // Generate arcs/rings
    const ringCount = 2 + Math.floor(random() * 3);
    for (let i = 0; i < ringCount; i++) {
      const x = random() * 100;
      const y = random() * 100;
      const r = 80 + random() * 150;
      const color = colors[Math.floor(random() * colors.length)];
      const opacity = 0.35 + random() * 0.4;
      const borderWidth = 1 + random() * 3;

      result.push(
        <div
          key={`ring-${i}`}
          className="absolute rounded-full"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            width: r,
            height: r,
            border: `${borderWidth}px solid ${color}${Math.floor(opacity * 255).toString(16).padStart(2, '0')}`,
            transform: 'translate(-50%, -50%)',
          }}
        />
      );
    }

    // Generate lines
    const lineCount = 4 + Math.floor(random() * 6);
    for (let i = 0; i < lineCount; i++) {
      const x = random() * 100;
      const y = random() * 100;
      const length = 50 + random() * 150;
      const angle = random() * 360;
      const color = colors[Math.floor(random() * colors.length)];
      const opacity = 0.4 + random() * 0.4;
      const width = 1 + random() * 2;

      result.push(
        <div
          key={`line-${i}`}
          className="absolute"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            width: length,
            height: width,
            background: `linear-gradient(90deg, transparent, ${color}${Math.floor(opacity * 255).toString(16).padStart(2, '0')}, transparent)`,
            transform: `rotate(${angle}deg)`,
            transformOrigin: 'left center',
          }}
        />
      );
    }

    // Generate dots pattern
    const dotPatternChance = random();
    if (dotPatternChance > 0.4) {
      const dotColor = colors[Math.floor(random() * colors.length)];
      const gridSize = 20 + Math.floor(random() * 20);
      const dotSize = 2 + random() * 3;
      const offsetX = random() * 50;
      const offsetY = random() * 50;

      result.push(
        <div
          key="dots"
          className="absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(${dotColor}55 ${dotSize}px, transparent ${dotSize}px)`,
            backgroundSize: `${gridSize}px ${gridSize}px`,
            backgroundPosition: `${offsetX}px ${offsetY}px`,
          }}
        />
      );
    }

    // Generate geometric shapes
    const shapeCount = 1 + Math.floor(random() * 3);
    for (let i = 0; i < shapeCount; i++) {
      const x = 20 + random() * 60;
      const y = 20 + random() * 60;
      const shapeSize = 30 + random() * 80;
      const color = colors[Math.floor(random() * colors.length)];
      const opacity = 0.3 + random() * 0.3;
      const rotation = random() * 360;
      const shapeType = Math.floor(random() * 3);

      if (shapeType === 0) {
        // Triangle
        result.push(
          <div
            key={`shape-${i}`}
            className="absolute"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: 0,
              height: 0,
              borderLeft: `${shapeSize / 2}px solid transparent`,
              borderRight: `${shapeSize / 2}px solid transparent`,
              borderBottom: `${shapeSize}px solid ${color}${Math.floor(opacity * 255).toString(16).padStart(2, '0')}`,
              transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            }}
          />
        );
      } else if (shapeType === 1) {
        // Square
        result.push(
          <div
            key={`shape-${i}`}
            className="absolute"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: shapeSize,
              height: shapeSize,
              background: `${color}${Math.floor(opacity * 255).toString(16).padStart(2, '0')}`,
              transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            }}
          />
        );
      } else {
        // Diamond
        result.push(
          <div
            key={`shape-${i}`}
            className="absolute"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: shapeSize,
              height: shapeSize,
              background: `${color}${Math.floor(opacity * 255).toString(16).padStart(2, '0')}`,
              transform: `translate(-50%, -50%) rotate(45deg)`,
            }}
          />
        );
      }
    }

    // Noise overlay
    result.push(
      <div
        key="noise"
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          mixBlendMode: 'overlay',
        }}
      />
    );

    // Vignette
    result.push(
      <div
        key="vignette"
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(circle at center, transparent 50%, rgba(0,0,0,0.25) 100%)',
        }}
      />
    );

    return result;
  }, [seed, mode]);

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ width: size, height: size }}
    >
      {elements}
    </div>
  );
}
