import { useRef, useEffect, useState, type RefObject } from 'react';

interface PointerState {
  x: number;          // x coordinate relative to canvas (in CSS pixels)
  y: number;          // y coordinate relative to canvas
  isDown: boolean;    // is mouse button pressed or finger touching
  isDragging: boolean; // isDown and has moved
}

/**
 * Unified mouse + touch input for canvas simulations.
 *
 * Usage:
 *   const pointer = useTouchAndMouse(canvasRef);
 *   // pointer.x, pointer.y, pointer.isDown, pointer.isDragging
 */
export function useTouchAndMouse(
  canvasRef: RefObject<HTMLCanvasElement | null>,
): PointerState {
  const [pointer, setPointer] = useState<PointerState>({
    x: 0,
    y: 0,
    isDown: false,
    isDragging: false,
  });
  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function getPos(e: MouseEvent | Touch): { x: number; y: number } {
      const rect = canvas!.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }

    // Mouse handlers
    const onMouseMove = (e: MouseEvent) => {
      const pos = getPos(e);
      setPointer((prev) => ({
        ...pos,
        isDown: prev.isDown,
        isDragging: prev.isDown && startRef.current !== null,
      }));
    };
    const onMouseDown = (e: MouseEvent) => {
      const pos = getPos(e);
      startRef.current = pos;
      setPointer({ ...pos, isDown: true, isDragging: false });
    };
    const onMouseUp = () => {
      startRef.current = null;
      setPointer((prev) => ({ ...prev, isDown: false, isDragging: false }));
    };

    // Touch handlers
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault(); // prevent scroll while interacting with canvas
      if (e.touches.length > 0) {
        const pos = getPos(e.touches[0]);
        startRef.current = pos;
        setPointer({ ...pos, isDown: true, isDragging: false });
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length > 0) {
        const pos = getPos(e.touches[0]);
        setPointer({
          ...pos,
          isDown: true,
          isDragging: startRef.current !== null,
        });
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      startRef.current = null;
      setPointer((prev) => ({ ...prev, isDown: false, isDragging: false }));
    };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseUp);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, [canvasRef]);

  return pointer;
}