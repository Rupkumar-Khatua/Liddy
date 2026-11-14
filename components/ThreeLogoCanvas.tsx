import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

interface ThreeLogoCanvasProps {
  className?: string;
  height?: number | string;
}

// Module-level scratch vectors to prevent garbage collection spikes
const _targetRot = new THREE.Vector2(0, 0);
const _currentRot = new THREE.Vector2(0, 0);

interface FinishConfig {
  name: string;
  color: THREE.Color;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  emissive: THREE.Color;
  emissiveIntensity: number;
  // CSS fallbacks for zero-WebGL environments
  cssGradient: string;
  cssShadow: string;
  cssBorder: string;
}

const FINISHES: FinishConfig[] = [
  {
    name: 'Platinum Specular',
    color: new THREE.Color(0xf8fafc),
    metalness: 0.98,
    roughness: 0.14,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    emissive: new THREE.Color(0x0f172a),
    emissiveIntensity: 0.15,
    cssGradient: 'linear-gradient(135deg, #ffffff 0%, #cbd5e1 45%, #94a3b8 75%, #475569 100%)',
    cssShadow: '0 20px 45px -10px rgba(148, 163, 184, 0.45)',
    cssBorder: 'rgba(255, 255, 255, 0.8)',
  },
  {
    name: 'Royal Gold',
    color: new THREE.Color(0xf59e0b),
    metalness: 0.92,
    roughness: 0.16,
    clearcoat: 0.95,
    clearcoatRoughness: 0.1,
    emissive: new THREE.Color(0x78350f),
    emissiveIntensity: 0.25,
    cssGradient: 'linear-gradient(135deg, #fef08a 0%, #f59e0b 45%, #d97706 75%, #78350f 100%)',
    cssShadow: '0 20px 45px -10px rgba(245, 158, 11, 0.45)',
    cssBorder: 'rgba(254, 240, 138, 0.8)',
  },
  {
    name: 'Obsidian Chrome',
    color: new THREE.Color(0x18181b),
    metalness: 0.88,
    roughness: 0.1,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    emissive: new THREE.Color(0x312e81),
    emissiveIntensity: 0.45,
    cssGradient: 'linear-gradient(135deg, #475569 0%, #1e293b 40%, #0f172a 75%, #020617 100%)',
    cssShadow: '0 20px 45px -10px rgba(79, 70, 229, 0.35)',
    cssBorder: 'rgba(129, 140, 248, 0.6)',
  },
];

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
    // CRITICAL: NEVER call loseContext() - repeated loseContext() causes Chromium to block WebGL with
    // "Web page caused context loss and was blocked"
    _cachedIsSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    return _cachedIsSoftwareGl;
  } catch {
    _cachedIsSoftwareGl = true;
    return true;
  }
};

