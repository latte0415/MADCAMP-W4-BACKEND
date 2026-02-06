import { useRef, useEffect, useState, Suspense } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { OrbitControls, Center, Environment } from '@react-three/drei';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import * as THREE from 'three';

interface MeshModelProps {
  url: string;
}

function MeshModel({ url }: MeshModelProps) {
  const obj = useLoader(OBJLoader, url);
  const meshRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (obj) {
      // Apply material to all meshes
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = new THREE.MeshStandardMaterial({
            color: '#e0a060',
            roughness: 0.4,
            metalness: 0.1,
          });
        }
      });

      // Compute bounding box and center
      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      obj.position.sub(center);

      // Scale to fit
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 2 / maxDim;
      obj.scale.setScalar(scale);

      // Flip vertically (PIXIE outputs upside down)
      obj.rotation.x = Math.PI;
    }
  }, [obj]);

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.5;
    }
  });

  return (
    <group ref={meshRef}>
      <primitive object={obj} />
    </group>
  );
}

function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[0.5, 0.5, 0.5]} />
      <meshStandardMaterial color="#666" wireframe />
    </mesh>
  );
}

interface MeshPreviewProps {
  url: string | null;
  width?: number;
  height?: number;
  className?: string;
}

export function MeshPreview({ url, width = 200, height = 200, className = '' }: MeshPreviewProps) {
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
  }, [url]);

  if (!url) {
    return (
      <div
        className={`flex items-center justify-center bg-neutral-900 rounded ${className}`}
        style={{ width, height }}
      >
        <span className="text-neutral-500 text-xs">No mesh</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`flex items-center justify-center bg-neutral-900 rounded ${className}`}
        style={{ width, height }}
      >
        <span className="text-red-400 text-xs">Load failed</span>
      </div>
    );
  }

  return (
    <div className={`bg-neutral-900 rounded overflow-hidden ${className}`} style={{ width, height }}>
      <Canvas
        camera={{ position: [0, 0.8, 4], fov: 45 }}
        onCreated={({ camera }) => camera.lookAt(0, 1.2, 0)}
        onError={() => setError(true)}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={1} />
        <directionalLight position={[-5, -5, -5]} intensity={0.3} />
        <Suspense fallback={<LoadingFallback />}>
          <Center>
            <MeshModel url={url} />
          </Center>
        </Suspense>
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          autoRotate={false}
          minPolarAngle={Math.PI / 4}
          maxPolarAngle={Math.PI * 3 / 4}
        />
      </Canvas>
    </div>
  );
}
