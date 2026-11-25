import { useEffect, useRef } from 'react';
import { Mic, MicOff } from 'lucide-react';
import type { AppStatus } from '../types';

interface ReactiveMicButtonProps {
  status: AppStatus;
  statusLabel: string;
  isLiveActive: boolean;
  canUseVoiceLive: boolean;
  audioLevelRef: React.MutableRefObject<number>;
  onClick: () => void;
}

const LEFT_BAR_WEIGHTS = [0.42, 0.72, 0.96];
const RIGHT_BAR_WEIGHTS = [0.96, 0.72, 0.42];

export function ReactiveMicButton({
  status,
  statusLabel,
  isLiveActive,
  canUseVoiceLive,
  audioLevelRef,
  onClick,
}: ReactiveMicButtonProps) {
  const outerRingRef = useRef<HTMLDivElement | null>(null);
  const innerRingRef = useRef<HTMLDivElement | null>(null);
  const barRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const statusRef = useRef<AppStatus>(status);
  const isLiveRef = useRef<boolean>(isLiveActive);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    isLiveRef.current = isLiveActive;
  }, [isLiveActive]);

  useEffect(() => {
    let rafId = 0;
    let phase = 0;
    let smoothed = 0.08;

    const tick = () => {
      const currentStatus = statusRef.current;
      const active = isLiveRef.current || currentStatus !== 'idle';

      let target = 0.06;
      if (active) {
        const raw = audioLevelRef.current;
        if (currentStatus === 'speaking') {
          target = Math.max(raw, 0.45 + Math.sin(phase * 2.2) * 0.18);
        } else if (currentStatus === 'thinking' || currentStatus === 'connecting') {
          target = 0.28 + Math.sin(phase * 1.5) * 0.1;
        } else if (currentStatus === 'listening') {
          target = Math.max(0.18, raw);
        } else {
          target = Math.max(0.16, raw);
        }
      }

      smoothed += (target - smoothed) * 0.2;
      phase += active ? 0.1 : 0.03;

      if (outerRingRef.current) {
        const outerScale = active ? 1 + smoothed * 0.52 + Math.sin(phase) * 0.04 : 1;
        const outerOpacity = active ? Math.min(0.85, 0.22 + smoothed * 0.72) : 0;
        outerRingRef.current.style.transform = `scale(${outerScale.toFixed(3)})`;
        outerRingRef.current.style.opacity = outerOpacity.toFixed(3);
      }

      if (innerRingRef.current) {
        const innerScale = active ? 1 + smoothed * 0.3 + Math.cos(phase * 1.3) * 0.03 : 1;
        const innerOpacity = active ? Math.min(0.95, 0.35 + smoothed * 0.68) : 0;
        innerRingRef.current.style.transform = `scale(${innerScale.toFixed(3)})`;
        innerRingRef.current.style.opacity = innerOpacity.toFixed(3);
      }

      const weights = [...LEFT_BAR_WEIGHTS, ...RIGHT_BAR_WEIGHTS];
      for (let i = 0; i < weights.length; i++) {
        const el = barRefs.current[i];
        if (!el) continue;
        if (!active) {
          el.style.transform = 'scaleY(0.28)';
          el.style.opacity = '0.28';
        } else {
          const wave = 0.55 + 0.45 * Math.sin(phase * 1.9 + i * 0.9);
          const scaleY = Math.max(0.28, Math.min(1.45, 0.28 + smoothed * weights[i] * wave * 1.35));
          el.style.transform = `scaleY(${scaleY.toFixed(3)})`;
          el.style.opacity = Math.min(1, 0.45 + smoothed * 0.65).toFixed(3);
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [audioLevelRef]);

  const isReceivingOrActive = isLiveActive || status !== 'idle';

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative flex items-center justify-center gap-3">
        {/* Left audio ripple bars */}
        <div className="flex items-center gap-1 h-7" aria-hidden="true">
          {LEFT_BAR_WEIGHTS.map((_, idx) => (
            <span
              key={`l-${idx}`}
              ref={(el) => {
                barRefs.current[idx] = el;
              }}
              className="w-1 h-6 rounded-full bg-gradient-to-t from-sky-500 to-cyan-300 origin-center transition-colors"
            />
          ))}
        </div>

        {/* Central Mic Button with reactive concentric sound rings */}
        <div className="relative flex items-center justify-center">
          <div
            ref={outerRingRef}
            aria-hidden="true"
            className="pointer-events-none absolute w-[74px] h-[74px] rounded-full border border-purple-400/50 bg-purple-500/10"
          />
          <div
            ref={innerRingRef}
            aria-hidden="true"
            className="pointer-events-none absolute w-[68px] h-[68px] rounded-full border-2 border-sky-400/70 shadow-[0_0_24px_rgba(56,189,248,0.45)]"
          />

          <button
            type="button"
            onClick={onClick}
            title={
              !canUseVoiceLive && !isLiveActive
                ? 'Cần đăng nhập và được cấp quyền Gemini Live Thoại'
                : isLiveActive
                  ? 'Tạm dừng trò chuyện trực tiếp'
                  : 'Bắt đầu trò chuyện Gemini Live'
            }
            aria-label={isLiveActive ? 'Tắt micro Gemini Live' : 'Bật micro Gemini Live'}
            className={`relative z-10 w-16 h-16 rounded-full border-2 flex items-center justify-center transition-all duration-300 cursor-pointer ${
              isLiveActive
                ? 'bg-gradient-to-br from-sky-500/60 to-purple-500/65 border-sky-300 text-white shadow-[0_0_28px_rgba(56,189,248,0.6)] scale-105'
                : status !== 'idle'
                  ? 'bg-gradient-to-br from-sky-500/50 to-indigo-500/55 border-sky-400 text-white shadow-[0_0_24px_rgba(56,189,248,0.45)]'
                  : !canUseVoiceLive
                    ? 'bg-[#0B1120]/90 border-white/10 text-slate-500'
                    : 'bg-gradient-to-br from-sky-500/35 to-indigo-500/40 hover:from-sky-500/45 hover:to-purple-500/45 border-sky-400/60 text-white shadow-[0_0_20px_rgba(56,189,248,0.28)]'
            }`}
          >
            {isLiveActive ? (
              <MicOff className="w-6 h-6 text-rose-300" />
            ) : (
              <Mic className="w-6 h-6" />
            )}
          </button>
        </div>

        {/* Right audio ripple bars */}
        <div className="flex items-center gap-1 h-7" aria-hidden="true">
          {RIGHT_BAR_WEIGHTS.map((_, idx) => (
            <span
              key={`r-${idx}`}
              ref={(el) => {
                barRefs.current[LEFT_BAR_WEIGHTS.length + idx] = el;
              }}
              className="w-1 h-6 rounded-full bg-gradient-to-t from-indigo-500 to-purple-300 origin-center transition-colors"
            />
          ))}
        </div>
      </div>

      {isReceivingOrActive && (
        <span className="text-[11px] font-medium text-sky-200/90 tracking-wide">
          {statusLabel}
        </span>
      )}
    </div>
  );
}
