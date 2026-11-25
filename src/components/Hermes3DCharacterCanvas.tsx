import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { AppStatus } from '../types';
import { buildHermesCharacter } from './three/buildHermesCharacter';
import { createHermesCharacterTextures } from './three/hermesCharacterTextures';

interface Hermes3DCharacterCanvasProps {
  status: AppStatus;
  audioLevelRef: React.MutableRefObject<number>;
  isAdminView: boolean;
}

const _raycaster = new THREE.Raycaster();
const _pointerNdc = new THREE.Vector2();
const _cyanColor = new THREE.Color(0x38bdf8);
const _violetColor = new THREE.Color(0xa855f7);
const _skyColor = new THREE.Color(0x7dd3fc);

function detectSoftwareWebGL(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export function Hermes3DCharacterCanvas({
  status,
  audioLevelRef,
  isAdminView,
}: Hermes3DCharacterCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<AppStatus>(status);
  const isAdminRef = useRef<boolean>(isAdminView);
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    isAdminRef.current = isAdminView;
  }, [isAdminView]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const isSoftwareGl = detectSoftwareWebGL();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x07090f, 1);

    const initWidth = Math.max(1, container.clientWidth);
    const initHeight = Math.max(1, container.clientHeight);
    renderer.setSize(initWidth, initHeight);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07090f);
    scene.fog = new THREE.FogExp2(0x07090f, 0.085);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(38, initWidth / initHeight, 0.1, 40);
    camera.position.set(0, 1.06, 3.35);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.94, 0);
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.minDistance = 2.0;
    controls.maxDistance = 4.6;
    controls.minPolarAngle = Math.PI * 0.22;
    controls.maxPolarAngle = Math.PI * 0.72;
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.075;
    controls.rotateSpeed = 0.85;
    controls.update();

    // 3-Point Studio Lighting + Cyan/Violet Voice-Reactive Rim Lights
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x0f172a, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e8, 1.85);
    keyLight.position.set(2.4, 3.2, 3.6);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.width = 1024;
      keyLight.shadow.mapSize.height = 1024;
      keyLight.shadow.camera.near = 0.5;
      keyLight.shadow.camera.far = 12;
      keyLight.shadow.camera.left = -1.6;
      keyLight.shadow.camera.right = 1.6;
      keyLight.shadow.camera.top = 2.4;
      keyLight.shadow.camera.bottom = -0.5;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const cyanRimLight = new THREE.DirectionalLight(0x38bdf8, 1.4);
    cyanRimLight.position.set(-2.6, 1.8, -2.2);
    scene.add(cyanRimLight);

    const violetRimLight = new THREE.PointLight(0xa855f7, 2.2, 8, 1.8);
    violetRimLight.position.set(1.8, 1.4, -1.8);
    scene.add(violetRimLight);

    const frontFaceFill = new THREE.PointLight(0xe0f2fe, 0.65, 6, 2);
    frontFaceFill.position.set(0, 1.25, 2.2);
    scene.add(frontFaceFill);

    // Procedural Textures & Articulated 3D Character Rig
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const textures = createHermesCharacterTextures(maxAniso);
    const rig = buildHermesCharacter(textures);
    scene.add(rig.rootGroup);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Pointer hover head tracking + tap raycast interaction state
    const hoverTarget = { x: 0, y: 0 };
    let isPointerDown = false;
    let pointerDownPos = { x: 0, y: 0 };
    let interactionImpulse = 0; // Tap wave/happy reaction timer (0..1)
    let blinkTimer = 2.4;
    let blinkProgress = 0; // 0 = open, 1 = closed
    let isBlinking = false;
    let smoothedAudio = 0.06;
    let voicePhase = 0;
    let contextLost = false;

    const handlePointerDown = (e: PointerEvent) => {
      isPointerDown = true;
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const handlePointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      if (!isPointerDown) {
        hoverTarget.x = THREE.MathUtils.clamp(nx, -1, 1);
        hoverTarget.y = THREE.MathUtils.clamp(ny, -1, 1);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      isPointerDown = false;

      // Short tap/click on character triggers interactive wave + blink + energy pulse
      if (dist < 8 && !isAdminRef.current) {
        const rect = renderer.domElement.getBoundingClientRect();
        _pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        _pointerNdc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        _raycaster.setFromCamera(_pointerNdc, camera);
        const hits = _raycaster.intersectObjects(rig.interactiveTargets, true);
        if (hits.length > 0) {
          interactionImpulse = 1.0;
          isBlinking = true;
          blinkProgress = 0;
        }
      }
    };

    const handlePointerLeave = () => {
      isPointerDown = false;
      hoverTarget.x = 0;
      hoverTarget.y = 0;
    };

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
    };

    const handleContextRestored = () => {
      contextLost = false;
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave);
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(1, Math.floor(entry.contentRect.width));
        const h = Math.max(1, Math.floor(entry.contentRect.height));
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    resizeObserver.observe(container);

    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      if (!sync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const poll = () => {
        if (disposed) {
          gl.deleteSync(sync);
          return;
        }
        const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const tick = () => {
      if (disposed) return;

      const delta = Math.min(0.05, clock.getDelta());
      const elapsed = clock.getElapsedTime();

      if (!contextLost) {
        const currentStatus = statusRef.current;
        const adminView = isAdminRef.current;
        const rawAudio = audioLevelRef.current;

        let targetAudio = 0.05;
        if (!adminView) {
          if (currentStatus === 'speaking') {
            targetAudio = Math.max(0.24, Math.min(1.2, rawAudio));
          } else if (currentStatus === 'listening') {
            targetAudio = Math.max(0.14, Math.min(1.0, rawAudio));
          } else if (currentStatus === 'thinking' || currentStatus === 'connecting') {
            targetAudio = 0.25 + Math.sin(elapsed * 3.2) * 0.08;
          }
        }

        smoothedAudio = THREE.MathUtils.damp(smoothedAudio, targetAudio, 12, delta);
        voicePhase += delta * (4.5 + smoothedAudio * 10);

        if (interactionImpulse > 0) {
          interactionImpulse = Math.max(0, interactionImpulse - delta * 0.72);
        }

        // Natural Eyelid Blink Cycle
        blinkTimer -= delta;
        if (blinkTimer <= 0 && !isBlinking) {
          isBlinking = true;
          blinkProgress = 0;
          blinkTimer = 2.6 + (elapsed % 2.4);
        }
        if (isBlinking) {
          blinkProgress += delta * 9.5;
          const closedFactor = Math.sin(Math.min(1, blinkProgress) * Math.PI);
          const lidAngle = THREE.MathUtils.lerp(-Math.PI * 0.48, 0.08, closedFactor);
          rig.leftEyelid.rotation.x = lidAngle;
          rig.rightEyelid.rotation.x = lidAngle;
          if (blinkProgress >= 1) {
            isBlinking = false;
            rig.leftEyelid.rotation.x = -Math.PI * 0.48;
            rig.rightEyelid.rotation.x = -Math.PI * 0.48;
          }
        }

        if (!prefersReduced) {
          const isSpeaking = currentStatus === 'speaking';
          const isListening = currentStatus === 'listening';
          const isThinking = currentStatus === 'thinking' || currentStatus === 'connecting';

          // Subtle breathing & levitation lift
          const breath = Math.sin(elapsed * 1.8) * 0.012;
          rig.bodyGroup.position.y = breath + (isSpeaking ? smoothedAudio * 0.014 : 0);

          // Torso gentle sway + attentive listening lean
          const targetTorsoRotX = isListening ? 0.06 : isSpeaking ? Math.sin(voicePhase * 0.4) * 0.035 : 0.015;
          const targetTorsoRotY = hoverTarget.x * 0.12 + Math.sin(elapsed * 0.7) * 0.03;
          rig.torsoGroup.rotation.x = THREE.MathUtils.damp(rig.torsoGroup.rotation.x, targetTorsoRotX, 6, delta);
          rig.torsoGroup.rotation.y = THREE.MathUtils.damp(rig.torsoGroup.rotation.y, targetTorsoRotY, 6, delta);

          // Head expressive tracking + speech cadence nod + tap happy tilt
          const speechNod = isSpeaking ? Math.sin(voicePhase * 0.85) * (0.04 + smoothedAudio * 0.06) : 0;
          const speechYaw = isSpeaking ? Math.cos(voicePhase * 0.5) * (0.04 + smoothedAudio * 0.05) : 0;
          const listenTilt = isListening ? 0.085 : isThinking ? -0.09 : 0;
          const tapNod = interactionImpulse > 0 ? Math.sin(interactionImpulse * Math.PI * 2) * 0.12 : 0;

          const desiredHeadY = hoverTarget.x * 0.24 + speechYaw + Math.sin(elapsed * 0.85) * 0.045;
          const desiredHeadX = -hoverTarget.y * 0.14 + speechNod + tapNod + (isListening ? 0.05 : 0);
          const desiredHeadZ = listenTilt + Math.cos(elapsed * 0.65) * 0.025;

          rig.headGroup.rotation.y = THREE.MathUtils.damp(rig.headGroup.rotation.y, desiredHeadY, 7, delta);
          rig.headGroup.rotation.x = THREE.MathUtils.damp(rig.headGroup.rotation.x, desiredHeadX, 7, delta);
          rig.headGroup.rotation.z = THREE.MathUtils.damp(rig.headGroup.rotation.z, desiredHeadZ, 6, delta);

          // High Hair Bun secondary follow-through
          rig.hairBunGroup.rotation.z = -rig.headGroup.rotation.z * 0.55 + Math.sin(elapsed * 1.9) * 0.025;
          rig.hairBunGroup.rotation.x = -rig.headGroup.rotation.x * 0.4;

          // Articulated Arm Wave on Tap/Click or Speaking Expressiveness
          const waveLift = interactionImpulse > 0 ? Math.sin(interactionImpulse * Math.PI) * 1.15 : 0;
          const waveOsc = interactionImpulse > 0 ? Math.sin(elapsed * 11) * 0.18 * interactionImpulse : 0;
          const speakArmGesture = isSpeaking ? smoothedAudio * 0.16 : 0;

          rig.rightArmGroup.rotation.z = THREE.MathUtils.damp(
            rig.rightArmGroup.rotation.z,
            0.08 + waveLift + waveOsc + speakArmGesture,
            8,
            delta
          );
          rig.rightArmGroup.rotation.x = THREE.MathUtils.damp(
            rig.rightArmGroup.rotation.x,
            -waveLift * 0.35 - speakArmGesture * 0.5,
            8,
            delta
          );
          rig.leftArmGroup.rotation.z = THREE.MathUtils.damp(
            rig.leftArmGroup.rotation.z,
            -0.08 - speakArmGesture * 0.7,
            7,
            delta
          );

          // Lip Sync & Voice Modulation
          const mouthOpen = isSpeaking
            ? Math.max(0.18, (0.35 + 0.65 * Math.abs(Math.sin(voicePhase * 1.35))) * smoothedAudio)
            : interactionImpulse > 0
              ? 0.45 * Math.sin(interactionImpulse * Math.PI)
              : 0.08;
          rig.mouthInner.scale.y = THREE.MathUtils.damp(rig.mouthInner.scale.y, 0.2 + mouthOpen * 0.95, 16, delta);
          rig.mouthLowerLip.position.y = THREE.MathUtils.damp(
            rig.mouthLowerLip.position.y,
            -mouthOpen * 0.018,
            16,
            delta
          );

          // Emissive Headphones, Chest "H" Core & Back Halo Rings React to Voice
          const energyPulse = isSpeaking || isListening ? smoothedAudio : interactionImpulse * 0.8;
          rig.earGlowMat.emissiveIntensity = 1.2 + energyPulse * 2.2;
          rig.collarGlowMat.emissiveIntensity = 1.0 + energyPulse * 1.6;
          rig.chestEmblemMat.emissiveIntensity = 1.0 + energyPulse * 2.0;

          if (isListening) {
            rig.earGlowMat.emissive.lerp(_violetColor, 0.12);
          } else {
            rig.earGlowMat.emissive.lerp(_cyanColor, 0.12);
          }

          const haloScale = 1 + energyPulse * 0.16 + Math.sin(elapsed * 2.2) * 0.015;
          rig.haloOuterRing.scale.setScalar(THREE.MathUtils.damp(rig.haloOuterRing.scale.x, haloScale, 9, delta));
          rig.haloInnerRing.scale.setScalar(
            THREE.MathUtils.damp(rig.haloInnerRing.scale.x, 1 + energyPulse * 0.1, 9, delta)
          );
          rig.haloOuterRing.rotation.z += delta * (0.28 + energyPulse * 0.9);
          rig.haloInnerRing.rotation.z -= delta * (0.42 + energyPulse * 1.15);
          rig.haloOuterRing.rotation.x = Math.sin(elapsed * 0.9) * 0.14;
          rig.haloInnerRing.rotation.y = Math.cos(elapsed * 0.8) * 0.16;

          rig.haloOuterMat.emissiveIntensity = 1.1 + energyPulse * 1.9;
          rig.haloInnerMat.emissiveIntensity = 1.0 + energyPulse * 1.7;

          // Swirling Particle Field
          rig.orbParticles.rotation.y += delta * (0.14 + energyPulse * 0.55);
          rig.orbParticlesMat.opacity = 0.45 + energyPulse * 0.45;
          if (isListening) {
            rig.orbParticlesMat.color.lerp(_violetColor, 0.08);
          } else {
            rig.orbParticlesMat.color.lerp(_skyColor, 0.08);
          }

          // Dynamic Rim Lights Brightness
          cyanRimLight.intensity = 1.2 + energyPulse * 1.4;
          violetRimLight.intensity = 1.8 + energyPulse * 2.2;
        }

        controls.update();
        renderer.render(scene, camera);
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    if (isSoftwareGl) {
      afterDraw(tick);
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);

      controls.dispose();
      rig.dispose();
      textures.dispose();
      envTarget.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [audioLevelRef]);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden bg-[#07090F]">
      {webglUnavailable ? (
        <div
          className="w-full h-full flex items-center justify-center"
          style={{
            background:
              'radial-gradient(circle at 50% 30%, rgba(56, 189, 248, 0.22) 0%, rgba(168, 85, 247, 0.14) 38%, #07090F 78%)',
          }}
        />
      ) : (
        <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      )}

      {/* Subtle Bottom & Top Scrims for UI Readability */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[#07090F]/80 via-[#07090F]/30 to-transparent" />
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 transition-all duration-500 ${
          isAdminView
            ? 'inset-y-0 bg-[#07090F]/85'
            : 'h-[46%] bg-gradient-to-t from-[#07090F] via-[#07090F]/70 to-transparent'
        }`}
      />
    </div>
  );
}
