import { useCallback, useEffect, useRef, useState } from 'react';

interface CarouselPhysicsOptions {
  itemCount: number;
  spacing: number;
}

export function useCarouselPhysics({ itemCount, spacing }: CarouselPhysicsOptions) {
  const [offset, setOffset] = useState(0);
  const isDragging = useRef(false);
  const lastX = useRef(0);
  const velocity = useRef(0);
  const rafId = useRef<number | null>(null);

  const clampOffset = useCallback(
    (value: number) => {
      const min = -0.8;
      const max = Math.max(0, itemCount - 1 + 0.8);
      return Math.max(min, Math.min(max, value));
    },
    [itemCount]
  );

  const stopInertia = useCallback(() => {
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
  }, []);

  const applyInertia = useCallback(() => {
    stopInertia();
    const step = () => {
      velocity.current *= 0.92;
      if (Math.abs(velocity.current) < 0.0005) {
        velocity.current = 0;
        stopInertia();
        return;
      }
      setOffset(prev => clampOffset(prev + velocity.current));
      rafId.current = requestAnimationFrame(step);
    };
    rafId.current = requestAnimationFrame(step);
  }, [clampOffset, stopInertia]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    isDragging.current = true;
    lastX.current = event.clientX;
    velocity.current = 0;
    stopInertia();
  }, [stopInertia]);

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!isDragging.current) return;
      const dx = event.clientX - lastX.current;
      lastX.current = event.clientX;
      const delta = dx / spacing;
      velocity.current = -delta * 0.3;
      setOffset(prev => clampOffset(prev - delta));
    },
    [clampOffset, spacing]
  );

  const onPointerUp = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    applyInertia();
  }, [applyInertia]);

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      const delta = event.deltaY * 0.0015;
      velocity.current = delta * 0.4;
      setOffset(prev => clampOffset(prev + delta));
      applyInertia();
    },
    [applyInertia, clampOffset]
  );

  useEffect(() => () => stopInertia(), [stopInertia]);

  return {
    offset,
    setOffset,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerLeave: onPointerUp,
      onWheel,
    },
  };
}