export const ThreeLogoCanvas: React.FC<ThreeLogoCanvasProps> = ({ 
  className = '', 
  height = 360 
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [currentFinishIndex, setCurrentFinishIndex] = useState(0);
  const [hasWebGlError, setHasWebGlError] = useState(false);
  const finishIndexRef = useRef(0);

  // Autonomous Finish Cycle: automatically morph finish every 6.5 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      finishIndexRef.current = (finishIndexRef.current + 1) % FINISHES.length;
      setCurrentFinishIndex(finishIndexRef.current);
    }, 6500);
    return () => clearInterval(timer);
  }, []);

  const currentFinish = FINISHES[currentFinishIndex];

  useEffect(() => {
    const container = mountRef.current;
    if (!container || hasWebGlError) return;

    let renderer: THREE.WebGLRenderer | null = null;
    let animId = 0;
    let isDisposed = false;

    // Disposable Three.js resources
    let scene: THREE.Scene | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let lGeom: THREE.ExtrudeGeometry | null = null;
    let bladeGeom: THREE.ExtrudeGeometry | null = null;
    let bladeMat: THREE.MeshPhysicalMaterial | null = null;
    let anchorGeom: THREE.SphereGeometry | null = null;
    let anchorMat: THREE.MeshStandardMaterial | null = null;
    let iGeom: THREE.ExtrudeGeometry | null = null;
    let dGeom: THREE.ExtrudeGeometry | null = null;
    let yGeom: THREE.ExtrudeGeometry | null = null;
    let letterMaterial: THREE.MeshPhysicalMaterial | null = null;
    let envTexture: THREE.Texture | null = null;
    let onContextLost: ((e: Event) => void) | null = null;

    try {
      const isSoftwareGl = detectSoftwareGl();
      const width = container.clientWidth || 600;
      const canvasHeight = typeof height === 'number' ? height : container.clientHeight || 360;

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(40, width / canvasHeight, 0.1, 100);
      camera.position.set(0, 0, width < 640 ? 8.2 : 6.4);

      // Guarded WebGLRenderer instantiation
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });

      // Context lost listener
      onContextLost = (e: Event) => {
        e.preventDefault();
        console.warn('WebGL context lost in ThreeLogoCanvas, enabling fallback.');
        setHasWebGlError(true);
      };
      renderer.domElement.addEventListener('webglcontextlost', onContextLost, false);

      renderer.setSize(width, canvasHeight);
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;

      container.appendChild(renderer.domElement);

      // Studio Reflections Environment
      try {
        const pmremGenerator = new THREE.PMREMGenerator(renderer);
        envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environment = envTexture;
        pmremGenerator.dispose();
      } catch (pmremErr) {
        console.warn('PMREM environment generation skipped:', pmremErr);
      }

      // Studio Lighting Rig
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      scene.add(ambientLight);

      const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.4);
      keyLight.position.set(4, 5, 5);
      scene.add(keyLight);

      const fillLight = new THREE.DirectionalLight(0x93c5fd, 1.6);
      fillLight.position.set(-4, -2, -3);
      scene.add(fillLight);

      const rimLight = new THREE.PointLight(0x818cf8, 3.0, 12);
      rimLight.position.set(0, 4, -4);
      scene.add(rimLight);

      // 3D Sculpted Typography Group: "LIDDY"
      const wordmarkGroup = new THREE.Group();
      scene.add(wordmarkGroup);

      const extrudeSettings: THREE.ExtrudeGeometryOptions = {
        depth: 0.28,
        bevelEnabled: true,
        bevelSegments: 4,
        steps: 1,
        bevelSize: 0.05,
        bevelThickness: 0.05,
      };

      const initFinish = FINISHES[0];
      letterMaterial = new THREE.MeshPhysicalMaterial({
        color: initFinish.color.clone(),
        metalness: initFinish.metalness,
        roughness: initFinish.roughness,
        clearcoat: initFinish.clearcoat,
        clearcoatRoughness: initFinish.clearcoatRoughness,
        emissive: initFinish.emissive.clone(),
        emissiveIntensity: initFinish.emissiveIntensity,
        envMapIntensity: 1.6,
      });

      // Letter 1: 'L'
      const lGroup = new THREE.Group();
      lGroup.position.x = -1.95;
      wordmarkGroup.add(lGroup);

      const lShape = new THREE.Shape();
      lShape.moveTo(-0.42, 0.70);
      lShape.lineTo(-0.14, 0.70);
      lShape.lineTo(-0.14, -0.42);
      lShape.lineTo(0.42, -0.42);
      lShape.lineTo(0.42, -0.70);
      lShape.lineTo(-0.42, -0.70);
      lShape.closePath();

      lGeom = new THREE.ExtrudeGeometry(lShape, extrudeSettings);
      lGeom.center();
      const lMesh = new THREE.Mesh(lGeom, letterMaterial);
      lGroup.add(lMesh);

      // Intersecting Prism Blade
      const bladeShape = new THREE.Shape();
      bladeShape.moveTo(-0.12, -0.15);
      bladeShape.lineTo(0.36, 0.45);
      bladeShape.lineTo(0.50, 0.32);
      bladeShape.lineTo(0.12, -0.28);
      bladeShape.closePath();

      const bladeExtrude: THREE.ExtrudeGeometryOptions = {
        depth: 0.22,
        bevelEnabled: true,
        bevelSegments: 3,
        steps: 1,
        bevelSize: 0.04,
        bevelThickness: 0.04,
      };

      bladeGeom = new THREE.ExtrudeGeometry(bladeShape, bladeExtrude);
      bladeGeom.center();

      bladeMat = new THREE.MeshPhysicalMaterial({
        color: 0x6366f1,
        emissive: 0x4338ca,
        emissiveIntensity: 0.75,
        roughness: 0.1,
        metalness: 0.25,
        transmission: isSoftwareGl ? 0 : 0.65,
        thickness: 0.9,
        ior: 1.55,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
        transparent: true,
        opacity: 0.95,
        envMapIntensity: 2.0,
      });

      const bladeMesh = new THREE.Mesh(bladeGeom, bladeMat);
      bladeMesh.position.set(0.18, 0.08, 0.12);
      lGroup.add(bladeMesh);

      // Precision Dot Anchor
      anchorGeom = new THREE.SphereGeometry(0.08, 16, 16);
      anchorMat = new THREE.MeshStandardMaterial({
        color: 0x818cf8,
        emissive: 0x5e5ce6,
        emissiveIntensity: 1.5,
        metalness: 0.85,
        roughness: 0.1,
      });
      const anchorMesh = new THREE.Mesh(anchorGeom, anchorMat);
      anchorMesh.position.set(0.42, 0.26, 0.22);
      lGroup.add(anchorMesh);

      // Letter 2: 'I'
      const iShape = new THREE.Shape();
      iShape.moveTo(-0.14, -0.70);
      iShape.lineTo(0.14, -0.70);
      iShape.lineTo(0.14, 0.70);
      iShape.lineTo(-0.14, 0.70);
      iShape.closePath();

      iGeom = new THREE.ExtrudeGeometry(iShape, extrudeSettings);
      iGeom.center();
      const iMesh = new THREE.Mesh(iGeom, letterMaterial);
      iMesh.position.x = -1.05;
      wordmarkGroup.add(iMesh);

      // Letter 3: 'D' (First)
      const dShape = new THREE.Shape();
      dShape.moveTo(-0.42, 0.70);
      dShape.lineTo(0.0, 0.70);
      dShape.bezierCurveTo(0.55, 0.70, 0.55, -0.70, 0.0, -0.70);
      dShape.lineTo(-0.42, -0.70);
      dShape.closePath();

      const dHole = new THREE.Path();
      dHole.moveTo(-0.14, 0.42);
      dHole.lineTo(0.0, 0.42);
      dHole.bezierCurveTo(0.28, 0.42, 0.28, -0.42, 0.0, -0.42);
      dHole.lineTo(-0.14, -0.42);
      dHole.closePath();
      dShape.holes.push(dHole);

      dGeom = new THREE.ExtrudeGeometry(dShape, extrudeSettings);
      dGeom.center();
      const dMesh1 = new THREE.Mesh(dGeom, letterMaterial);
      dMesh1.position.x = -0.15;
      wordmarkGroup.add(dMesh1);

      // Letter 4: 'D' (Second)
      const dMesh2 = new THREE.Mesh(dGeom, letterMaterial);
      dMesh2.position.x = 0.95;
      wordmarkGroup.add(dMesh2);

      // Letter 5: 'Y'
      const yShape = new THREE.Shape();
      yShape.moveTo(-0.14, -0.70);
      yShape.lineTo(0.14, -0.70);
      yShape.lineTo(0.14, -0.05);
      yShape.lineTo(0.45, 0.70);
      yShape.lineTo(0.19, 0.70);
      yShape.lineTo(0.0, 0.18);
      yShape.lineTo(-0.19, 0.70);
      yShape.lineTo(-0.45, 0.70);
      yShape.lineTo(-0.14, -0.05);
      yShape.closePath();

      yGeom = new THREE.ExtrudeGeometry(yShape, extrudeSettings);
      yGeom.center();
      const yMesh = new THREE.Mesh(yGeom, letterMaterial);
      yMesh.position.x = 1.95;
      wordmarkGroup.add(yMesh);

      const bbox = new THREE.Box3().setFromObject(wordmarkGroup);
      const centerOffset = new THREE.Vector3();
      bbox.getCenter(centerOffset);
      wordmarkGroup.position.x = -centerOffset.x;
      wordmarkGroup.position.y = -centerOffset.y;

      const pivotGroup = new THREE.Group();
      scene.add(pivotGroup);
      pivotGroup.add(wordmarkGroup);

      // Drag tilt interaction
      let isDragging = false;
      let prevPointerX = 0;
      let prevPointerY = 0;

      const onPointerDown = (e: PointerEvent) => {
        isDragging = true;
        prevPointerX = e.clientX;
        prevPointerY = e.clientY;
        container.setPointerCapture(e.pointerId);
      };

      const onPointerMove = (e: PointerEvent) => {
        if (!isDragging) return;
        const dx = e.clientX - prevPointerX;
        const dy = e.clientY - prevPointerY;
        prevPointerX = e.clientX;
        prevPointerY = e.clientY;

        _targetRot.y += dx * 0.007;
        _targetRot.x += dy * 0.005;
        _targetRot.x = Math.max(-0.45, Math.min(0.45, _targetRot.x));
      };

      const onPointerUp = (e: PointerEvent) => {
        isDragging = false;
        try {
          container.releasePointerCapture(e.pointerId);
        } catch {}
      };

      container.addEventListener('pointerdown', onPointerDown);
      container.addEventListener('pointermove', onPointerMove);
      container.addEventListener('pointerup', onPointerUp);
      container.addEventListener('pointercancel', onPointerUp);

      let isInViewport = false;
      let isRunning = false;
      const clock = new THREE.Clock();

      const renderFrame = () => {
        if (isDisposed || !renderer || !scene || !camera || !letterMaterial) return;
        const time = clock.getElapsedTime();

        const targetFinish = FINISHES[finishIndexRef.current];
        letterMaterial.color.lerp(targetFinish.color, 0.035);
        letterMaterial.emissive.lerp(targetFinish.emissive, 0.035);
        letterMaterial.metalness = THREE.MathUtils.lerp(letterMaterial.metalness, targetFinish.metalness, 0.035);
        letterMaterial.roughness = THREE.MathUtils.lerp(letterMaterial.roughness, targetFinish.roughness, 0.035);
        letterMaterial.clearcoatRoughness = THREE.MathUtils.lerp(letterMaterial.clearcoatRoughness, targetFinish.clearcoatRoughness, 0.035);

        const autoYaw = Math.sin(time * 0.75) * 0.38;
        const autoPitch = Math.cos(time * 0.95) * 0.06;
        const autoBob = Math.sin(time * 1.5) * 0.08;

        if (!isDragging) {
          _targetRot.x *= 0.95;
          _targetRot.y *= 0.97;
        }

        _currentRot.x += (_targetRot.x - _currentRot.x) * 0.1;
        _currentRot.y += (_targetRot.y - _currentRot.y) * 0.1;

        pivotGroup.rotation.y = autoYaw + _currentRot.y;
        pivotGroup.rotation.x = autoPitch + _currentRot.x;
        pivotGroup.position.y = autoBob;

        renderer.render(scene, camera);
      };

      const loop = () => {
        if (!isInViewport || isDisposed) {
          isRunning = false;
          return;
        }
        renderFrame();
        animId = requestAnimationFrame(loop);
      };

      const startLoop = () => {
        if (!isRunning && !isDisposed) {
          isRunning = true;
          animId = requestAnimationFrame(loop);
        }
      };

      const visibilityObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            isInViewport = entry.isIntersecting;
            if (isInViewport) {
              startLoop();
            }
          });
        },
        { threshold: 0.01, rootMargin: '100px' }
      );

      visibilityObserver.observe(container);

      const handleResize = () => {
        if (!container || !camera || !renderer) return;
        const w = container.clientWidth || 600;
        const h = typeof height === 'number' ? height : container.clientHeight || 360;
        camera.aspect = w / h;
        camera.position.z = w < 640 ? 8.2 : 6.4;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        if (isInViewport) {
          renderFrame();
        }
      };

      window.addEventListener('resize', handleResize);

      return () => {
        isDisposed = true;
        visibilityObserver.disconnect();
        cancelAnimationFrame(animId);
        window.removeEventListener('resize', handleResize);
        container.removeEventListener('pointerdown', onPointerDown);
        container.removeEventListener('pointermove', onPointerMove);
        container.removeEventListener('pointerup', onPointerUp);
        container.removeEventListener('pointercancel', onPointerUp);

        if (renderer && onContextLost) {
          try {
            renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
          } catch {}
        }

        try {
          renderer?.dispose();
          lGeom?.dispose();
          bladeGeom?.dispose();
          bladeMat?.dispose();
          anchorGeom?.dispose();
          anchorMat?.dispose();
          iGeom?.dispose();
          dGeom?.dispose();
          yGeom?.dispose();
          letterMaterial?.dispose();
          envTexture?.dispose();
        } catch {}

        if (renderer?.domElement && renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      };
    } catch (creationErr) {
      console.warn('WebGL context creation failed or blocked in ThreeLogoCanvas, gracefully enabling luxury CSS 3D fallback:', creationErr);
      setHasWebGlError(true);
    }
  }, [height, hasWebGlError]);

  return (
    <div className={`relative flex flex-col items-center justify-center select-none w-full ${className}`}>
      {/* 3D Canvas Stage (or Luxury CSS 3D Fallback if WebGL is blocked/unavailable) */}
      {!hasWebGlError ? (
        <div 
          ref={mountRef} 
          className="w-full flex items-center justify-center cursor-grab active:cursor-grabbing touch-none"
          style={{ height: typeof height === 'number' ? `${height}px` : height }}
          title="Interactive 3D Sculpted Wordmark — Drag to tilt"
        />
      ) : (
        <div 
          className="w-full flex items-center justify-center py-10 px-4"
          style={{ minHeight: typeof height === 'number' ? `${height}px` : height }}
        >
          {/* High-Fidelity 2.5D Sculpted Emblem Fallback */}
          <div className="relative group p-8 rounded-3xl bg-gradient-to-b from-neutral-900/40 via-neutral-900/10 to-transparent border border-neutral-800/40 backdrop-blur-sm flex flex-col items-center justify-center transition-transform duration-500 hover:scale-[1.02]">
            <div className="flex items-center gap-4 sm:gap-6">
              {/* Sculpted L-Emblem with blade and jewel */}
              <div 
                className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl p-3 flex items-center justify-center relative overflow-hidden transition-all duration-700"
                style={{
                  background: currentFinish.cssGradient,
                  boxShadow: currentFinish.cssShadow,
                  border: `2px solid ${currentFinish.cssBorder}`,
                }}
              >
                <div className="absolute inset-0 bg-white/20 blur-md pointer-events-none transform -skew-x-12 translate-x-[-100%] group-hover:translate-x-[200%] transition-transform duration-1000"></div>
                <svg className="w-12 h-12 relative z-10 drop-shadow-md" viewBox="0 0 32 32" fill="none">
                  <path d="M6 5C6 4.44772 6.44772 4 7 4H12C12.5523 4 13 4.44772 13 5V22H24C24.5523 22 25 22.4477 25 23V27C25 27.5523 24.5523 28 24 28H7C6.44772 28 6 27.5523 6 27V5Z" fill="#1e1b4b" fillOpacity="0.85" />
                  <path d="M13 14L22 5C22.3905 4.60948 23.0237 4.60948 23.4142 5L26 7.58579C26.3905 7.97631 26.3905 8.60948 26 9L18 17H13V14Z" fill="#6366f1" />
                  <circle cx="24.5" cy="14.5" r="2.5" fill="#818cf8" />
                </svg>
              </div>

              {/* Sculpted Typographic Wordmark */}
              <div className="flex flex-col">
                <span 
                  className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight font-sans transition-all duration-700"
                  style={{
                    background: currentFinish.cssGradient,
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.3))'
                  }}
                >
                  LIDDY
                </span>
                <span className="text-[11px] sm:text-xs font-mono font-bold uppercase tracking-[0.3em] text-neutral-400 mt-1">
                  Financial Telemetry
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Autonomous Finish Telemetry Indicator */}
      <div className="flex items-center gap-2 mt-2 px-3 py-1 rounded-full bg-neutral-100/80 dark:bg-neutral-900/80 border border-neutral-200/60 dark:border-neutral-800/60 backdrop-blur-md">
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
        <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          Finish: {currentFinish.name}
        </span>
      </div>
    </div>
  );
};

export default ThreeLogoCanvas;
