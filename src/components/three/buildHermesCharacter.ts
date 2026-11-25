import * as THREE from 'three';
import type { HermesCharacterTextures } from './hermesCharacterTextures';

export interface HermesCharacterRig {
  rootGroup: THREE.Group;
  bodyGroup: THREE.Group;
  torsoGroup: THREE.Group;
  headGroup: THREE.Group;
  hairBunGroup: THREE.Group;
  leftArmGroup: THREE.Group;
  rightArmGroup: THREE.Group;
  leftEyelid: THREE.Mesh;
  rightEyelid: THREE.Mesh;
  mouthInner: THREE.Mesh;
  mouthLowerLip: THREE.Mesh;
  chestEmblemMat: THREE.MeshStandardMaterial;
  earGlowMat: THREE.MeshStandardMaterial;
  collarGlowMat: THREE.MeshStandardMaterial;
  haloOuterRing: THREE.Mesh;
  haloInnerRing: THREE.Mesh;
  haloOuterMat: THREE.MeshStandardMaterial;
  haloInnerMat: THREE.MeshStandardMaterial;
  orbParticles: THREE.Points;
  orbParticlesMat: THREE.PointsMaterial;
  interactiveTargets: THREE.Object3D[];
  dispose: () => void;
}

export function buildHermesCharacter(textures: HermesCharacterTextures): HermesCharacterRig {
  const disposables: Array<{ dispose: () => void }> = [];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    disposables.push(m);
    return m;
  };

  // Curated PBR Materials with intentional roughness/metalness separation
  const skinMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xfde2d2,
      roughness: 0.52,
      metalness: 0.0,
      sheen: 0.35,
      sheenRoughness: 0.65,
      sheenColor: new THREE.Color(0xffbfa8),
      clearcoat: 0.08,
    })
  );

  const blushMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfb8ca2,
      roughness: 0.7,
      metalness: 0.0,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    })
  );

  const lipMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xe36b7c,
      roughness: 0.32,
      metalness: 0.0,
      clearcoat: 0.45,
      clearcoatRoughness: 0.25,
    })
  );

  const hairMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x221512,
      roughness: 0.38,
      metalness: 0.08,
      sheen: 0.6,
      sheenRoughness: 0.35,
      sheenColor: new THREE.Color(0x5c3c31),
    })
  );

  const armorWhiteMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xf1f5fd,
      map: textures.suitPatternMap,
      roughness: 0.18,
      metalness: 0.12,
      clearcoat: 0.92,
      clearcoatRoughness: 0.12,
    })
  );

  const suitNavyMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.74,
      metalness: 0.18,
    })
  );

  const metalSilverMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.22,
      metalness: 0.88,
    })
  );

  const earGlowMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 1.5,
      roughness: 0.15,
      metalness: 0.2,
    })
  );

  const collarGlowMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.2,
      roughness: 0.2,
      metalness: 0.1,
    })
  );

  const chestEmblemMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.emblemMap,
      emissiveMap: textures.emblemMap,
      emissive: new THREE.Color(0x7dd3fc),
      emissiveIntensity: 1.15,
      roughness: 0.2,
      metalness: 0.3,
    })
  );

  const eyeMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      map: textures.eyeMap,
      roughness: 0.12,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
    })
  );

  const rootGroup = new THREE.Group();
  const bodyGroup = new THREE.Group();
  rootGroup.add(bodyGroup);

  // Grounding holographic pedestal disc at y = 0.0
  const basePlateGeo = trackGeo(new THREE.CylinderGeometry(0.58, 0.64, 0.04, 48));
  const basePlate = new THREE.Mesh(basePlateGeo, suitNavyMat);
  basePlate.position.y = 0.02;
  basePlate.receiveShadow = true;
  rootGroup.add(basePlate);

  const baseRingGeo = trackGeo(new THREE.TorusGeometry(0.62, 0.014, 14, 64));
  const baseRing = new THREE.Mesh(baseRingGeo, collarGlowMat);
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.y = 0.04;
  rootGroup.add(baseRing);

  // Soft contact grounding shadow glow
  const contactGlowGeo = trackGeo(new THREE.PlaneGeometry(1.9, 1.9));
  const contactGlowMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: textures.glowDiscMap,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  const contactGlow = new THREE.Mesh(contactGlowGeo, contactGlowMat);
  contactGlow.rotation.x = -Math.PI / 2;
  contactGlow.position.y = 0.01;
  rootGroup.add(contactGlow);

  // ---------------- TORSO GROUP ----------------
  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0, 0.04, 0);
  bodyGroup.add(torsoGroup);

  // Sculpted Lathe torso silhouette (waist -> chest -> upper shoulders)
  const torsoProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.24, 0.02),
    new THREE.Vector2(0.2, 0.22),
    new THREE.Vector2(0.18, 0.38),
    new THREE.Vector2(0.24, 0.56),
    new THREE.Vector2(0.27, 0.72),
    new THREE.Vector2(0.16, 0.85),
    new THREE.Vector2(0.09, 0.89),
    new THREE.Vector2(0.0, 0.89),
  ];
  const innerSuitGeo = trackGeo(new THREE.LatheGeometry(torsoProfile, 36));
  const innerSuit = new THREE.Mesh(innerSuitGeo, suitNavyMat);
  innerSuit.scale.set(1.06, 1.0, 0.72);
  innerSuit.castShadow = true;
  innerSuit.receiveShadow = true;
  torsoGroup.add(innerSuit);

  // White Ceramic Chestplate Armor (sculpted front & back shell)
  const chestShellGeo = trackGeo(new THREE.SphereGeometry(0.27, 32, 24, 0, Math.PI * 2, 0.35, 1.55));
  const chestShell = new THREE.Mesh(chestShellGeo, armorWhiteMat);
  chestShell.position.set(0, 0.62, 0.025);
  chestShell.scale.set(1.08, 1.05, 0.78);
  chestShell.castShadow = true;
  chestShell.receiveShadow = true;
  torsoGroup.add(chestShell);

  // Side waist white armor panels
  const sidePanelGeo = trackGeo(new THREE.CapsuleGeometry(0.095, 0.28, 8, 16));
  [-1, 1].forEach((side) => {
    const panel = new THREE.Mesh(sidePanelGeo, armorWhiteMat);
    panel.position.set(side * 0.17, 0.35, 0.02);
    panel.rotation.z = side * 0.14;
    panel.scale.set(0.85, 1, 0.9);
    panel.castShadow = true;
    torsoGroup.add(panel);
  });

  // Futuristic High Collar + Cyan Rim
  const collarProfile = [
    new THREE.Vector2(0.115, 0.0),
    new THREE.Vector2(0.135, 0.06),
    new THREE.Vector2(0.145, 0.14),
    new THREE.Vector2(0.125, 0.15),
    new THREE.Vector2(0.105, 0.05),
  ];
  const collarGeo = trackGeo(new THREE.LatheGeometry(collarProfile, 32, -Math.PI * 0.68, Math.PI * 1.36));
  const collar = new THREE.Mesh(collarGeo, armorWhiteMat);
  collar.position.set(0, 0.81, -0.01);
  collar.rotation.y = Math.PI;
  collar.castShadow = true;
  torsoGroup.add(collar);

  const collarAccentGeo = trackGeo(new THREE.TorusGeometry(0.138, 0.008, 10, 36, Math.PI * 1.32));
  const collarAccent = new THREE.Mesh(collarAccentGeo, collarGlowMat);
  collarAccent.position.set(0, 0.94, -0.01);
  collarAccent.rotation.x = Math.PI / 2;
  collarAccent.rotation.z = -Math.PI * 0.16;
  torsoGroup.add(collarAccent);

  // Glowing "H" Chest Core Medallion
  const emblemHousingGeo = trackGeo(new THREE.CylinderGeometry(0.088, 0.095, 0.032, 32));
  const emblemHousing = new THREE.Mesh(emblemHousingGeo, metalSilverMat);
  emblemHousing.rotation.x = Math.PI / 2 - 0.16;
  emblemHousing.position.set(0, 0.63, 0.215);
  torsoGroup.add(emblemHousing);

  const emblemDiscGeo = trackGeo(new THREE.CircleGeometry(0.078, 32));
  const emblemDisc = new THREE.Mesh(emblemDiscGeo, chestEmblemMat);
  emblemDisc.position.set(0, 0.633, 0.233);
  emblemDisc.rotation.x = -0.16;
  torsoGroup.add(emblemDisc);

  // Neck
  const neckGeo = trackGeo(new THREE.CylinderGeometry(0.078, 0.092, 0.16, 24));
  const neck = new THREE.Mesh(neckGeo, skinMat);
  neck.position.set(0, 0.92, 0.01);
  neck.castShadow = true;
  torsoGroup.add(neck);

  // ---------------- ARMS & SHOULDER PAULDRONS ----------------
  const createArm = (side: -1 | 1) => {
    const armGroup = new THREE.Group();
    armGroup.position.set(side * 0.3, 0.78, 0.0);

    // Sculpted Shoulder Pauldron
    const pauldronGeo = trackGeo(new THREE.SphereGeometry(0.125, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.65));
    const pauldron = new THREE.Mesh(pauldronGeo, armorWhiteMat);
    pauldron.position.set(side * 0.02, 0.03, 0);
    pauldron.rotation.z = -side * 0.45;
    pauldron.scale.set(1.15, 0.95, 1.05);
    pauldron.castShadow = true;
    armGroup.add(pauldron);

    const shoulderTrimGeo = trackGeo(new THREE.TorusGeometry(0.098, 0.007, 8, 28));
    const shoulderTrim = new THREE.Mesh(shoulderTrimGeo, collarGlowMat);
    shoulderTrim.position.set(side * 0.03, -0.01, 0);
    shoulderTrim.rotation.y = Math.PI / 2;
    shoulderTrim.rotation.x = side * 0.45;
    armGroup.add(shoulderTrim);

    // Upper Arm (Navy Tech Sleeve)
    const upperArmGeo = trackGeo(new THREE.CapsuleGeometry(0.062, 0.24, 8, 16));
    const upperArm = new THREE.Mesh(upperArmGeo, suitNavyMat);
    upperArm.position.set(side * 0.055, -0.15, 0.01);
    upperArm.rotation.z = side * 0.14;
    upperArm.castShadow = true;
    armGroup.add(upperArm);

    // Forearm White Gauntlet + Hand
    const forearmGroup = new THREE.Group();
    forearmGroup.position.set(side * 0.08, -0.31, 0.02);
    armGroup.add(forearmGroup);

    const gauntletGeo = trackGeo(new THREE.CapsuleGeometry(0.058, 0.22, 8, 16));
    const gauntlet = new THREE.Mesh(gauntletGeo, armorWhiteMat);
    gauntlet.position.set(0, -0.12, 0.04);
    gauntlet.rotation.x = -0.25;
    gauntlet.castShadow = true;
    forearmGroup.add(gauntlet);

    const handGeo = trackGeo(new THREE.SphereGeometry(0.052, 16, 14));
    const hand = new THREE.Mesh(handGeo, skinMat);
    hand.position.set(0, -0.27, 0.08);
    hand.scale.set(0.85, 1.1, 0.75);
    forearmGroup.add(hand);

    return armGroup;
  };

  const leftArmGroup = createArm(-1);
  const rightArmGroup = createArm(1);
  torsoGroup.add(leftArmGroup);
  torsoGroup.add(rightArmGroup);

  // ---------------- HEAD & FACE ----------------
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.0, 0.015);
  torsoGroup.add(headGroup);

  // Sculpted Anime/Stylized Head (slightly tapered jawline)
  const headGeo = trackGeo(new THREE.SphereGeometry(0.285, 36, 32));
  const posAttr = headGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    // Taper chin gently downward and narrow cheeks slightly
    let nx = x;
    let ny = y * 1.06;
    let nz = z * 0.96;
    if (y < -0.05) {
      const t = Math.min(1, (-y - 0.05) / 0.24);
      nx *= 1 - t * 0.24;
      nz *= 1 - t * 0.16;
      ny -= t * 0.025;
    }
    posAttr.setXYZ(i, nx, ny, nz);
  }
  headGeo.computeVertexNormals();

  const headMesh = new THREE.Mesh(headGeo, skinMat);
  headMesh.position.set(0, 0.25, 0);
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  headGroup.add(headMesh);

  // Delicate Nose
  const noseGeo = trackGeo(new THREE.ConeGeometry(0.018, 0.042, 12));
  const nose = new THREE.Mesh(noseGeo, skinMat);
  nose.position.set(0, 0.21, 0.275);
  nose.rotation.x = Math.PI * 0.42;
  headGroup.add(nose);

  // Subtle Cheek Blush
  const blushGeo = trackGeo(new THREE.CircleGeometry(0.046, 20));
  [-1, 1].forEach((side) => {
    const blush = new THREE.Mesh(blushGeo, blushMat);
    blush.position.set(side * 0.145, 0.175, 0.232);
    blush.rotation.y = side * 0.45;
    blush.scale.set(1.25, 0.72, 1);
    headGroup.add(blush);
  });

  // Expressive Large Eyes + Animated Blink Eyelids + Eyelashes
  const createEye = (side: -1 | 1) => {
    const eyeSocket = new THREE.Group();
    eyeSocket.position.set(side * 0.102, 0.255, 0.228);
    eyeSocket.rotation.y = side * 0.26;
    eyeSocket.rotation.x = -0.04;

    // Eyeball sphere mapped with iris texture
    const eyeGeo = trackGeo(new THREE.SphereGeometry(0.062, 24, 24));
    const eyeball = new THREE.Mesh(eyeGeo, eyeMat);
    // Rotate sphere so UV center faces +Z
    eyeball.rotation.y = -Math.PI / 2;
    eyeball.scale.set(0.85, 1.06, 0.96);
    eyeSocket.add(eyeball);

    // Upper curved eyelash arch
    const lashCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.056, 0.016, 0.045),
      new THREE.Vector3(0, 0.052, 0.062),
      new THREE.Vector3(0.056, 0.022, 0.044),
    ]);
    const lashGeo = trackGeo(new THREE.TubeGeometry(lashCurve, 16, 0.0085, 8, false));
    const lash = new THREE.Mesh(lashGeo, hairMat);
    eyeSocket.add(lash);

    // Delicate eyebrow
    const browCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.048 * side, 0.082, 0.04),
      new THREE.Vector3(0, 0.096, 0.05),
      new THREE.Vector3(0.052 * side, 0.078, 0.036),
    ]);
    const browGeo = trackGeo(new THREE.TubeGeometry(browCurve, 12, 0.0055, 6, false));
    const brow = new THREE.Mesh(browGeo, hairMat);
    eyeSocket.add(brow);

    // Animated Eyelid cap for natural blinking
    const lidGeo = trackGeo(new THREE.SphereGeometry(0.066, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.52));
    const eyelid = new THREE.Mesh(lidGeo, skinMat);
    eyelid.scale.set(0.98, 1.08, 0.92);
    eyelid.rotation.x = -Math.PI * 0.48; // Open by default
    eyeSocket.add(eyelid);

    headGroup.add(eyeSocket);
    return eyelid;
  };

  const leftEyelid = createEye(-1);
  const rightEyelid = createEye(1);

  // Animated Smiling Mouth & Speech Lip Sync
  const mouthGroup = new THREE.Group();
  mouthGroup.position.set(0, 0.118, 0.252);
  headGroup.add(mouthGroup);

  const upperLipCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.042, 0.008, -0.012),
    new THREE.Vector3(0, -0.002, 0.004),
    new THREE.Vector3(0.042, 0.008, -0.012),
  ]);
  const upperLipGeo = trackGeo(new THREE.TubeGeometry(upperLipCurve, 16, 0.007, 8, false));
  const upperLip = new THREE.Mesh(upperLipGeo, lipMat);
  mouthGroup.add(upperLip);

  const lowerLipCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.038, 0.005, -0.012),
    new THREE.Vector3(0, -0.01, 0.002),
    new THREE.Vector3(0.038, 0.005, -0.012),
  ]);
  const lowerLipGeo = trackGeo(new THREE.TubeGeometry(lowerLipCurve, 16, 0.0075, 8, false));
  const mouthLowerLip = new THREE.Mesh(lowerLipGeo, lipMat);
  mouthGroup.add(mouthLowerLip);

  const mouthInnerGeo = trackGeo(new THREE.SphereGeometry(0.026, 16, 12));
  const mouthInnerMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x5c1826,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.15,
      roughness: 0.4,
    })
  );
  const mouthInner = new THREE.Mesh(mouthInnerGeo, mouthInnerMat);
  mouthInner.position.set(0, -0.004, -0.008);
  mouthInner.scale.set(1.2, 0.2, 0.5);
  mouthGroup.add(mouthInner);

  // ---------------- HAIR & HIGH BUN ----------------
  const hairCrownGeo = trackGeo(new THREE.SphereGeometry(0.298, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.68));
  const hairCrown = new THREE.Mesh(hairCrownGeo, hairMat);
  hairCrown.position.set(0, 0.265, -0.015);
  hairCrown.rotation.x = -0.22;
  hairCrown.scale.set(1.02, 1.06, 1.03);
  hairCrown.castShadow = true;
  headGroup.add(hairCrown);

  // Back hair shell covering nape
  const backHairGeo = trackGeo(new THREE.SphereGeometry(0.295, 28, 22, Math.PI * 0.65, Math.PI * 1.7, 0.2, Math.PI * 0.72));
  const backHair = new THREE.Mesh(backHairGeo, hairMat);
  backHair.position.set(0, 0.24, -0.025);
  backHair.rotation.y = Math.PI * 0.5;
  headGroup.add(backHair);

  // Swept parted front bangs + cheek framing locks
  const createHairStrand = (pts: THREE.Vector3[], radius: number) => {
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = trackGeo(new THREE.TubeGeometry(curve, 18, radius, 10, false));
    const strand = new THREE.Mesh(geo, hairMat);
    strand.castShadow = true;
    return strand;
  };

  // Parted left & right bangs
  headGroup.add(
    createHairStrand(
      [
        new THREE.Vector3(0.02, 0.52, 0.13),
        new THREE.Vector3(-0.08, 0.47, 0.235),
        new THREE.Vector3(-0.175, 0.36, 0.235),
        new THREE.Vector3(-0.22, 0.2, 0.17),
      ],
      0.042
    )
  );
  headGroup.add(
    createHairStrand(
      [
        new THREE.Vector3(0.01, 0.52, 0.14),
        new THREE.Vector3(0.095, 0.46, 0.235),
        new THREE.Vector3(0.18, 0.35, 0.23),
        new THREE.Vector3(0.225, 0.2, 0.165),
      ],
      0.04
    )
  );
  // Subtle forehead wispie bangs
  headGroup.add(
    createHairStrand(
      [
        new THREE.Vector3(-0.02, 0.51, 0.17),
        new THREE.Vector3(-0.045, 0.42, 0.262),
        new THREE.Vector3(-0.06, 0.34, 0.268),
      ],
      0.022
    )
  );
  headGroup.add(
    createHairStrand(
      [
        new THREE.Vector3(0.03, 0.51, 0.17),
        new THREE.Vector3(0.06, 0.41, 0.26),
        new THREE.Vector3(0.08, 0.335, 0.262),
      ],
      0.02
    )
  );
  // Side framing locks down toward collarbone
  [-1, 1].forEach((side) => {
    headGroup.add(
      createHairStrand(
        [
          new THREE.Vector3(side * 0.22, 0.32, 0.12),
          new THREE.Vector3(side * 0.245, 0.16, 0.14),
          new THREE.Vector3(side * 0.21, 0.02, 0.12),
        ],
        0.028
      )
    );
  });

  // High Hair Bun Group (animated secondary sway!)
  const hairBunGroup = new THREE.Group();
  hairBunGroup.position.set(0, 0.54, -0.08);
  headGroup.add(hairBunGroup);

  const bunGeo = trackGeo(new THREE.SphereGeometry(0.145, 24, 20));
  const bunMesh = new THREE.Mesh(bunGeo, hairMat);
  bunMesh.position.set(0, 0.08, 0);
  bunMesh.scale.set(1.06, 0.92, 0.98);
  bunMesh.castShadow = true;
  hairBunGroup.add(bunMesh);

  const hairTieGeo = trackGeo(new THREE.TorusGeometry(0.09, 0.015, 10, 28));
  const hairTie = new THREE.Mesh(hairTieGeo, collarGlowMat);
  hairTie.rotation.x = Math.PI / 2 - 0.18;
  hairTie.position.set(0, 0.0, 0.01);
  hairBunGroup.add(hairTie);

  // ---------------- GLOWING FUTURISTIC HEADPHONES ----------------
  const headbandCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.31, 0.26, 0.0),
    new THREE.Vector3(-0.27, 0.48, 0.01),
    new THREE.Vector3(0, 0.575, 0.02),
    new THREE.Vector3(0.27, 0.48, 0.01),
    new THREE.Vector3(0.31, 0.26, 0.0),
  ]);
  const headbandGeo = trackGeo(new THREE.TubeGeometry(headbandCurve, 32, 0.024, 12, false));
  const headband = new THREE.Mesh(headbandGeo, armorWhiteMat);
  headband.castShadow = true;
  headGroup.add(headband);

  // Glowing accent strip along headband
  const headbandGlowGeo = trackGeo(new THREE.TubeGeometry(headbandCurve, 32, 0.008, 8, false));
  const headbandGlow = new THREE.Mesh(headbandGlowGeo, earGlowMat);
  headbandGlow.position.set(0, 0.016, 0.014);
  headGroup.add(headbandGlow);

  // Left & Right Earcups
  [-1, 1].forEach((side) => {
    const cupGroup = new THREE.Group();
    cupGroup.position.set(side * 0.305, 0.24, 0.0);
    cupGroup.rotation.z = side * 0.06;

    const cushionGeo = trackGeo(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 28));
    const cushion = new THREE.Mesh(cushionGeo, suitNavyMat);
    cushion.rotation.z = Math.PI / 2;
    cupGroup.add(cushion);

    const shellGeo = trackGeo(new THREE.CylinderGeometry(0.095, 0.11, 0.055, 28));
    const shell = new THREE.Mesh(shellGeo, armorWhiteMat);
    shell.rotation.z = Math.PI / 2;
    shell.position.x = side * 0.036;
    shell.castShadow = true;
    cupGroup.add(shell);

    // Outer & inner glowing earcup LED rings
    const outerLedGeo = trackGeo(new THREE.TorusGeometry(0.088, 0.012, 12, 32));
    const outerLed = new THREE.Mesh(outerLedGeo, earGlowMat);
    outerLed.rotation.y = Math.PI / 2;
    outerLed.position.x = side * 0.066;
    cupGroup.add(outerLed);

    const innerLedGeo = trackGeo(new THREE.TorusGeometry(0.052, 0.009, 10, 28));
    const innerLed = new THREE.Mesh(innerLedGeo, earGlowMat);
    innerLed.rotation.y = Math.PI / 2;
    innerLed.position.x = side * 0.068;
    cupGroup.add(innerLed);

    headGroup.add(cupGroup);
  });

  // ---------------- HOLOGRAPHIC BACK HALO RINGS ----------------
  const haloOuterMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 1.4,
      roughness: 0.2,
      metalness: 0.3,
      transparent: true,
      opacity: 0.78,
    })
  );
  const haloInnerMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xc084fc,
      emissive: 0xa855f7,
      emissiveIntensity: 1.25,
      roughness: 0.2,
      metalness: 0.3,
      transparent: true,
      opacity: 0.72,
    })
  );

  const haloOuterGeo = trackGeo(new THREE.TorusGeometry(0.68, 0.015, 16, 72));
  const haloOuterRing = new THREE.Mesh(haloOuterGeo, haloOuterMat);
  haloOuterRing.position.set(0, 1.27, -0.32);
  rootGroup.add(haloOuterRing);

  const haloInnerGeo = trackGeo(new THREE.TorusGeometry(0.54, 0.011, 14, 64));
  const haloInnerRing = new THREE.Mesh(haloInnerGeo, haloInnerMat);
  haloInnerRing.position.set(0, 1.27, -0.36);
  rootGroup.add(haloInnerRing);

  // Subtle floating orbital light motes around character
  const particleCount = 96;
  const particlePositions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    const angle = (i / particleCount) * Math.PI * 2;
    const radius = 0.75 + (i % 7) * 0.14;
    const y = 0.2 + ((i * 0.17) % 1.65);
    particlePositions[i * 3] = Math.cos(angle) * radius;
    particlePositions[i * 3 + 1] = y;
    particlePositions[i * 3 + 2] = Math.sin(angle) * radius - 0.15;
  }
  const orbGeo = trackGeo(new THREE.BufferGeometry());
  orbGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  const orbParticlesMat = trackMat(
    new THREE.PointsMaterial({
      color: 0x7dd3fc,
      map: textures.glowDiscMap,
      size: 0.065,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  const orbParticles = new THREE.Points(orbGeo, orbParticlesMat);
  rootGroup.add(orbParticles);

  const interactiveTargets: THREE.Object3D[] = [headGroup, torsoGroup];

  return {
    rootGroup,
    bodyGroup,
    torsoGroup,
    headGroup,
    hairBunGroup,
    leftArmGroup,
    rightArmGroup,
    leftEyelid,
    rightEyelid,
    mouthInner,
    mouthLowerLip,
    chestEmblemMat,
    earGlowMat,
    collarGlowMat,
    haloOuterRing,
    haloInnerRing,
    haloOuterMat,
    haloInnerMat,
    orbParticles,
    orbParticlesMat,
    interactiveTargets,
    dispose: () => {
      disposables.forEach((item) => item.dispose());
    },
  };
}
