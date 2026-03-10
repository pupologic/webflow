import { useState, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { BrushShaderMaterial } from '../components/3d/materials/BrushShaderMaterial';
import { DilationShaderMaterial } from '../components/3d/materials/DilationShaderMaterial';

export type BrushSettings = {
  color: string;
  size: number;
  opacity: number;
  hardness: number;
  type: 'circle' | 'square' | 'texture';
  mode: 'paint' | 'erase';
  spacing: number;
};

export interface GPULayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: THREE.Blending;
  target: THREE.WebGLRenderTarget;
}

const MAX_HISTORY = 10;

export function useWebGLPaint(
  groupRef: React.RefObject<THREE.Group | null>,
  brushSettings: BrushSettings,
  updateDependencies: any[] = []
) {
  const { gl, camera, size: canvasSize } = useThree();
  const [layers, setLayers] = useState<GPULayer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);

  const stateRef = useRef({
    textureSize: 2048,
    isPainting: false,
    needsComposite: false,
    compositeTarget: null as THREE.WebGLRenderTarget | null,
    dilatedTarget: null as THREE.WebGLRenderTarget | null,
    uvMaskTarget: null as THREE.WebGLRenderTarget | null,
    needsUVMaskUpdate: false,
    
    decalScene: new THREE.Scene(),
    decalCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    decalMesh: new THREE.Mesh(),
    brushMaterial: new BrushShaderMaterial(),
    uvMaskMaterial: new THREE.ShaderMaterial({
      vertexShader: `void main() { gl_Position = vec4(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0, 0.0, 1.0); }`,
      fragmentShader: `void main() { gl_FragColor = vec4(1.0); }`,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    }),
    dilationMaterial: new DilationShaderMaterial(),
    
    compositeScene: new THREE.Scene(),
    compositeCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    compositeQuad: new THREE.Mesh(new THREE.PlaneGeometry(2, 2)),
    compositeMaterials: new Map<string, THREE.MeshBasicMaterial>(),

    lastHitPoint: new THREE.Vector3(),
    lastPressure: 1.0,
    previewCanvas: document.createElement('canvas'),
    previewContext: null as CanvasRenderingContext2D | null,
    previewTarget: null as THREE.WebGLRenderTarget | null,
    previewBlitMaterial: null as THREE.MeshBasicMaterial | null,
    lastSyncTime: 0,
    staggerStep: 0, // 0: Idle, 1: Full Dilation, 2: Sync Preview
  });

  const undoStackRef = useRef<{ layerId: string; target: THREE.WebGLRenderTarget }[]>([]);
  const redoStackRef = useRef<{ layerId: string; target: THREE.WebGLRenderTarget }[]>([]);

  // ---- Setup ----
  const initPaintSystem = useCallback((size: number) => {
    const state = stateRef.current;
    if (state.compositeTarget) state.compositeTarget.dispose();
    if (state.dilatedTarget) state.dilatedTarget.dispose();
    if (state.uvMaskTarget) state.uvMaskTarget.dispose();

    state.textureSize = size;
    const targetOpts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      generateMipmaps: false,
    };
    state.compositeTarget = new THREE.WebGLRenderTarget(size, size, targetOpts);
    state.dilatedTarget = new THREE.WebGLRenderTarget(size, size, targetOpts);
    state.uvMaskTarget = new THREE.WebGLRenderTarget(size, size, targetOpts);

    state.decalMesh.material = state.brushMaterial;
    state.decalScene.add(state.decalMesh);
    state.compositeScene.add(state.compositeQuad);

    state.previewCanvas.width = 512; // Sufficient for UI preview
    state.previewCanvas.height = 512;
    state.previewContext = state.previewCanvas.getContext('2d', { willReadFrequently: true });

    if (state.previewTarget) state.previewTarget.dispose();
    state.previewTarget = new THREE.WebGLRenderTarget(512, 512, targetOpts);
    
    if (state.previewBlitMaterial) state.previewBlitMaterial.dispose();
    state.previewBlitMaterial = new THREE.MeshBasicMaterial({ transparent: false, depthTest: false, depthWrite: false });

    addLayer('Base Layer');
    state.needsUVMaskUpdate = true;
    state.needsComposite = true;
  }, []);

  const cloneTarget = useCallback((source: THREE.WebGLRenderTarget) => {
    const clone = source.clone();
    // Copy data from source to clone
    const renderer = gl;
    const currentTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(clone);
    // Use the composite scene/quad to blit the texture
    const mat = new THREE.MeshBasicMaterial({ map: source.texture, depthTest: false, depthWrite: false, transparent: false });
    const oldMat = stateRef.current.compositeQuad.material;
    stateRef.current.compositeQuad.material = mat;
    renderer.render(stateRef.current.compositeScene, stateRef.current.compositeCamera);
    stateRef.current.compositeQuad.material = oldMat;
    mat.dispose();
    renderer.setRenderTarget(currentTarget);
    return clone;
  }, [gl]);

  // ---- Layer Management ----
  const getActiveLayer = useCallback(() => {
    return layers.find(l => l.id === activeLayerId);
  }, [layers, activeLayerId]);

  const addLayer = useCallback((nameArg: any = 'New Layer') => {
    const name = (typeof nameArg === 'string') ? nameArg : 'New Layer';
    const state = stateRef.current;
    const newTarget = new THREE.WebGLRenderTarget(state.textureSize, state.textureSize, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      generateMipmaps: false,
    });

    // Clear it
    const oldRT = gl.getRenderTarget();
    gl.setRenderTarget(newTarget);
    gl.setClearColor(0x000000, 0); 
    gl.clear();
    gl.setRenderTarget(oldRT);

    const newLayer: GPULayer = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      visible: true,
      opacity: 1,
      blendMode: THREE.NormalBlending,
      target: newTarget,
    };

    setLayers(prev => {
      const updated = [...prev, newLayer];
      if (!activeLayerId) setActiveLayerId(newLayer.id);
      return updated;
    });
    
    state.needsComposite = true;
  }, [activeLayerId, gl]);

  // ---- Painting Logic ----
  const saveUndoState = useCallback(() => {
    const active = getActiveLayer();
    if (!active) return;
    
    // Clear redo stack on new action
    redoStackRef.current.forEach(item => item.target.dispose());
    redoStackRef.current = [];

    // Push clone to undo
    const snapshot = cloneTarget(active.target);
    undoStackRef.current.push({ layerId: active.id, target: snapshot });
    
    if (undoStackRef.current.length > MAX_HISTORY) {
      const oldest = undoStackRef.current.shift();
      if (oldest) oldest.target.dispose();
    }
  }, [getActiveLayer, cloneTarget]);

  const drawStamp = useCallback((worldPos: THREE.Vector3, activeLayer: GPULayer, pressure: number = 1.0) => {
    const state = stateRef.current;
    const { color, opacity, hardness, type, mode, size } = brushSettings;

    const dist = camera.position.distanceTo(worldPos);
    let worldRadius = 0.1;
    const dynamicSize = size * Math.max(0.05, pressure);

    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
      const worldHeight = 2 * dist * Math.tan(fov / 2);
      worldRadius = (dynamicSize / canvasSize.height) * worldHeight * 0.5;
    } else {
      const ortho = camera as THREE.OrthographicCamera;
      const worldHeight = ortho.top - ortho.bottom;
      worldRadius = (dynamicSize / canvasSize.height) * worldHeight * 0.5;
    }

    // Setup material for decal
    state.brushMaterial.setBrush(color, mode === 'erase' ? 1.0 : opacity, worldPos, worldRadius, hardness, type === 'square');
    
    if (mode === 'erase') {
      state.brushMaterial.blending = THREE.CustomBlending;
      state.brushMaterial.blendEquation = THREE.AddEquation;
      state.brushMaterial.blendSrc = THREE.ZeroFactor;
      state.brushMaterial.blendDst = THREE.OneMinusSrcAlphaFactor;
    } else {
      state.brushMaterial.blending = THREE.NormalBlending;
    }

    // Render directly to the layer's target
    const oldRT = gl.getRenderTarget();
    gl.autoClear = false;
    gl.setRenderTarget(activeLayer.target);

    if (groupRef.current) {
      groupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh && child.visible) {
          state.decalMesh.geometry = child.geometry;
          
          // Decompose the child's true World matrix into the decalMesh's local SRT
          // This ensures that when gl.render() implicitly triggers updateMatrixWorld(),
          // the matrix does not revert to Identity!
          child.matrixWorld.decompose(
            state.decalMesh.position,
            state.decalMesh.quaternion,
            state.decalMesh.scale
          );
          
          gl.render(state.decalScene, state.decalCamera);
        }
      });
    }

    gl.setRenderTarget(oldRT);
    gl.autoClear = true;

    state.needsComposite = true;
  }, [brushSettings, gl]);

  const startPainting = useCallback((intersection: THREE.Intersection, pressure: number = 1.0) => {
    const state = stateRef.current;
    if (!groupRef.current) return;
    
    state.isPainting = true;
    state.lastHitPoint.copy(intersection.point);
    state.lastPressure = pressure;
    saveUndoState();
    
    const activeLine = getActiveLayer();
    if (activeLine) drawStamp(intersection.point, activeLine, pressure);
  }, [getActiveLayer, drawStamp, saveUndoState, groupRef]);

  const paint = useCallback((intersection: THREE.Intersection, targetPressure: number = 1.0) => {
    const state = stateRef.current;
    if (!state.isPainting) return;
    
    const activeLayer = getActiveLayer();
    if (!activeLayer) return;

    const currentPoint = intersection.point;
    const distance = state.lastHitPoint.distanceTo(currentPoint);
    
    const distToCam = camera.position.distanceTo(currentPoint);
    let worldRadius = 0.1;
    const dynamicSize = brushSettings.size * Math.max(0.05, targetPressure);

    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
      const worldHeight = 2 * distToCam * Math.tan(fov / 2);
      worldRadius = (dynamicSize / canvasSize.height) * worldHeight * 0.5;
    } else {
      const ortho = camera as THREE.OrthographicCamera;
      const worldHeight = ortho.top - ortho.bottom;
      worldRadius = (dynamicSize / canvasSize.height) * worldHeight * 0.5;
    }

    const stepDist = Math.max(0.001, worldRadius * brushSettings.spacing);
    const steps = Math.ceil(distance / stepDist);
    
    // Interpolate in 3D space and pressure space
    for (let i = 1; i <= steps; i++) {
       const t = i / steps;
       const lerpPos = new THREE.Vector3().lerpVectors(state.lastHitPoint, currentPoint, t);
       const lerpPressure = THREE.MathUtils.lerp(state.lastPressure, targetPressure, t);
       drawStamp(lerpPos, activeLayer, lerpPressure);
    }

    state.lastHitPoint.copy(currentPoint);
    state.lastPressure = targetPressure;
  }, [brushSettings.size, brushSettings.spacing, drawStamp, getActiveLayer, camera, canvasSize.height]);

  const stopPainting = useCallback(() => {
    stateRef.current.isPainting = false;
    stateRef.current.staggerStep = 1; // Start post-stroke cleanup staggered
    stateRef.current.needsComposite = true;
  }, []);

  const syncPreviewCanvas = useCallback(() => {
    const state = stateRef.current;
    if (!state.previewContext || !state.dilatedTarget || !state.previewTarget || !state.previewBlitMaterial) return;

    const size = 512;
    const renderer = gl;
    const oldRT = renderer.getRenderTarget();
    
    // Use pooled resources
    renderer.setRenderTarget(state.previewTarget);
    state.previewBlitMaterial.map = state.dilatedTarget.texture;
    state.compositeQuad.material = state.previewBlitMaterial;
    renderer.render(state.compositeScene, state.compositeCamera);
    
    // Read pixels (Expensive!)
    const pixelBuffer = new Uint8Array(size * size * 4);
    gl.readRenderTargetPixels(state.previewTarget, 0, 0, size, size, pixelBuffer);
    
    const imageData = new ImageData(new Uint8ClampedArray(pixelBuffer), size, size);
    state.previewContext.putImageData(imageData, 0, 0);

    // Efficient flip Y on 2D context
    const canvas = state.previewCanvas;
    const ctx = state.previewContext;
    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.scale(1, -1);
    ctx.drawImage(canvas, 0, -size);
    ctx.restore();

    renderer.setRenderTarget(oldRT);
    
    (state.previewCanvas as any).version = ((state.previewCanvas as any).version || 0) + 1;
  }, [gl]);

  // ---- RAF Compositor ----
  const compositeAllLayers = useCallback(() => {
    const state = stateRef.current;
    if (!state.compositeTarget || layers.length === 0) return;

    const oldRT = gl.getRenderTarget();
    // --- Render UV Mask if needed ---
    if (state.needsUVMaskUpdate && state.uvMaskTarget) {
      gl.setRenderTarget(state.uvMaskTarget);
      gl.setClearColor(0x000000, 1);
      gl.clear();
      const oldMat = state.decalMesh.material;
      state.decalMesh.material = state.uvMaskMaterial;
      
      if (groupRef.current) {
        groupRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh && child.visible) {
            state.decalMesh.geometry = child.geometry;
            gl.render(state.decalScene, state.decalCamera);
          }
        });
      }

      state.decalMesh.material = oldMat;
      state.needsUVMaskUpdate = false;
      gl.setRenderTarget(oldRT);
    }

    gl.setRenderTarget(state.compositeTarget);
    gl.setClearColor(0xffffff, 1); 
    gl.clear();

    for (const layer of layers) {
      if (!layer.visible) continue;
      
      let mat = state.compositeMaterials.get(layer.id);
      if (!mat) {
        mat = new THREE.MeshBasicMaterial({ 
          map: layer.target.texture, 
          transparent: true,
          opacity: layer.opacity,
          blending: layer.blendMode,
          depthTest: false,
          depthWrite: false
        });
        state.compositeMaterials.set(layer.id, mat);
      } else {
        mat.map = layer.target.texture;
        mat.opacity = layer.opacity;
        mat.blending = layer.blendMode;
      }

        state.compositeQuad.material = mat;
      gl.render(state.compositeScene, state.compositeCamera);
    }
    
    // --- Dilation (Edge Padding) Pass ---
    if (state.uvMaskTarget) {
      gl.setRenderTarget(state.dilatedTarget);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      
      // Use low radius during painting, full radius during idle or stagger step 1
      const isFinalizing = state.staggerStep === 1;
      const currentRadius = (state.isPainting) ? 2.0 : 16.0;
      
      state.dilationMaterial.setMap(state.compositeTarget.texture, state.uvMaskTarget.texture, state.textureSize, state.textureSize, currentRadius);
      state.compositeQuad.material = state.dilationMaterial;
      gl.render(state.compositeScene, state.compositeCamera);
      
      if (isFinalizing) state.staggerStep = 2; // Move to next stagger step
    }
    
    gl.setRenderTarget(null);
    state.needsComposite = false;
    
    // We handle SyncPreview separately in the loop for staggering
  }, [gl, layers]);

  useEffect(() => {
    let animId: number;
    const loop = () => {
      const state = stateRef.current;
      if (state.needsComposite) {
        compositeAllLayers();
      } else if (state.staggerStep === 2) {
        // Run sync on a separate frame after dilation to prevent single-frame spikes
        syncPreviewCanvas();
        state.staggerStep = 0;
      }
      animId = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(animId);
  }, [compositeAllLayers, syncPreviewCanvas]);

  // Sync geometry UV masks when parts change
  useEffect(() => {
    stateRef.current.needsUVMaskUpdate = true;
    stateRef.current.needsComposite = true;
  }, [groupRef, ...updateDependencies]);

  // Provide texture out
  const texture = stateRef.current.dilatedTarget?.texture || null;
  const previewCanvas = stateRef.current.previewCanvas;

  // ---- Missing Layer Operations ----
  const removeLayer = useCallback((id: string) => {
    setLayers(prev => {
      const remaining = prev.filter(l => l.id !== id);
      const layerToRemove = prev.find(l => l.id === id);
      if (layerToRemove) {
        layerToRemove.target.dispose();
      }
      
      if (activeLayerId === id && remaining.length > 0) {
        setActiveLayerId(remaining[remaining.length - 1].id);
      } else if (remaining.length === 0) {
        setActiveLayerId(null);
      }
      return remaining;
    });
    stateRef.current.needsComposite = true;
  }, [activeLayerId]);

  const updateLayer = useCallback((id: string, updates: Partial<GPULayer>) => {
    setLayers(prev => prev.map(l => (l.id === id ? { ...l, ...updates } : l)));
    if (updates.visible !== undefined || updates.opacity !== undefined || updates.blendMode !== undefined) {
      stateRef.current.needsComposite = true;
    }
  }, []);

  const moveLayer = useCallback((id: string, direction: 'up' | 'down') => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx < 0) return prev;
      if (direction === 'up' && idx > 0) {
        const next = [...prev];
        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
        return next;
      }
      if (direction === 'down' && idx < prev.length - 1) {
        const next = [...prev];
        [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
        return next;
      }
      return prev;
    });
    stateRef.current.needsComposite = true;
  }, []);

  const clearCanvas = useCallback(() => {
    const active = getActiveLayer();
    if (!active) return;
    saveUndoState();

    const oldRT = gl.getRenderTarget();
    gl.setRenderTarget(active.target);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.setRenderTarget(oldRT);

    stateRef.current.needsComposite = true;
  }, [getActiveLayer, saveUndoState, gl]);

  const fillCanvas = useCallback(() => {
    const active = getActiveLayer();
    if (!active) return;
    saveUndoState();

    const oldRT = gl.getRenderTarget();
    gl.setRenderTarget(active.target);

    const fillMat = new THREE.MeshBasicMaterial({
      color: brushSettings.color,
      transparent: true,
      opacity: brushSettings.opacity,
      blending: brushSettings.mode === 'erase' ? THREE.CustomBlending : THREE.NormalBlending,
      blendEquation: brushSettings.mode === 'erase' ? THREE.AddEquation : THREE.AddEquation,
      blendSrc: brushSettings.mode === 'erase' ? THREE.ZeroFactor : THREE.SrcAlphaFactor,
      blendDst: brushSettings.mode === 'erase' ? THREE.OneMinusSrcAlphaFactor : THREE.OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false
    });

    const oldMat = stateRef.current.compositeQuad.material;
    stateRef.current.compositeQuad.material = fillMat;
    
    gl.render(stateRef.current.compositeScene, stateRef.current.compositeCamera);
    
    stateRef.current.compositeQuad.material = oldMat;
    fillMat.dispose();

    gl.setRenderTarget(oldRT);
    stateRef.current.needsComposite = true;
  }, [getActiveLayer, saveUndoState, gl, brushSettings]);

  const restoreSnapshotToLayer = useCallback((layerId: string, sourceTarget: THREE.WebGLRenderTarget) => {
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;

    const oldRT = gl.getRenderTarget();
    gl.setRenderTarget(layer.target);
    gl.setClearColor(0x000000, 0);
    gl.clear();

    const blitMat = new THREE.MeshBasicMaterial({ map: sourceTarget.texture, depthTest: false, depthWrite: false });
    const oldMat = stateRef.current.compositeQuad.material;
    stateRef.current.compositeQuad.material = blitMat;

    gl.render(stateRef.current.compositeScene, stateRef.current.compositeCamera);

    stateRef.current.compositeQuad.material = oldMat;
    blitMat.dispose();

    gl.setRenderTarget(oldRT);
    stateRef.current.needsComposite = true;
  }, [layers, gl]);

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    
    const activeLayer = getActiveLayer();
    if (!activeLayer) return;

    // Save current to redo before undoing
    const currentState = cloneTarget(activeLayer.target);
    redoStackRef.current.push({ layerId: activeLayer.id, target: currentState });

    const step = undoStackRef.current.pop();
    if (step) {
      restoreSnapshotToLayer(step.layerId, step.target);
      step.target.dispose(); // clean up memory after use
    }
  }, [getActiveLayer, cloneTarget, restoreSnapshotToLayer]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    
    const activeLayer = getActiveLayer();
    if (!activeLayer) return;

    // Save current to undo before redoing
    const currentState = cloneTarget(activeLayer.target);
    undoStackRef.current.push({ layerId: activeLayer.id, target: currentState });

    const step = redoStackRef.current.pop();
    if (step) {
      restoreSnapshotToLayer(step.layerId, step.target);
      step.target.dispose();
    }
  }, [getActiveLayer, cloneTarget, restoreSnapshotToLayer]);

  const exportTexture = useCallback((format: 'png' | 'jpeg') => {
    const state = stateRef.current;
    if (!state.dilatedTarget) return null;
    
    const width = state.textureSize;
    const height = state.textureSize;
    const buffer = new Uint8Array(width * height * 4);
    
    gl.readRenderTargetPixels(state.dilatedTarget, 0, 0, width, height, buffer);
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    const imgData = new ImageData(new Uint8ClampedArray(buffer), width, height);
    ctx.putImageData(imgData, 0, 0);

    // WebGL readPixels is upside down compared to Canvas 2D
    const flipCanvas = document.createElement('canvas');
    flipCanvas.width = width;
    flipCanvas.height = height;
    const flipCtx = flipCanvas.getContext('2d');
    if (flipCtx) {
      flipCtx.translate(0, height);
      flipCtx.scale(1, -1);
      flipCtx.drawImage(canvas, 0, 0);
      return flipCanvas.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png');
    }
    return canvas.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png');
  }, [gl]);

  return {
    initPaintSystem,
    startPainting,
    paint,
    stopPainting,
    textureSize: { width: stateRef.current.textureSize, height: stateRef.current.textureSize },
    texture,
    previewCanvas,
    syncPreviewCanvas,
    layers,
    activeLayerId,
    addLayer,
    removeLayer,
    updateLayer,
    setLayerActive: setActiveLayerId,
    moveLayer,
    clearCanvas,
    fillCanvas,
    undo,
    redo,
    exportTexture,
  };
}
