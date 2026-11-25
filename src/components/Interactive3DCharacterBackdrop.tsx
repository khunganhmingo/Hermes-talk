import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import hermesGirlBackdrop from '../assets/images/hermes_girl_backdrop_1795422230464.jpg';
import type { AppStatus } from '../types';

export interface TiltTarget {
  x: number; // -1 to 1 (horizontal drag/pointer offset -> rotateY)
  y: number; // -1 to 1 (vertical drag/pointer offset -> rotateX)
  active: boolean;
}

interface Interactive3DCharacterBackdropProps {
  status: AppStatus;
  audioLevelRef: React.MutableRefObject<number>;
  tiltTargetRef: React.MutableRefObject<TiltTarget>;
  isAdminView: boolean;
}

export function Interactive3DCharacterBackdrop({
  status,
  audioLevelRef,
  tiltTargetRef,
  isAdminView,
}: Interactive3DCharacterBackdropProps) {
  const [backdropFailed, setBackdropFailed] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const haloLayerRef = useRef<HTMLDivElement | null>(null);
  const voiceRingOuterRef = useRef<HTMLDivElement | null>(null);
  const voiceRingInnerRef = useRef<HTMLDivElement | null>(null);
  const sheenLayerRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<AppStatus>(status);
  const isAdminRef = useRef<boolean>(isAdminView);

  // Framer Motion spring values for smooth multi-directional pointer/touch tilt
  const rawPointerX = useMotionValue(0);
  const rawPointerY = useMotionValue(0);
  const springX = useSpring(rawPointerX, { stiffness: 120, damping: 18, mass: 0.7 });
  const springY = useSpring(rawPointerY, { stiffness: 120, damping: 18, mass: 0.7 });

  const tiltRotateY = useTransform(springX, [-1, 1], [-13, 13]);
  const tiltRotateX = useTransform(springY, [-1, 1], [10, -10]);
  const tiltRotateZ = useTransform(springX, [-1, 1], [-2.5, 2.5]);
  const sheenX = useTransform(springX, [-1, 1], [35, 65]);
  const sheenY = useTransform(springY, [-1, 1], [15, 45]);
  const sheenGradient = useTransform(
    [sheenX, sheenY],
    ([x, y]) =>
      `radial-gradient(circle at ${x}% ${y}%, rgba(125, 211, 252, 0.22) 0%, rgba(168, 85, 247, 0.1) 34%, transparent 66%)`
  );

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    isAdminRef.current = isAdminView;
  }, [isAdminView]);

  // Combined 60fps multi-directional 3D sway + voice-reactive kinematics loop
  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let rafId = 0;
    let phase = 0;
    let voicePhase = 0;
    let smoothedLevel = 0.08;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      // Sync interactive pointer/touch tilt target into Framer Motion springs
      const target = tiltTargetRef.current;
      rawPointerX.set(target.x);
      rawPointerY.set(target.y);

      const currentStatus = statusRef.current;
      const adminMode = isAdminRef.current;
      const rawAudio = audioLevelRef.current;

      // Normalize voice energy based on conversation state
      let targetLevel = 0.06;
      if (!adminMode) {
        if (currentStatus === 'speaking') {
          targetLevel = Math.max(0.28, Math.min(1.15, rawAudio));
        } else if (currentStatus === 'listening') {
          targetLevel = Math.max(0.16, Math.min(1.0, rawAudio));
        } else if (currentStatus === 'thinking' || currentStatus === 'connecting') {
          targetLevel = 0.22 + Math.sin(phase * 2.1) * 0.08;
        }
      }

      smoothedLevel += (targetLevel - smoothedLevel) * Math.min(1, dt * 11);

      if (!prefersReduced) {
        phase += dt * (currentStatus === 'speaking' ? 1.55 : currentStatus === 'listening' ? 1.15 : 0.72);
        voicePhase += dt * (3.2 + smoothedLevel * 4.5);
      }

      // Gentle continuous multi-directional 3D CSS transform (yaw, pitch, roll, depth)
      if (stageRef.current) {
        if (prefersReduced || adminMode) {
          stageRef.current.style.transform = 'translate3d(0px, 0px, 0px) scale(1.06)';
        } else {
          const isVoiceActive = currentStatus === 'speaking' || currentStatus === 'listening';
          const voiceBoost = isVoiceActive ? smoothedLevel : 0;

          // Lissajous multi-axis 3D rotation for lifelike presence
          const ambientYaw = Math.sin(phase * 0.85) * 3.4 + Math.cos(phase * 0.43) * 1.3;
          const ambientPitch = Math.cos(phase * 0.68) * 2.5 + Math.sin(phase * 0.37) * 0.9;
          const ambientRoll = Math.sin(phase * 0.52) * 1.1;

          // Speech cadence nod & attentive listening lean
          const speechNod =
            currentStatus === 'speaking'
              ? Math.sin(voicePhase) * (1.2 + voiceBoost * 2.4)
              : currentStatus === 'listening'
                ? 1.4 + voiceBoost * 1.8
                : 0;

          const speechSway =
            currentStatus === 'speaking'
              ? Math.cos(voicePhase * 0.65) * (0.9 + voiceBoost * 1.8)
              : 0;

          const floatY = Math.sin(phase * 0.9) * 4.5 - voiceBoost * 5.0;
          const floatX = Math.cos(phase * 0.6) * 3.0 + speechSway * 1.6;
          const breathScale =
            1.085 + Math.sin(phase * 0.9) * 0.012 + voiceBoost * 0.036;

          stageRef.current.style.transform =
            `translate3d(${floatX.toFixed(2)}px, ${floatY.toFixed(2)}px, 0px) ` +
            `rotateX(${(ambientPitch + speechNod).toFixed(2)}deg) ` +
            `rotateY(${(ambientYaw + speechSway).toFixed(2)}deg) ` +
            `rotateZ(${ambientRoll.toFixed(2)}deg) ` +
            `scale(${breathScale.toFixed(4)})`;
        }
      }

      // Back depth layer: holographic energy halo + voice-reactive concentric pulse
      if (haloLayerRef.current) {
        const haloScale = 1 + smoothedLevel * 0.12 + (prefersReduced ? 0 : Math.sin(phase * 1.1) * 0.02);
        const haloRotate = prefersReduced ? 0 : Math.sin(phase * 0.4) * 8;
        haloLayerRef.current.style.transform = `translate3d(0, 0, -40px) scale(${haloScale.toFixed(3)}) rotateZ(${haloRotate.toFixed(2)}deg)`;
      }

      // Voice-reactive concentric aura rings centered around the character's head/headphones
      if (voiceRingOuterRef.current) {
        const activeRing = !adminMode && (currentStatus === 'speaking' || currentStatus === 'listening' || currentStatus === 'thinking');
        const outerScale = activeRing ? 0.96 + smoothedLevel * 0.34 + Math.sin(voicePhase * 0.8) * 0.03 : 0.92;
        const outerOpacity = activeRing ? Math.min(0.82, 0.16 + smoothedLevel * 0.68) : 0.14;
        voiceRingOuterRef.current.style.transform = `scale(${outerScale.toFixed(3)})`;
        voiceRingOuterRef.current.style.opacity = outerOpacity.toFixed(3);
      }

      if (voiceRingInnerRef.current) {
        const activeRing = !adminMode && (currentStatus === 'speaking' || currentStatus === 'listening' || currentStatus === 'thinking');
        const innerScale = activeRing ? 0.98 + smoothedLevel * 0.22 + Math.cos(voicePhase) * 0.02 : 0.96;
        const innerOpacity = activeRing ? Math.min(0.95, 0.24 + smoothedLevel * 0.72) : 0.18;
        voiceRingInnerRef.current.style.transform = `scale(${innerScale.toFixed(3)})`;
        voiceRingInnerRef.current.style.opacity = innerOpacity.toFixed(3);
      }

      if (sheenLayerRef.current) {
        const sheenOpacity = adminMode ? 0.15 : 0.45 + smoothedLevel * 0.5;
        sheenLayerRef.current.style.opacity = Math.min(1, sheenOpacity).toFixed(3);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [audioLevelRef, rawPointerX, rawPointerY, tiltTargetRef]);

  const isVoiceReactive = status === 'speaking' || status === 'listening';

  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-[#07090F]"
      style={{ perspective: '1050px' }}
    >
      {/* Interactive 3D Transform Wrapper driven by Framer Motion Springs */}
      <motion.div
        style={{
          rotateX: isAdminView ? 0 : tiltRotateX,
          rotateY: isAdminView ? 0 : tiltRotateY,
          rotateZ: isAdminView ? 0 : tiltRotateZ,
          transformStyle: 'preserve-3d',
        }}
        className="relative w-full h-full will-change-transform"
      >
        {/* Depth Layer 1 (Back): Voice-Reactive Halo & Energy Field */}
        <div
          ref={haloLayerRef}
          className="absolute inset-0 flex items-start justify-center pt-[7%] pointer-events-none will-change-transform"
          style={{ transformStyle: 'preserve-3d' }}
        >
          <div className="relative w-72 h-72 flex items-center justify-center">
            <div
              ref={voiceRingOuterRef}
              className={`absolute inset-0 rounded-full border transition-colors duration-300 ${
                status === 'speaking'
                  ? 'border-cyan-300/60 shadow-[0_0_55px_rgba(56,189,248,0.45)]'
                  : status === 'listening'
                    ? 'border-purple-400/55 shadow-[0_0_50px_rgba(168,85,247,0.42)]'
                    : 'border-sky-400/25 shadow-[0_0_32px_rgba(56,189,248,0.2)]'
              }`}
            />
            <div
              ref={voiceRingInnerRef}
              className={`absolute inset-6 rounded-full border-2 transition-colors duration-300 ${
                status === 'speaking'
                  ? 'border-sky-300/75 shadow-[0_0_38px_rgba(56,189,248,0.55)]'
                  : status === 'listening'
                    ? 'border-sky-400/65 shadow-[0_0_35px_rgba(56,189,248,0.45)]'
                    : 'border-indigo-400/25'
              }`}
            />
          </div>
        </div>

        {/* Depth Layer 2 (Hero Center): Continuous Multi-Axis 3D Character Image */}
        <div
          ref={stageRef}
          className="relative w-full h-full will-change-transform"
          style={{ transformStyle: 'preserve-3d' }}
        >
          {!backdropFailed && (
            <img
              src={hermesGirlBackdrop}
              alt="Hình nền 3D trợ lý AI Hermes"
              referrerPolicy="no-referrer"
              onError={() => setBackdropFailed(true)}
              draggable={false}
              className={`w-full h-full object-cover object-[50%_12%] select-none transition-[opacity,filter] duration-500 ${
                isAdminView
                  ? 'opacity-20 blur-[2px]'
                  : isVoiceReactive
                    ? 'opacity-95 brightness-105 saturate-110'
                    : 'opacity-85'
              }`}
            />
          )}
        </div>

        {/* Depth Layer 3 (Front): Interactive Specular Sheen & Voice Glow */}
        <motion.div
          ref={sheenLayerRef}
          className="absolute inset-0 pointer-events-none"
          style={{
            background: sheenGradient,
            transform: 'translateZ(42px)',
            mixBlendMode: 'screen',
          }}
        />
      </motion.div>

      {/* Ambient Cyan-Violet Reactive Glow */}
      <div
        className={`absolute inset-0 transition-opacity duration-500 ${
          isVoiceReactive ? 'opacity-100' : 'opacity-65'
        }`}
        style={{
          background:
            'radial-gradient(circle at 50% 24%, rgba(56, 189, 248, 0.18) 0%, transparent 48%), radial-gradient(circle at 72% 72%, rgba(168, 85, 247, 0.15) 0%, transparent 52%)',
        }}
      />

      {/* Top Vignette Scrim for Header Legibility */}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#07090F]/85 via-[#07090F]/40 to-transparent" />

      {/* Lower Contrast Scrim for Chat Transcript & Dock */}
      <div
        className={`absolute inset-0 transition-opacity duration-500 ${
          isAdminView
            ? 'bg-[#07090F]/85'
            : 'bg-gradient-to-t from-[#07090F] via-[#07090F]/68 to-transparent'
        }`}
      />
    </div>
  );
}
