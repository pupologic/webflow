import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useWebGLPaint } from '@/hooks/useWebGLPaint';
import type { BrushSettings } from '@/hooks/useWebGLPaint';

import grayClay from '@/matcap/gray_clay_010001.png';
import lightGrey from '@/matcap/light_grey_010001.png';
import merge1 from '@/matcap/merge0001.png';
import merge2 from '@/matcap/merge0002.png';
import warmClay from '@/matcap/warm_clay_010001.png';
import softlightGrey from '@/matcap/softlight_grey.png';

const MATCAPS_URLS: Record<string, string> = {
  'gray_clay_010001.png': grayClay,
  'light_grey_010001.png': lightGrey,
  'merge0001.png': merge1,
  'merge0002.png': merge2,
  'warm_clay_010001.png': warmClay,
  'softlight_grey.png': softlightGrey,
};

interface PaintableMeshProps {
  brushSettings: BrushSettings;
  modelParts: any[];
  modelTransform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
  onTextureChange?: (texture: THREE.Texture | null, previewCanvas?: HTMLCanvasElement) => void;
  showWireframe?: boolean;
  flatShading?: boolean;
  textureResolution?: number;
  matcapName?: string | null;
  objectColor?: string;
  roughness?: number;
  metalness?: number;
  onPaintingChange?: (isPainting: boolean) => void;
  onLayerControlsReady?: (controls: any) => void;
}

