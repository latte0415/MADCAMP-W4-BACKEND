import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { Project } from '../types';

interface VinylRecord3DProps {
  project: Project;
  position: [number, number, number];
  index: number;
  onHover: (hover: boolean) => void;
  onClick: () => void;
  isHovered: boolean;
}

export function VinylRecord3D({
  project,
  position,
  index,
  onHover,
  onClick,
  isHovered,
}: VinylRecord3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const vinylRef = useRef<THREE.Mesh>(null);
  const [targetY, setTargetY] = useState(0);

  const colors = [
    { vinyl: '#1a1a1a', label: '#3b82f6', accent: '#60a5fa' }, // blue
    { vinyl: '#2d1a1a', label: '#ef4444', accent: '#f87171' }, // red
    { vinyl: '#1a2d1a', label: '#22c55e', accent: '#4ade80' }, // green
    { vinyl: '#2d1a2d', label: '#a855f7', accent: '#c084fc' }, // purple
    { vinyl: '#1a2d2d', label: '#06b6d4', accent: '#22d3ee' }, // cyan
    { vinyl: '#2d2d1a', label: '#eab308', accent: '#fbbf24' }, // yellow
  ];

  const color = colors[index % colors.length];

  useFrame(() => {
    if (groupRef.current) {
      // Smooth Y position animation
      groupRef.current.position.y += (targetY - groupRef.current.position.y) * 0.1;
    }

    if (vinylRef.current && isHovered) {
      // Rotate vinyl when hovered
      vinylRef.current.rotation.z += 0.05;
    }
  });

  const handlePointerOver = () => {
    setTargetY(0.8);
    onHover(true);
  };

  const handlePointerOut = () => {
    setTargetY(0);
    onHover(false);
  };

  return (
    <group ref={groupRef} position={position}>
      {/* Album Sleeve */}
      <group position={[0, 0, isHovered ? -0.2 : 0]}>
        <RoundedBox
          args={[0.8, 1.2, 0.05]}
          radius={0.02}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
          onClick={onClick}
        >
          <meshStandardMaterial
            color={color.label}
            roughness={0.3}
            metalness={0.1}
          />
        </RoundedBox>

        {/* Album title on cover */}
        <Text
          position={[0, 0.3, 0.03]}
          fontSize={0.08}
          color="white"
          maxWidth={0.6}
          textAlign="center"
        >
          {project.title}
        </Text>

        <Text
          position={[0, 0.1, 0.03]}
          fontSize={0.05}
          color="rgba(255,255,255,0.7)"
          textAlign="center"
        >
          {project.mode.toUpperCase()}
        </Text>

        {/* Center circle design */}
        <mesh position={[0, -0.2, 0.03]}>
          <circleGeometry args={[0.15, 32]} />
          <meshStandardMaterial
            color={color.accent}
            emissive={color.accent}
            emissiveIntensity={0.3}
          />
        </mesh>

        {/* Inner circle */}
        <mesh position={[0, -0.2, 0.031]}>
          <ringGeometry args={[0.06, 0.08, 32]} />
          <meshStandardMaterial color="white" opacity={0.5} transparent />
        </mesh>
      </group>

      {/* Vinyl Disc (slides out when hovered) */}
      <group position={[isHovered ? 0.5 : 0, 0, isHovered ? 0.3 : 0]}>
        <mesh ref={vinylRef} rotation={[0, 0, 0]}>
          <cylinderGeometry args={[0.5, 0.5, 0.01, 64]} />
          <meshStandardMaterial
            color={color.vinyl}
            roughness={0.8}
            metalness={0.2}
          />
        </mesh>

        {/* Vinyl grooves */}
        {[...Array(8)].map((_, i) => (
          <mesh key={i} rotation={[0, 0, 0]}>
            <ringGeometry args={[0.15 + i * 0.04, 0.16 + i * 0.04, 64]} />
            <meshStandardMaterial
              color="#0a0a0a"
              transparent
              opacity={0.3}
            />
          </mesh>
        ))}

        {/* Center label */}
        <mesh position={[0, 0, 0.006]}>
          <circleGeometry args={[0.12, 32]} />
          <meshStandardMaterial
            color={color.label}
            emissive={color.label}
            emissiveIntensity={0.5}
          />
        </mesh>

        {/* Center hole */}
        <mesh position={[0, 0, 0.007]}>
          <circleGeometry args={[0.03, 32]} />
          <meshStandardMaterial color="#000000" />
        </mesh>

        {/* Label text */}
        <Text
          position={[0, 0.03, 0.008]}
          fontSize={0.025}
          color="white"
          textAlign="center"
        >
          MOTION
        </Text>
        <Text
          position={[0, 0, 0.008]}
          fontSize={0.02}
          color="white"
          textAlign="center"
        >
          SYNC
        </Text>
        <Text
          position={[0, -0.03, 0.008]}
          fontSize={0.015}
          color="rgba(255,255,255,0.7)"
          textAlign="center"
        >
          RECORDS
        </Text>
      </group>

      {/* Spine (thin side visible when not hovered) */}
      {!isHovered && (
        <group position={[-0.4, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <RoundedBox args={[0.05, 1.2, 0.8]} radius={0.01}>
            <meshStandardMaterial
              color={color.label}
              roughness={0.4}
            />
          </RoundedBox>

          <Text
            position={[0, 0.2, 0.41]}
            fontSize={0.06}
            color="white"
            maxWidth={0.9}
            textAlign="center"
            rotation={[0, 0, 0]}
          >
            {project.title}
          </Text>
        </group>
      )}
    </group>
  );
}