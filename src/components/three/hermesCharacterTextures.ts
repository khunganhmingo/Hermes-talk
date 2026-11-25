import * as THREE from 'three';

export interface HermesCharacterTextures {
  eyeMap: THREE.CanvasTexture;
  emblemMap: THREE.CanvasTexture;
  suitPatternMap: THREE.CanvasTexture;
  glowDiscMap: THREE.CanvasTexture;
  dispose: () => void;
}

export function createHermesCharacterTextures(anisotropy: number): HermesCharacterTextures {
  // 1. Stylized expressive iris texture
  const eyeCanvas = document.createElement('canvas');
  eyeCanvas.width = 512;
  eyeCanvas.height = 512;
  const ectx = eyeCanvas.getContext('2d');
  if (ectx) {
    // Sclera base
    ectx.fillStyle = '#F8FAFC';
    ectx.fillRect(0, 0, 512, 512);

    const cx = 256;
    const cy = 256;

    // Outer dark iris ring
    const irisGrad = ectx.createRadialGradient(cx, cy - 16, 28, cx, cy, 185);
    irisGrad.addColorStop(0, '#1C100B');
    irisGrad.addColorStop(0.35, '#3E2216');
    irisGrad.addColorStop(0.74, '#6B3B25');
    irisGrad.addColorStop(0.92, '#2B160F');
    irisGrad.addColorStop(1, '#120A07');

    ectx.beginPath();
    ectx.arc(cx, cy, 184, 0, Math.PI * 2);
    ectx.fillStyle = irisGrad;
    ectx.fill();

    // Subtle warm amber lower iris bounce light
    const lowerGlow = ectx.createRadialGradient(cx, cy + 72, 10, cx, cy + 72, 110);
    lowerGlow.addColorStop(0, 'rgba(251, 191, 36, 0.42)');
    lowerGlow.addColorStop(0.55, 'rgba(56, 189, 248, 0.22)');
    lowerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ectx.beginPath();
    ectx.arc(cx, cy, 176, 0, Math.PI * 2);
    ectx.fillStyle = lowerGlow;
    ectx.fill();

    // Deep pupil
    ectx.beginPath();
    ectx.arc(cx, cy + 4, 68, 0, Math.PI * 2);
    ectx.fillStyle = '#090607';
    ectx.fill();

    // Crisp main specular catchlight + secondary micro catchlight
    ectx.beginPath();
    ectx.ellipse(cx - 56, cy - 62, 34, 26, -0.35, 0, Math.PI * 2);
    ectx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ectx.fill();

    ectx.beginPath();
    ectx.arc(cx + 52, cy + 54, 16, 0, Math.PI * 2);
    ectx.fillStyle = 'rgba(224, 242, 254, 0.85)';
    ectx.fill();
  }
  const eyeMap = new THREE.CanvasTexture(eyeCanvas);
  eyeMap.colorSpace = THREE.SRGBColorSpace;
  eyeMap.anisotropy = anisotropy;

  // 2. Glowing "H" chest core emblem
  const embCanvas = document.createElement('canvas');
  embCanvas.width = 512;
  embCanvas.height = 512;
  const hctx = embCanvas.getContext('2d');
  if (hctx) {
    hctx.fillStyle = '#071529';
    hctx.fillRect(0, 0, 512, 512);

    const cx = 256;
    const cy = 256;

    const bgGlow = hctx.createRadialGradient(cx, cy, 24, cx, cy, 240);
    bgGlow.addColorStop(0, 'rgba(56, 189, 248, 0.45)');
    bgGlow.addColorStop(0.55, 'rgba(37, 99, 235, 0.22)');
    bgGlow.addColorStop(1, 'rgba(7, 21, 41, 1)');
    hctx.fillStyle = bgGlow;
    hctx.fillRect(0, 0, 512, 512);

    // Outer metallic/glow ring
    hctx.strokeStyle = '#38BDF8';
    hctx.lineWidth = 22;
    hctx.shadowColor = '#38BDF8';
    hctx.shadowBlur = 24;
    hctx.beginPath();
    hctx.arc(cx, cy, 206, 0, Math.PI * 2);
    hctx.stroke();

    // Inner violet accent ring
    hctx.strokeStyle = '#A78BFA';
    hctx.lineWidth = 6;
    hctx.shadowBlur = 12;
    hctx.beginPath();
    hctx.arc(cx, cy, 174, 0, Math.PI * 2);
    hctx.stroke();

    // Bold futuristic "H" lettermark
    hctx.shadowColor = '#7DD3FC';
    hctx.shadowBlur = 28;
    hctx.fillStyle = '#E0F2FE';
    hctx.fillRect(cx - 86, cy - 102, 42, 204);
    hctx.fillRect(cx + 44, cy - 102, 42, 204);
    hctx.fillRect(cx - 50, cy - 21, 100, 42);
  }
  const emblemMap = new THREE.CanvasTexture(embCanvas);
  emblemMap.colorSpace = THREE.SRGBColorSpace;
  emblemMap.anisotropy = anisotropy;

  // 3. Subtle ceramic/carbon tech suit micro-grid texture
  const suitCanvas = document.createElement('canvas');
  suitCanvas.width = 256;
  suitCanvas.height = 256;
  const sctx = suitCanvas.getContext('2d');
  if (sctx) {
    sctx.fillStyle = '#E8EEF8';
    sctx.fillRect(0, 0, 256, 256);
    sctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    sctx.lineWidth = 1;
    for (let i = 0; i <= 256; i += 32) {
      sctx.beginPath();
      sctx.moveTo(i, 0);
      sctx.lineTo(i, 256);
      sctx.stroke();
      sctx.beginPath();
      sctx.moveTo(0, i);
      sctx.lineTo(256, i);
      sctx.stroke();
    }
  }
  const suitPatternMap = new THREE.CanvasTexture(suitCanvas);
  suitPatternMap.wrapS = THREE.RepeatWrapping;
  suitPatternMap.wrapT = THREE.RepeatWrapping;
  suitPatternMap.repeat.set(3, 3);
  suitPatternMap.colorSpace = THREE.SRGBColorSpace;
  suitPatternMap.anisotropy = anisotropy;

  // 4. Radial soft halo glow disc texture
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 256;
  glowCanvas.height = 256;
  const gctx = glowCanvas.getContext('2d');
  if (gctx) {
    const grad = gctx.createRadialGradient(128, 128, 8, 128, 128, 128);
    grad.addColorStop(0, 'rgba(125, 211, 252, 0.72)');
    grad.addColorStop(0.35, 'rgba(56, 189, 248, 0.28)');
    grad.addColorStop(0.7, 'rgba(168, 85, 247, 0.12)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 256, 256);
  }
  const glowDiscMap = new THREE.CanvasTexture(glowCanvas);
  glowDiscMap.colorSpace = THREE.SRGBColorSpace;

  return {
    eyeMap,
    emblemMap,
    suitPatternMap,
    glowDiscMap,
    dispose: () => {
      eyeMap.dispose();
      emblemMap.dispose();
      suitPatternMap.dispose();
      glowDiscMap.dispose();
    },
  };
}
