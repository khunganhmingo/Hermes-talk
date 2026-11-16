import { useEffect, useRef } from 'react';
import type { AppStatus } from '../types';

interface WaveformCanvasProps {
  status: AppStatus;
  audioLevelRef: React.MutableRefObject<number>;
}

export function WaveformCanvas({ status, audioLevelRef }: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const statusRef = useRef<AppStatus>(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let phase = 0;
    let smoothedLevel = 0.1;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const layers = [
      { freq: 1.65, speed: 1.0, ampScale: 1.0, phaseOffset: 0.0, alpha: 0.92, lineWidth: 2.2, fillAlpha: 0.22 },
      { freq: 2.25, speed: -0.82, ampScale: 0.78, phaseOffset: 1.4, alpha: 0.72, lineWidth: 1.6, fillAlpha: 0.14 },
      { freq: 1.2, speed: 0.64, ampScale: 0.6, phaseOffset: 2.7, alpha: 0.52, lineWidth: 1.2, fillAlpha: 0.09 },
    ];

    const render = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      const currentStatus = statusRef.current;
      let target = audioLevelRef.current;

      if (currentStatus === 'speaking') {
        target = Math.max(target, 0.42 + Math.sin(phase * 2.1) * 0.18);
      } else if (currentStatus === 'thinking' || currentStatus === 'connecting') {
        target = 0.28 + Math.sin(phase * 1.4) * 0.08;
      } else if (currentStatus === 'idle') {
        target = 0.11 + Math.sin(phase * 0.65) * 0.03;
      } else if (currentStatus === 'listening') {
        target = Math.max(0.16, target);
      }

      smoothedLevel += (target - smoothedLevel) * 0.15;
      const maxAmp = height * 0.37 * Math.min(1.25, smoothedLevel * 1.55);

      for (let idx = 0; idx < layers.length; idx++) {
        const layer = layers[idx];

        const strokeGrad = ctx.createLinearGradient(0, centerY, width, centerY);
        strokeGrad.addColorStop(0.0, 'rgba(56, 189, 248, 0.04)');
        strokeGrad.addColorStop(0.22, `rgba(56, 189, 248, ${layer.alpha})`);
        strokeGrad.addColorStop(0.5, `rgba(99, 102, 241, ${layer.alpha})`);
        strokeGrad.addColorStop(0.78, `rgba(168, 85, 247, ${layer.alpha})`);
        strokeGrad.addColorStop(1.0, 'rgba(168, 85, 247, 0.04)');

        const fillGrad = ctx.createLinearGradient(0, centerY - maxAmp, 0, centerY + maxAmp);
        fillGrad.addColorStop(0, `rgba(56, 189, 248, ${layer.fillAlpha})`);
        fillGrad.addColorStop(0.5, `rgba(99, 102, 241, ${layer.fillAlpha * 1.2})`);
        fillGrad.addColorStop(1, `rgba(168, 85, 247, ${layer.fillAlpha})`);

        const pointsTop: Array<{ x: number; y: number }> = [];
        const pointsBottom: Array<{ x: number; y: number }> = [];
        const step = 3;

        for (let x = 0; x <= width; x += step) {
          const normX = (x / width) * 2 - 1;
          const envelope = Math.pow(Math.max(0, 1 - normX * normX), 2.25);
          const wave1 = Math.sin(normX * Math.PI * layer.freq + phase * layer.speed + layer.phaseOffset);
          const wave2 = Math.cos(normX * Math.PI * (layer.freq * 1.7) - phase * 0.72);
          const yOffset = envelope * maxAmp * layer.ampScale * (0.68 * wave1 + 0.32 * wave2);

          pointsTop.push({ x, y: centerY - Math.abs(yOffset) - envelope * 2 });
          pointsBottom.push({ x, y: centerY + Math.abs(yOffset) + envelope * 2 });
        }

        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < pointsTop.length; i++) {
          const pt = pointsTop[i];
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
        for (let i = pointsBottom.length - 1; i >= 0; i--) {
          ctx.lineTo(pointsBottom[i].x, pointsBottom[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = fillGrad;
        ctx.fill();

        ctx.shadowBlur = idx === 0 ? 16 : 6;
        ctx.shadowColor = idx === 0 ? 'rgba(56, 189, 248, 0.6)' : 'rgba(168, 85, 247, 0.4)';
        ctx.strokeStyle = strokeGrad;
        ctx.lineWidth = layer.lineWidth;

        ctx.beginPath();
        for (let i = 0; i < pointsTop.length; i++) {
          const pt = pointsTop[i];
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();

        ctx.beginPath();
        for (let i = 0; i < pointsBottom.length; i++) {
          const pt = pointsBottom[i];
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
        ctx.restore();
      }

      if (currentStatus === 'speaking') phase += 0.085;
      else if (currentStatus === 'thinking' || currentStatus === 'connecting') phase += 0.065;
      else if (currentStatus === 'listening') phase += 0.05;
      else phase += 0.032;

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      observer.disconnect();
    };
  }, [audioLevelRef]);

  return (
    <div className="relative w-full h-36 sm:h-44 shrink-0 flex items-center justify-center overflow-hidden select-none">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
