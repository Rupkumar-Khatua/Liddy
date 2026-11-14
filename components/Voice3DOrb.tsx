import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

interface Voice3DOrbProps {
  volume: number;
  isConnected: boolean;
  status: string;
  onClick?: () => void;
  className?: string;
  activeMode?: string;
}

// Safe Software WebGL probe that NEVER calls loseContext()
let _cachedIsSoftwareGl: boolean | null = null;
const detectSoftwareGl = (): boolean => {
  if (_cachedIsSoftwareGl !== null) return _cachedIsSoftwareGl;
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) {
      _cachedIsSoftwareGl = true;
      return true;
    }
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    // NOTE: NEVER call loseContext() here. Repeated loseContext() triggers Chromium's context loss threshold blocking WebGL.
    _cachedIsSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    return _cachedIsSoftwareGl;
  } catch {
    _cachedIsSoftwareGl = true;
    return true;
  }
};

export const Voice3DOrb = React.memo<Voice3DOrbProps>(({
  volume,
  isConnected,
  status,
  onClick,
  className = '',
  activeMode = 'advisory',
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [hasWebGlError, setHasWebGlError] = useState(false);
  const volumeRef = useRef(volume);
  const isConnectedRef = useRef(isConnected);
  const squishRef = useRef(0);
  const isHoveredRef = useRef(false);
  const pointerPosRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 });
  const onClickRef = useRef(onClick);

  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container || hasWebGlError) return;

    let renderer: THREE.WebGLRenderer | null = null;
    let animId: number = 0;
    let isDisposed = false;

    let scene: THREE.Scene | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let jellyGeom: THREE.SphereGeometry | null = null;
    let jellyMat: THREE.MeshPhysicalMaterial | null = null;
    let nucleusGeom: THREE.SphereGeometry | null = null;
    let nucleusMat: THREE.MeshStandardMaterial | null = null;
    let particleGeom: THREE.BufferGeometry | null = null;
    let particleMat: THREE.PointsMaterial | null = null;
    const acousticRings: Array<{
      line: THREE.Line;
      geom: THREE.BufferGeometry;
      radius: number;
      speed: number;
      tiltX: number;
      tiltZ: number;
      phase: number;
    }> = [];
    let onContextLost: ((e: Event) => void) | null = null;

    try {
      const isSoftwareGl = detectSoftwareGl();
      const width = container.clientWidth || 360;
      const height = container.clientHeight || 360;

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 50);
      camera.position.set(0, 0, 4.6);

      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });

      onContextLost = (e: Event) => {
        e.preventDefault();
        console.warn('WebGL context lost in Voice3DOrb, switching to sensual CSS fallback.');
        setHasWebGlError(true);
      };
      renderer.domElement.addEventListener('webglcontextlost', onContextLost, false);

      renderer.setSize(width, height);
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.35;

      container.appendChild(renderer.domElement);

      // Studio lighting with bioluminescent chromatic spectrum
      const ambientLight = new THREE.AmbientLight(0x0c0f1d, 1.4);
      scene.add(ambientLight);

      const cyanLight = new THREE.DirectionalLight(0x38bdf8, 3.4);
      cyanLight.position.set(3.2, 3.5, 3.8);
      scene.add(cyanLight);

      const violetLight = new THREE.DirectionalLight(0xc084fc, 3.2);
      violetLight.position.set(-3.5, -2.5, 2.5);
      scene.add(violetLight);

      const emeraldLight = new THREE.PointLight(0x34d399, 2.8, 9);
      emeraldLight.position.set(0, -3.2, -1.8);
      scene.add(emeraldLight);

      const heartPoint = new THREE.PointLight(0x818cf8, 4.5, 6);
      heartPoint.position.set(0, 0, 0);
      scene.add(heartPoint);

      const masterGroup = new THREE.Group();
      scene.add(masterGroup);

      // 1. Sensual Bioluminescent Jelly Sphere
      const segments = isSoftwareGl ? 36 : 64;
      jellyGeom = new THREE.SphereGeometry(1.22, segments, segments);
      const positionAttr = jellyGeom.attributes.position;
      const origPositions = new Float32Array(positionAttr.array);
      const vertexCount = positionAttr.count;

      jellyMat = new THREE.MeshPhysicalMaterial({
        color: 0x22d3ee,
        emissive: 0x4f46e5,
        emissiveIntensity: 0.72,
        roughness: 0.06,
        metalness: 0.05,
        transmission: isSoftwareGl ? 0 : 0.78,
        thickness: 1.6,
        ior: 1.48,
        clearcoat: 1.0,
        clearcoatRoughness: 0.03,
        sheen: 1.0,
        sheenColor: 0xf472b6,
        sheenRoughness: 0.15,
        transparent: true,
        opacity: isSoftwareGl ? 0.88 : 0.94,
        reflectivity: 0.9,
      });

      const jellyMesh = new THREE.Mesh(jellyGeom, jellyMat);
      masterGroup.add(jellyMesh);

      // 2. Bioluminescent Inner Radiant Nucleus
      nucleusGeom = new THREE.SphereGeometry(0.58, 28, 28);
      nucleusMat = new THREE.MeshStandardMaterial({
        color: 0x818cf8,
        emissive: 0xa855f7,
        emissiveIntensity: 1.2,
        roughness: 0.2,
        metalness: 0.1,
        transparent: true,
        opacity: 0.82,
      });
      const nucleusMesh = new THREE.Mesh(nucleusGeom, nucleusMat);
      masterGroup.add(nucleusMesh);

      // 3. Floating Caustic Plasma Rings
      const ringCount = 4;
      const ringSegments = 100;
      const ringColors = [0x38bdf8, 0x818cf8, 0xc084fc, 0x34d399];

      for (let r = 0; r < ringCount; r++) {
        const ringGeom = new THREE.BufferGeometry();
        const ringPositions = new Float32Array((ringSegments + 1) * 3);
        ringGeom.setAttribute('position', new THREE.BufferAttribute(ringPositions, 3));

        const ringMat = new THREE.LineBasicMaterial({
          color: ringColors[r % ringColors.length],
          transparent: true,
          opacity: 0.55 - r * 0.1,
          linewidth: 1.5,
        });

        const line = new THREE.Line(ringGeom, ringMat);
        masterGroup.add(line);

        acousticRings.push({
          line,
          geom: ringGeom,
          radius: 1.5 + r * 0.28,
          speed: 1.6 + r * 0.45,
          tiltX: (r * 0.35) - 0.5,
          tiltZ: (r * 0.25) - 0.3,
          phase: r * 1.4,
        });
      }

      // 4. Bioluminescent Star Dust / Spores
      const particleCount = isSoftwareGl ? 35 : 75;
      particleGeom = new THREE.BufferGeometry();
      const particlePositions = new Float32Array(particleCount * 3);
      const particleSpeeds = new Float32Array(particleCount);
      const particleRadii = new Float32Array(particleCount);
      const particleAngles = new Float32Array(particleCount);

      for (let p = 0; p < particleCount; p++) {
        const rad = 1.35 + Math.random() * 0.9;
        const angle = Math.random() * Math.PI * 2;
        const y = (Math.random() - 0.5) * 1.8;
        particlePositions[p * 3] = Math.cos(angle) * rad;
        particlePositions[p * 3 + 1] = y;
        particlePositions[p * 3 + 2] = Math.sin(angle) * rad;
        particleRadii[p] = rad;
        particleAngles[p] = angle;
        particleSpeeds[p] = 0.3 + Math.random() * 0.7;
      }

      particleGeom.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

      particleMat = new THREE.PointsMaterial({
        size: 0.045,
        color: 0x93c5fd,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
      });

      const particles = new THREE.Points(particleGeom, particleMat);
      masterGroup.add(particles);

      // Event handlers
      const handlePointerDown = () => {
        squishRef.current = 0.32;
      };

      const handlePointerEnter = () => {
        isHoveredRef.current = true;
      };

      const handlePointerLeave = () => {
        isHoveredRef.current = false;
        pointerPosRef.current.targetX = 0;
        pointerPosRef.current.targetY = 0;
      };

      const handlePointerMove = (e: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        pointerPosRef.current.targetX = nx * 0.35;
        pointerPosRef.current.targetY = ny * 0.35;
      };

      container.addEventListener('pointerdown', handlePointerDown);
      container.addEventListener('pointerenter', handlePointerEnter);
      container.addEventListener('pointerleave', handlePointerLeave);
      container.addEventListener('pointermove', handlePointerMove);

      const clock = new THREE.Clock();
      let smoothedVol = 0;

      const renderSingleFrame = () => {
        if (isDisposed || !renderer || !scene || !camera || !jellyGeom || !jellyMat || !nucleusMesh || !nucleusMat) return;
        const time = clock.getElapsedTime();

        const targetVol = isConnectedRef.current ? Math.min(volumeRef.current, 1) : 0;
        smoothedVol += (targetVol - smoothedVol) * 0.16;

        pointerPosRef.current.x += (pointerPosRef.current.targetX - pointerPosRef.current.x) * 0.08;
        pointerPosRef.current.y += (pointerPosRef.current.targetY - pointerPosRef.current.y) * 0.08;

        squishRef.current *= 0.93;
        const currentSquish = squishRef.current * Math.sin(time * 18);

        const hue = (0.55 + Math.sin(time * 0.25) * 0.12 + smoothedVol * 0.2) % 1.0;
        jellyMat.color.setHSL(hue, 0.85, 0.58);
        jellyMat.emissive.setHSL((hue + 0.15) % 1.0, 0.9, 0.45);
        jellyMat.emissiveIntensity = 0.6 + smoothedVol * 1.2;

        const pos = jellyGeom.attributes.position;
        const arr = pos.array as Float32Array;

        const rippleStrength = 0.08 + smoothedVol * 0.42 + (isHoveredRef.current ? 0.04 : 0);
        const breath = 1.0 + Math.sin(time * 2.4) * 0.035 + smoothedVol * 0.16;

        for (let i = 0; i < vertexCount; i++) {
          const ox = origPositions[i * 3];
          const oy = origPositions[i * 3 + 1];
          const oz = origPositions[i * 3 + 2];

          const harmonic1 = Math.sin(ox * 2.6 + oy * 2.2 + time * 3.4);
          const harmonic2 = Math.cos(oz * 2.8 - oy * 3.1 + time * 2.8);
          const harmonic3 = Math.sin((ox + oz) * 3.2 + time * 4.2);
          const harmonic4 = Math.cos((oy + ox) * 4.0 - time * 2.1) * 0.5;

          const fluidDisplacement = 1.0 + (harmonic1 * 0.4 + harmonic2 * 0.3 + harmonic3 * 0.2 + harmonic4 * 0.1) * rippleStrength;

          const squishX = 1 + currentSquish;
          const squishY = 1 - currentSquish * 0.85;

          arr[i * 3] = ox * breath * fluidDisplacement * squishX;
          arr[i * 3 + 1] = oy * breath * fluidDisplacement * squishY;
          arr[i * 3 + 2] = oz * breath * fluidDisplacement;
        }

        pos.needsUpdate = true;
        if (!isSoftwareGl) {
          jellyGeom.computeVertexNormals();
        }

        const nucleusScale = 0.88 + Math.sin(time * 3.8) * 0.09 + smoothedVol * 0.5;
        nucleusMesh.scale.set(nucleusScale, nucleusScale, nucleusScale);
        nucleusMat.emissiveIntensity = 0.9 + smoothedVol * 1.6;

        acousticRings.forEach((ring) => {
          const ringPosAttr = ring.geom.attributes.position;
          const ringArr = ringPosAttr.array as Float32Array;
          const rBase = ring.radius * (1.0 + smoothedVol * 0.3);

          for (let j = 0; j <= ringSegments; j++) {
            const theta = (j / ringSegments) * Math.PI * 2;
            const waveHarmonic =
              Math.sin(theta * 7 + time * ring.speed + ring.phase) * (0.06 + smoothedVol * 0.26) +
              Math.cos(theta * 3 - time * 1.8) * 0.03;
            const rCur = rBase + waveHarmonic;

            const baseZ = Math.sin(theta * 4 + time * 2.2) * (0.12 + smoothedVol * 0.2);

            const x = Math.cos(theta) * rCur;
            const y = Math.sin(theta) * rCur * Math.cos(ring.tiltX) - baseZ * Math.sin(ring.tiltX);
            const z = Math.sin(theta) * rCur * Math.sin(ring.tiltZ) + baseZ * Math.cos(ring.tiltZ);

            ringArr[j * 3] = x;
            ringArr[j * 3 + 1] = y;
            ringArr[j * 3 + 2] = z;
          }

          ringPosAttr.needsUpdate = true;
        });

        if (particleGeom) {
          const pArr = particleGeom.attributes.position.array as Float32Array;
          for (let p = 0; p < particleCount; p++) {
            particleAngles[p] += particleSpeeds[p] * 0.012 * (1.0 + smoothedVol * 2.0);
            const r = particleRadii[p] * (1.0 + smoothedVol * 0.22);
            pArr[p * 3] = Math.cos(particleAngles[p]) * r;
            pArr[p * 3 + 2] = Math.sin(particleAngles[p]) * r;
          }
          particleGeom.attributes.position.needsUpdate = true;
        }

        masterGroup.rotation.y = time * 0.22 + pointerPosRef.current.x;
        masterGroup.rotation.x = Math.sin(time * 0.5) * 0.07 + pointerPosRef.current.y;

        renderer.render(scene, camera);
      };

      let isInView = true;
      let isLooping = false;

      const frameLoop = () => {
        if (!isInView || isDisposed) {
          isLooping = false;
          return;
        }
        renderSingleFrame();
        animId = requestAnimationFrame(frameLoop);
      };

      const startFrameLoop = () => {
        if (!isLooping && !isDisposed) {
          isLooping = true;
          animId = requestAnimationFrame(frameLoop);
        }
      };

      const orbObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            isInView = entry.isIntersecting;
            if (isInView) startFrameLoop();
          });
        },
        { threshold: 0.01, rootMargin: '50px' }
      );
      orbObserver.observe(container);

      const handleResize = () => {
        if (!container || !camera || !renderer) return;
        const w = container.clientWidth || 360;
        const h = container.clientHeight || 360;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        if (isInView) {
          renderSingleFrame();
        }
      };

      window.addEventListener('resize', handleResize);

      return () => {
        isDisposed = true;
        orbObserver.disconnect();
        cancelAnimationFrame(animId);
        window.removeEventListener('resize', handleResize);
        container.removeEventListener('pointerdown', handlePointerDown);
        container.removeEventListener('pointerenter', handlePointerEnter);
        container.removeEventListener('pointerleave', handlePointerLeave);
        container.removeEventListener('pointermove', handlePointerMove);

        if (renderer && onContextLost) {
          try {
            renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
          } catch {}
        }

        try {
          renderer?.dispose();
          jellyGeom?.dispose();
          jellyMat?.dispose();
          nucleusGeom?.dispose();
          nucleusMat?.dispose();
          particleGeom?.dispose();
          particleMat?.dispose();
          acousticRings.forEach((r) => {
            r.geom.dispose();
            (r.line.material as THREE.Material).dispose();
          });
        } catch {}

        if (renderer?.domElement && renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      };
    } catch (creationErr) {
      console.warn('WebGL context creation failed or blocked in Voice3DOrb, gracefully enabling sensual CSS fallback:', creationErr);
      setHasWebGlError(true);
    }
  }, [hasWebGlError]);

  return (
    <div
      onClick={() => onClickRef.current?.()}
      className={`relative w-72 h-72 sm:w-84 sm:h-84 md:w-96 md:h-96 flex items-center justify-center cursor-pointer transition-transform duration-300 hover:scale-[1.03] active:scale-[0.98] ${className}`}
      aria-label="Interactive Audio Visualizer"
    >
      {!hasWebGlError ? (
        <div ref={mountRef} className="w-full h-full flex items-center justify-center" />
      ) : (
        /* Sensual Bioluminescent CSS/SVG Visualizer Fallback */
        <div className="relative w-full h-full flex items-center justify-center select-none">
          {/* Ambient Outer Halo */}
          <div 
            className="absolute inset-4 rounded-full bg-gradient-to-tr from-cyan-500/20 via-indigo-500/30 to-pink-500/20 blur-2xl transition-all duration-150"
            style={{
              transform: `scale(${1 + volume * 0.4})`,
              opacity: isConnected ? 0.8 : 0.35,
            }}
          />

          {/* Concentric Acoustic Waves */}
          {[1, 2, 3].map((ring) => (
            <div
              key={ring}
              className="absolute rounded-full border border-sky-400/30 transition-all duration-300"
              style={{
                width: `${140 + ring * 45 + volume * 55}px`,
                height: `${140 + ring * 45 + volume * 55}px`,
                transform: `rotate(${ring * 35}deg) scale(${1 + (ring % 2 === 0 ? volume * 0.2 : -volume * 0.15)})`,
                borderColor: ring === 2 ? 'rgba(192, 132, 252, 0.4)' : 'rgba(56, 189, 248, 0.35)',
              }}
            />
          ))}

          {/* Bioluminescent Center Core */}
          <div 
            className="relative w-36 h-36 sm:w-44 sm:h-44 rounded-full bg-gradient-to-br from-cyan-400 via-indigo-600 to-fuchsia-500 shadow-2xl flex items-center justify-center transition-all duration-150"
            style={{
              transform: `scale(${1 + volume * 0.25})`,
              boxShadow: `0 0 ${30 + volume * 60}px rgba(99, 102, 241, ${0.4 + volume * 0.5})`,
            }}
          >
            {/* Inner Radiant Nucleus */}
            <div 
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/40 backdrop-blur-md animate-pulse"
              style={{
                transform: `scale(${1 + volume * 0.35})`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
});

Voice3DOrb.displayName = 'Voice3DOrb';

export default Voice3DOrb;
