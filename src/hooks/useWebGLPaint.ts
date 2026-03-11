import { useState, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { BrushShaderMaterial } from '../components/3d/materials/BrushShaderMaterial';
import { DilationShaderMaterial } from '../components/3d/materials/DilationShaderMaterial';
import { CompositeShaderMaterial } from '../components/3d/materials/CompositeShaderMaterial';
import type { OverlayData } from '../components/ui-custom/OverlayManager';

export type BrushSettings = {
  color: string;
  size: number;
  opacity: number;
  hardness: number;
  type: 'circle' | 'square' | 'texture';
  textureId?: string | null;
  mode: 'paint' | 'erase';
  spacing: number;
  lazyMouse?: boolean;
  lazyRadius?: number;
  jitterSize?: number;
  jitterAngle?: boolean;
  jitterOpacity?: number;
  symmetryMode?: 'none' | 'mirror' | 'radial';
  symmetryAxis?: 'x' | 'y' | 'z';
  radialPoints?: number;
};

export interface GPULayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: THREE.Blending;
  target: THREE.WebGLRenderTarget | null; // Null for folders
  isFolder?: boolean;
  parentId?: string; // For UI organization
  clippingParentId?: string; // For alpha masking
}

const MAX_HISTORY = 10;

export function useWebGLPaint(
  groupRef: React.RefObject<THREE.Group | null>,
  brushSettings: BrushSettings,
  updateDependencies: any[] = [],
  activeStencil?: OverlayData
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
    decalMesh: new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), // NDC quad
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
    compositeMaterials: new Map<string, CompositeShaderMaterial>(),
    textureCache: new Map<string, THREE.Texture>(),

    lastHitPoint: new THREE.Vector3(),
    lastPressure: 1.0,
    previewCanvas: document.createElement('canvas'),
    previewContext: null as CanvasRenderingContext2D | null,
    previewTarget: null as THREE.WebGLRenderTarget | null,
    previewBlitMaterial: null as THREE.MeshBasicMaterial | null,
    lastSyncTime: 0,
    staggerStep: 0, // 0: Idle, 1: Full Dilation, 2: Sync Preview
    lazyPoint: new THREE.Vector3(),
    hasLazyPoint: false,
    
    // Stencil State
    stencilTexture: null as THREE.Texture | null,
    stencilMatrix: new THREE.Matrix3()
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
    const mat = new THREE.MeshBasicMaterial({ 
      map: source.texture, 
      depthTest: false, 
      depthWrite: false, 
      transparent: true,
      blending: THREE.NoBlending
    });
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
    
    // If it's the first layer, fill with white, else transparent
    if (layers.length === 0) {
      gl.setClearColor(0xffffff, 1); 
    } else {
      gl.setClearColor(0x000000, 0); 
    }
    
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
      // Unshift to put the new layer at the top (index 0)
      const updated = [newLayer, ...prev];
      if (!activeLayerId) setActiveLayerId(newLayer.id);
      return updated;
    });
    
    state.needsComposite = true;
  }, [activeLayerId, gl]);

  // ---- Painting Logic ----
  const saveUndoState = useCallback(() => {
    const active = getActiveLayer();
    if (!active || !active.target) return;
    
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

  const drawStamp = useCallback((
    worldPos: THREE.Vector3, 
    activeLayer: GPULayer, 
    pressure: number = 1.0, 
    normal: THREE.Vector3 = new THREE.Vector3(0, 0, 1),
    angle: number = 0.0
  ) => {
    const state = stateRef.current;
    const { color, opacity, hardness, type, mode, size, jitterSize } = brushSettings;

    const dist = camera.position.distanceTo(worldPos);
    let worldRadius = 0.1;
    
    // Apply Size Jitter
    let dynamicSize = size * Math.max(0.05, pressure);
    if (jitterSize) {
      dynamicSize *= (1.0 + (Math.random() * 2.0 - 1.0) * jitterSize);
    }

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
    let brushTex = null;
    if (type === 'texture' && brushSettings.textureId) {
      brushTex = state.textureCache.get(brushSettings.textureId) || null;
    }
    
    // Stencil Setup
    let stencilTex = null;
    let stencilMat = null;
    
    if (activeStencil && activeStencil.imageUrl) {
      // 1. Load Stencil Texture (cached)
      if (!state.textureCache.has(activeStencil.imageUrl)) {
          new THREE.TextureLoader().load(activeStencil.imageUrl, (t) => {
              t.minFilter = THREE.LinearFilter;
              t.magFilter = THREE.LinearFilter;
              state.textureCache.set(activeStencil.imageUrl, t);
          });
      }
      stencilTex = state.textureCache.get(activeStencil.imageUrl) || null;
      
      // 2. Compute Inverse Transform Matrix
      // The DOM overlay transforms the image relative to its center point.
      // We need to map WebGL gl_FragCoord (0..width, 0..height) back to UV space (0..1, 0..1)
      if (stencilTex && stencilTex.image) {
          const img = stencilTex.image as HTMLImageElement;
          const imgAspect = img.width / img.height;
          // Calculate rendered dimensions based on "object-contain" constraints
          // The overlay uses max-width/max-height, so we need to infer the actual rendered box
          let w = img.width;
          let h = img.height;
          const maxDim = 800; // From OverlayManager CSS
          if (w > maxDim || h > maxDim) {
             if (w > h) { w = maxDim; h = maxDim / imgAspect; }
             else { h = maxDim; w = maxDim * imgAspect; }
          }
          w *= activeStencil.scale;
          h *= activeStencil.scale;
           
          // Create 3x3 Transformation Matrix matching the DOM
          // Forward transform: UV (0..1) -> Local Center (-w/2..w/2) -> Rotate -> Scale -> Translate -> Screen (x, y)
          const m = new THREE.Matrix3();
          
          m.set(
              1 / w, 0, 0,
              0, 1 / h, 0,
              0, 0, 1
          ); // Scale from Pixel to UV
          
          const angleRad = activeStencil.rotation * (Math.PI / 180);
          const c = Math.cos(-angleRad); // Inverse rotation
          const s = Math.sin(-angleRad);
          const rotM = new THREE.Matrix3().set(
              c, -s, 0,
              s, c, 0,
              0, 0, 1
          );
          m.multiply(rotM);
          
          const trM = new THREE.Matrix3().set(
              1, 0, -activeStencil.x + (w/2 * c - h/2 * s),
              0, 1, -activeStencil.y + (w/2 * s + h/2 * c),
              0, 0, 1
          );
          
          m.multiply(trM);

          // We actually build it simpler by doing the inverse sequence manually
          // 1. Move pixel to origin relative to stencil center
          // 2. Reverse rotation
          // 3. Reverse scale
          // 4. Move coordinates from center (-0.5..0.5) to UV (0..1)
          
          state.stencilMatrix.set(
             1, 0, -activeStencil.x,
             0, 1, -(window.innerHeight - activeStencil.y), // Flip Y because gl_FragCoord is bottom-left, DOM is top-left
             0, 0, 1
          );
          
          const rotInversed = new THREE.Matrix3().set(c, s, 0, -s, c, 0, 0, 0, 1); // Reverse rotation
          state.stencilMatrix.premultiply(rotInversed);
          
          const scaleInversed = new THREE.Matrix3().set(1/w, 0, 0, 0, 1/h, 0, 0, 0, 1);
          state.stencilMatrix.premultiply(scaleInversed);
          
          const centerToUv = new THREE.Matrix3().set(1, 0, 0.5, 0, 1, 0.5, 0, 0, 1);
          state.stencilMatrix.premultiply(centerToUv);
          
          stencilMat = state.stencilMatrix;
      }
    }

    state.brushMaterial.setBrush(
      color, 
      mode === 'erase' ? 1.0 : opacity, 
      worldPos, 
      worldRadius, 
      hardness, 
      type === 'square',
      brushTex,
      normal,
      angle,
      stencilTex,
      stencilMat
    );
    
    // Render
    const oldRT = gl.getRenderTarget();
    gl.autoClear = false;
    gl.setRenderTarget(activeLayer.target);

    const renderDecal = () => {
      if (groupRef.current) {
        groupRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh && child.visible) {
            state.decalMesh.geometry = child.geometry;
            child.matrixWorld.decompose(
              state.decalMesh.position,
              state.decalMesh.quaternion,
              state.decalMesh.scale
            );
            gl.render(state.decalScene, state.decalCamera);
          }
        });
      }
    };

    renderDecal();

    // Advanced Symmetry
    if (brushSettings.symmetryMode && brushSettings.symmetryMode !== 'none') {
      const mode = brushSettings.symmetryMode;
      const axis = brushSettings.symmetryAxis || 'x';
      
      if (mode === 'mirror') {
        const mirroredPos = worldPos.clone();
        const mirroredNormal = normal.clone();
        
        if (axis === 'x') { mirroredPos.x *= -1; mirroredNormal.x *= -1; }
        else if (axis === 'y') { mirroredPos.y *= -1; mirroredNormal.y *= -1; }
        else if (axis === 'z') { mirroredPos.z *= -1; mirroredNormal.z *= -1; }
        
        state.brushMaterial.setBrush(
          color, 
          brushSettings.mode === 'erase' ? 1.0 : opacity, 
          mirroredPos, 
          worldRadius, 
          hardness, 
          type === 'square',
          brushTex,
          mirroredNormal,
          angle
        );
        renderDecal();
      } 
      else if (mode === 'radial') {
        const points = brushSettings.radialPoints || 4;
        const angleStep = (Math.PI * 2) / points;
        
        for (let i = 1; i < points; i++) {
          const radialPos = worldPos.clone();
          const radialNormal = normal.clone();
          const theta = angleStep * i;
          
          if (axis === 'y') {
            // Rotate around Y axis
            const x = worldPos.x * Math.cos(theta) - worldPos.z * Math.sin(theta);
            const z = worldPos.x * Math.sin(theta) + worldPos.z * Math.cos(theta);
            radialPos.set(x, worldPos.y, z);
            
            const nx = normal.x * Math.cos(theta) - normal.z * Math.sin(theta);
            const nz = normal.x * Math.sin(theta) + normal.z * Math.cos(theta);
            radialNormal.set(nx, normal.y, nz);
          } else if (axis === 'x') {
            // Rotate around X axis
            const y = worldPos.y * Math.cos(theta) - worldPos.z * Math.sin(theta);
            const z = worldPos.y * Math.sin(theta) + worldPos.z * Math.cos(theta);
            radialPos.set(worldPos.x, y, z);
            
            const ny = normal.y * Math.cos(theta) - normal.z * Math.sin(theta);
            const nz = normal.y * Math.sin(theta) + normal.z * Math.cos(theta);
            radialNormal.set(normal.x, ny, nz);
          } else if (axis === 'z') {
            // Rotate around Z axis
            const x = worldPos.x * Math.cos(theta) - worldPos.y * Math.sin(theta);
            const y = worldPos.x * Math.sin(theta) + worldPos.y * Math.cos(theta);
            radialPos.set(x, y, worldPos.z);
            
            const nx = normal.x * Math.cos(theta) - normal.y * Math.sin(theta);
            const ny = normal.x * Math.sin(theta) + normal.y * Math.cos(theta);
            radialNormal.set(nx, ny, normal.z);
          }
          
          state.brushMaterial.setBrush(
            color, 
            brushSettings.mode === 'erase' ? 1.0 : opacity, 
            radialPos, 
            worldRadius, 
            hardness, 
            type === 'square',
            brushTex,
            radialNormal,
            angle
          );
          renderDecal();
        }
      }
    }

    gl.setRenderTarget(oldRT);
    gl.autoClear = true;
    state.needsComposite = true;
  }, [brushSettings, gl]);

  const startPainting = useCallback((intersection: THREE.Intersection, pressure: number = 1.0) => {
    const state = stateRef.current;
    if (!groupRef.current) return;
    
    state.isPainting = true;
    
    if (brushSettings.lazyMouse) {
      state.lazyPoint.copy(intersection.point);
      state.hasLazyPoint = true;
    }

    state.lastHitPoint.copy(intersection.point);
    state.lastPressure = pressure;
    saveUndoState();
    
    const activeLine = getActiveLayer();
    if (activeLine) {
      const normal = intersection.face?.normal.clone() || new THREE.Vector3(0, 0, 1);
      if (intersection.object) normal.transformDirection(intersection.object.matrixWorld).normalize();
      
      let angle = brushSettings.type === 'texture' ? Math.random() * Math.PI * 2 : 0;
      if (brushSettings.jitterAngle) angle = Math.random() * Math.PI * 2;
      
      let finalPressure = pressure;
      if (brushSettings.jitterOpacity) {
        finalPressure *= (1.0 - Math.random() * brushSettings.jitterOpacity);
      }

      drawStamp(intersection.point, activeLine, finalPressure, normal, angle);
    }
  }, [getActiveLayer, drawStamp, saveUndoState, groupRef]);

  const paint = useCallback((intersection: THREE.Intersection, targetPressure: number = 1.0) => {
    const state = stateRef.current;
    if (!state.isPainting) return;
    
    const activeLayer = getActiveLayer();
    if (!activeLayer) return;

    let currentPoint = intersection.point;

    // --- Lazy Mouse logic ---
    if (brushSettings.lazyMouse && state.hasLazyPoint) {
      const lazyRadius = brushSettings.lazyRadius || 0.1;
      const distToCursor = state.lazyPoint.distanceTo(currentPoint);
      
      if (distToCursor > lazyRadius) {
        const dir = new THREE.Vector3().subVectors(currentPoint, state.lazyPoint).normalize();
        state.lazyPoint.add(dir.multiplyScalar(distToCursor - lazyRadius));
      }
      currentPoint = state.lazyPoint.clone();
    }

    const distance = state.lastHitPoint.distanceTo(currentPoint);
    if (distance < 0.0001) return; // No move
    
    const distToCam = camera.position.distanceTo(currentPoint);
    let worldRadius = 0.1;
    
    // Base size (jitter is applied inside drawStamp)
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
    
    // Determine Normal
    const normal = intersection.face?.normal.clone() || new THREE.Vector3(0, 0, 1);
    if (intersection.object) normal.transformDirection(intersection.object.matrixWorld).normalize();

    // Interpolate in 3D space and pressure space
    for (let i = 1; i <= steps; i++) {
       const t = i / steps;
       const lerpPos = new THREE.Vector3().lerpVectors(state.lastHitPoint, currentPoint, t);
       const lerpPressure = THREE.MathUtils.lerp(state.lastPressure, targetPressure, t);
       
       let angle = brushSettings.type === 'texture' ? Math.random() * Math.PI * 2 : 0;
       if (brushSettings.jitterAngle) angle = Math.random() * Math.PI * 2;
       
       let finalPressure = lerpPressure;
       if (brushSettings.jitterOpacity) {
         finalPressure *= (1.0 - Math.random() * brushSettings.jitterOpacity);
       }
       
       drawStamp(lerpPos, activeLayer, finalPressure, normal, angle);
    }

    state.lastHitPoint.copy(currentPoint);
    state.lastPressure = targetPressure;
  }, [brushSettings.size, brushSettings.spacing, brushSettings.lazyMouse, brushSettings.lazyRadius, drawStamp, getActiveLayer, camera, canvasSize.height]);

  const stopPainting = useCallback(() => {
    stateRef.current.isPainting = false;
    stateRef.current.hasLazyPoint = false;
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

    const oldAutoClear = gl.autoClear;
    gl.autoClear = false;

    gl.setRenderTarget(state.compositeTarget);
    gl.setClearColor(0xffffff, 1); 
    gl.clear();

    // Render layers back-to-front (as index 0 is visually the top layer in UI)
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer.visible || layer.isFolder || !layer.target) continue;
      
      let mat = state.compositeMaterials.get(layer.id);
      if (!mat) {
        mat = new CompositeShaderMaterial();
        state.compositeMaterials.set(layer.id, mat);
      }
      
      // Check for clipping mask
      if (layer.clippingParentId) {
          const parentLayer = layers.find(l => l.id === layer.clippingParentId);
          if (parentLayer && parentLayer.target) {
              mat.setLayerClipped(layer.target.texture, parentLayer.target.texture, layer.opacity, layer.blendMode);
          } else {
              mat.setLayer(layer.target.texture, layer.opacity, layer.blendMode);
          }
      } else {
          mat.setLayer(layer.target.texture, layer.opacity, layer.blendMode);
      }

      state.compositeQuad.material = mat;
      gl.render(state.compositeScene, state.compositeCamera);
    }
    
    gl.autoClear = oldAutoClear;
    
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

  useEffect(() => {
    return () => {
      const state = stateRef.current;
      state.compositeTarget?.dispose();
      state.dilatedTarget?.dispose();
      state.uvMaskTarget?.dispose();
      state.previewTarget?.dispose();
      state.brushMaterial.dispose();
      state.uvMaskMaterial.dispose();
      state.dilationMaterial.dispose();
      state.previewBlitMaterial?.dispose();
      state.compositeMaterials.forEach(m => m.dispose());
    };
  }, []);

  // Sync geometry UV masks when parts change
  useEffect(() => {
    stateRef.current.needsUVMaskUpdate = true;
    stateRef.current.needsComposite = true;
  }, [groupRef, ...updateDependencies]);
  
  // Load Texture Mask on Demand
  useEffect(() => {
    if (brushSettings.type === 'texture' && brushSettings.textureId) {
      const state = stateRef.current;
      if (!state.textureCache.has(brushSettings.textureId)) {
        new THREE.TextureLoader().load(brushSettings.textureId, (tex) => {
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          state.textureCache.set(brushSettings.textureId!, tex);
        });
      }
    }
  }, [brushSettings.type, brushSettings.textureId]);

  // Provide texture out
  const texture = stateRef.current.dilatedTarget?.texture || null;
  const previewCanvas = stateRef.current.previewCanvas;

  // ---- Missing Layer Operations ----
  const removeLayer = useCallback((id: string) => {
    setLayers(prev => {
      const remaining = prev.filter(l => l.id !== id);
      const layerToRemove = prev.find(l => l.id === id);
      if (layerToRemove && layerToRemove.target) {
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

    const blitMat = new THREE.MeshBasicMaterial({ 
      map: sourceTarget.texture, 
      depthTest: false, 
      depthWrite: false,
      transparent: true,
      blending: THREE.NoBlending
    });
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
    if (activeLayer.target) {
        const currentState = cloneTarget(activeLayer.target);
        redoStackRef.current.push({ layerId: activeLayer.id, target: currentState });
    }

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
    if (activeLayer.target) {
        const currentState = cloneTarget(activeLayer.target);
        undoStackRef.current.push({ layerId: activeLayer.id, target: currentState });
    }

    const step = redoStackRef.current.pop();
    if (step) {
      restoreSnapshotToLayer(step.layerId, step.target);
      step.target.dispose();
    }
  }, [getActiveLayer, cloneTarget, restoreSnapshotToLayer]);

  const exportTexture = useCallback((format: 'png' | 'jpeg') => {
    const state = stateRef.current;
    if (!state.compositeTarget) return null;

    const oldRT = gl.getRenderTarget();
    const oldAutoClear = gl.autoClear;
    gl.autoClear = false;

    // --- Special Export Pass (Transparent if PNG) ---
    gl.setRenderTarget(state.compositeTarget);
    if (format === 'png') {
        gl.setClearColor(0x000000, 0); 
    } else {
        gl.setClearColor(0xffffff, 1);
    }
    gl.clear();

    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer.visible || layer.isFolder || !layer.target) continue;
      
      let mat = state.compositeMaterials.get(layer.id);
      if (mat) {
        // Re-apply properties in case they were modified elsewhere before export
        if (layer.clippingParentId) {
            const parentLayer = layers.find(l => l.id === layer.clippingParentId);
            if (parentLayer && parentLayer.target) {
                mat.setLayerClipped(layer.target.texture, parentLayer.target.texture, layer.opacity, layer.blendMode);
            } else {
                mat.setLayer(layer.target.texture, layer.opacity, layer.blendMode);
            }
        } else {
            mat.setLayer(layer.target.texture, layer.opacity, layer.blendMode);
        }
        
        state.compositeQuad.material = mat;
        gl.render(state.compositeScene, state.compositeCamera);
      }
    }

    // Run dilation on this new composite
    if (state.uvMaskTarget) {
      gl.setRenderTarget(state.dilatedTarget);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      state.dilationMaterial.setMap(state.compositeTarget.texture, state.uvMaskTarget.texture, state.textureSize, state.textureSize, 16.0);
      state.compositeQuad.material = state.dilationMaterial;
      gl.render(state.compositeScene, state.compositeCamera);
    }

    const width = state.textureSize;
    const height = state.textureSize;
    const buffer = new Uint8Array(width * height * 4);
    
    gl.readRenderTargetPixels(state.dilatedTarget!, 0, 0, width, height, buffer);
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      gl.setRenderTarget(oldRT);
      gl.autoClear = oldAutoClear;
      return null;
    }
    
    const imgData = new ImageData(new Uint8ClampedArray(buffer), width, height);
    ctx.putImageData(imgData, 0, 0);

    // WebGL readPixels is upside down compared to Canvas 2D
    const flipCanvas = document.createElement('canvas');
    flipCanvas.width = width;
    flipCanvas.height = height;
    const flipCtx = flipCanvas.getContext('2d');
    let finalDataUrl = '';
    
    if (flipCtx) {
      flipCtx.translate(0, height);
      flipCtx.scale(1, -1);
      flipCtx.drawImage(canvas, 0, 0);
      finalDataUrl = flipCanvas.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png');
    } else {
      finalDataUrl = canvas.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png');
    }

    gl.setRenderTarget(oldRT);
    gl.autoClear = oldAutoClear;
    
    // Trigger a normal composite update for the viewport after we messed with the target
    state.needsComposite = true;

    return finalDataUrl;
  }, [gl, layers]);

  const sampleColor = useCallback((intersection: THREE.Intersection) => {
    const state = stateRef.current;
    if (!state.dilatedTarget || !intersection.uv) return '#ffffff';

    const width = state.textureSize;
    const height = state.textureSize;
    const x = Math.floor(intersection.uv.x * width);
    const y = Math.floor(intersection.uv.y * height);
    
    const buffer = new Uint8Array(4);
    gl.readRenderTargetPixels(state.dilatedTarget, x, y, 1, 1, buffer);
    
    const r = buffer[0].toString(16).padStart(2, '0');
    const g = buffer[1].toString(16).padStart(2, '0');
    const b = buffer[2].toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
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
    sampleColor,
  };
}
