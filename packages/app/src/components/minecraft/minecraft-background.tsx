'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';

const MinecraftScene = dynamic(() => import('./minecraft-scene'), {
  ssr: false,
  loading: () => null,
});

const INTERACTIVE =
  'button, a, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="link"], input[type="checkbox"], input[type="radio"], summary';

/**
 * Renders the floating 3D Minecraft blocks background and plays
 * the classic button click sound on interactive element presses.
 * Only active when the minecraft theme is enabled.
 */
export function MinecraftBackground() {
  const [isMinecraft, setIsMinecraft] = useState(false);

  useEffect(() => {
    function check() {
      setIsMinecraft(document.documentElement.classList.contains('minecraft'));
    }
    check();

    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  // Preload the click sound into an AudioBuffer for instant playback
  const audioCtxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);

  useEffect(() => {
    if (!isMinecraft) return;
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    fetch('/minecraft-click.mp3')
      .then((r) => r.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => {
        bufferRef.current = decoded;
      })
      .catch(() => {});
    return () => {
      ctx.close();
      audioCtxRef.current = null;
      bufferRef.current = null;
    };
  }, [isMinecraft]);

  // Play Minecraft click sound on any interactive element press
  useEffect(() => {
    if (!isMinecraft) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(INTERACTIVE)) return;
      const ctx = audioCtxRef.current;
      const buffer = bufferRef.current;
      if (!ctx || !buffer) return;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = 0.5;
      source.buffer = buffer;
      source.connect(gain).connect(ctx.destination);
      source.start();
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [isMinecraft]);

  if (!isMinecraft) return null;

  return (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0, opacity: 0.18 }}>
      <MinecraftScene />
    </div>
  );
}