export const PaintableMesh: React.FC<PaintableMeshProps> = ({
  brushSettings,
  modelParts,
  modelTransform,
  onTextureChange,
  showWireframe = false,
  flatShading = false,
  textureResolution = 2048,
  matcapName = null,
  objectColor = '#e5e5e5',
  roughness = 0.8,
  metalness = 0.1,
  onPaintingChange,
  onLayerControlsReady,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const { camera, gl, size } = useThree();
  const pointerRafRef = useRef<number>(0);
  const [cursor, setCursor] = useState<{ point: THREE.Vector3; normal: THREE.Vector3; radius: number } | null>(null);
  
  const { 
    initPaintSystem, startPainting, paint, stopPainting,
    texture,
    previewCanvas,
    layers, activeLayerId, addLayer, removeLayer, updateLayer, setLayerActive, moveLayer, clearCanvas, fillCanvas, undo, redo, exportTexture
  } = useWebGLPaint(
    groupRef,
     brushSettings,
     [modelParts]
  );

  useEffect(() => {
    if (onLayerControlsReady) {
      onLayerControlsReady({ layers, activeLayerId, addLayer, removeLayer, updateLayer, setLayerActive, moveLayer, clearCanvas, fillCanvas, undo, redo, exportTexture });
    }
  }, [layers, activeLayerId, addLayer, removeLayer, updateLayer, setLayerActive, moveLayer, clearCanvas, fillCanvas, undo, redo, exportTexture, onLayerControlsReady]);

  // Initialize texture on mount and when resolution changes
  useEffect(() => {
    initPaintSystem(textureResolution);
  }, [initPaintSystem, textureResolution]);

  useEffect(() => {
    if (texture && onTextureChange) {
      onTextureChange(texture, previewCanvas);
    }
  }, [texture, previewCanvas, onTextureChange]);

  const [matcapTexture, setMatcapTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (matcapName && MATCAPS_URLS[matcapName]) {
      const loader = new THREE.TextureLoader();
      loader.load(MATCAPS_URLS[matcapName], (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        setMatcapTexture(texture);
      });
    } else {
      setMatcapTexture(null);
    }
  }, [matcapName]);

  // Update material when texture or material props change
  useEffect(() => {
    if (groupRef.current) {
      const newMaterial = (matcapName && matcapTexture)
        ? new THREE.MeshMatcapMaterial({ matcap: matcapTexture, map: texture || null, flatShading, color: objectColor })
        : new THREE.MeshStandardMaterial({ map: texture || null, roughness, metalness, flatShading, color: objectColor });

      groupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = newMaterial;
        }
      });
    }
  }, [texture, flatShading, matcapName, matcapTexture, objectColor, roughness, metalness]);

  const updateCursor = useCallback((hit: THREE.Intersection | undefined, pressure: number = 1.0) => {
    if (hit) {
      const dist = camera.position.distanceTo(hit.point);
      let radius = 0.1;
      const dynamicSize = brushSettings.size * Math.max(0.05, pressure);

      if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
        const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
        const worldHeight = 2 * dist * Math.tan(fov / 2);
        radius = (dynamicSize / size.height) * worldHeight * 0.5;
      } else {
        const ortho = camera as THREE.OrthographicCamera;
        const worldHeight = ortho.top - ortho.bottom;
        radius = (dynamicSize / size.height) * worldHeight * 0.5;
      }

      const normal = hit.face?.normal.clone() || new THREE.Vector3(0, 0, 1);
      // Transform normal by the intersected object's world matrix
      if (hit.object) {
         normal.transformDirection(hit.object.matrixWorld).normalize();
      }

      setCursor({ point: hit.point, normal, radius });
    } else {
      setCursor(null);
    }
  }, [camera, brushSettings.size, size.height]);

  // Hold latest interaction for throttled move
  const latestInteraction = useRef<{ hit: THREE.Intersection, pressure: number } | null>(null);

  const processPointerEvent = useCallback(() => {
    pointerRafRef.current = 0;
    const interaction = latestInteraction.current;
    if (!interaction) return;

    updateCursor(interaction.hit, interaction.pressure);
    paint(interaction.hit, interaction.pressure);
  }, [paint, updateCursor]);

  // Handle mouse events for painting
  const handlePointerDown = useCallback(
    (event: any) => {
      event.stopPropagation();
      const hit = event.intersections[0] as THREE.Intersection;
      if (!hit) return;
      
      const nativeEvent = event.nativeEvent as PointerEvent;
      let pressure = nativeEvent.pointerType === 'pen' ? nativeEvent.pressure : 1.0;
      if (pressure === 0 && nativeEvent.pointerType !== 'pen') pressure = 1.0;
      
      onPaintingChange?.(true);
      startPainting(hit, pressure);
      updateCursor(hit, pressure);
      gl.domElement.setPointerCapture(nativeEvent.pointerId);
    },
    [startPainting, updateCursor, onPaintingChange, gl]
  );

  const handlePointerMove = useCallback(
    (event: any) => {
      const hit = event.intersections[0] as THREE.Intersection;
      if (!hit) {
        setCursor(null);
        return;
      }
      
      const nativeEvent = event.nativeEvent as PointerEvent;

      // Skip cursor updates if we are using right/middle mouse buttons (Orbiting/Panning)
      // buttons > 1 means secondary buttons are pressed
      if (nativeEvent.pointerType === 'mouse' && nativeEvent.buttons > 1) {
        setCursor(null);
        return;
      }

      let pressure = nativeEvent.pointerType === 'pen' ? nativeEvent.pressure : 1.0;
      if (pressure === 0 && nativeEvent.pointerType !== 'pen') pressure = 1.0;
      
      latestInteraction.current = { hit, pressure };
      if (pointerRafRef.current === 0) {
        pointerRafRef.current = requestAnimationFrame(processPointerEvent);
      }
    },
    [processPointerEvent]
  );

  const handlePointerUp = useCallback(
    (event: any) => {
      event.stopPropagation();
      
      if (pointerRafRef.current !== 0) {
        cancelAnimationFrame(pointerRafRef.current);
        pointerRafRef.current = 0;
      }
      latestInteraction.current = null;

      onPaintingChange?.(false);
      stopPainting();
      
      const nativeEvent = event.nativeEvent;
      try {
        gl.domElement.releasePointerCapture(nativeEvent.pointerId);
      } catch (e) {
        // Ignore if pointer capture was not set
      }
    },
    [gl, stopPainting, onPaintingChange]
  );

  const handlePointerLeave = useCallback((event: any) => {
    handlePointerUp(event);
    setCursor(null);
  }, [handlePointerUp]);

  useEffect(() => {
    return () => {
      if (pointerRafRef.current !== 0) {
        cancelAnimationFrame(pointerRafRef.current);
      }
    };
  }, []);

  // Geometry is passed directly to the mesh props to avoid R3F <primitive> attach/detach issues across multiple meshes

  return (
    <>
      <group position={modelTransform?.position} rotation={modelTransform?.rotation} scale={modelTransform?.scale}>
        {/* Main paintable group containing all visible submeshes */}
        <group ref={groupRef}>
        {modelParts.length > 0 ? (
          modelParts.map((part) => {
            if (!part.visible) return null;
            return (
              <mesh
                key={part.id}
                geometry={part.geometry}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerLeave}
              />
            );
          })
        ) : (
          <mesh
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
          >
            <sphereGeometry args={[2, 128, 128]} />
          </mesh>
        )}
      </group>

      {/* Wireframe overlay group */}
      {showWireframe && (
        <group>
          {modelParts.length > 0 ? (
            modelParts.map((part) => {
              if (!part.visible) return null;
              return (
                <mesh key={`wire-${part.id}`} geometry={part.geometry}>
                  <meshBasicMaterial
                    color="#00ff00"
                    wireframe
                    transparent
                    opacity={0.3}
                    depthTest={false}
                  />
                </mesh>
              );
            })
          ) : (
            <mesh>
              <sphereGeometry args={[2, 128, 128]} />
              <meshBasicMaterial
                color="#00ff00"
                wireframe
                transparent
                opacity={0.3}
              />
            </mesh>
          )}
        </group>
      )}

      </group>

      {/* Brush Cursor Indicator */}
      {cursor && (
        <mesh 
          position={cursor!.point} 
          quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), cursor!.normal)}
        >
          <ringGeometry args={[cursor!.radius * 0.9, cursor!.radius, 32]} />
          <meshBasicMaterial 
            color={brushSettings.color} 
            opacity={0.6} 
            transparent 
            depthTest={false} 
            depthWrite={false} 
            side={THREE.DoubleSide} 
          />
        </mesh>
      )}
    </>
  );
};
