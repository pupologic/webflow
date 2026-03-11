import * as THREE from 'three';

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform sampler2D tDiffuse;
  uniform sampler2D tLayerMask;
  uniform float uOpacity;
  uniform bool uHasMask;
  
  varying vec2 vUv;
  
  void main() {
    vec4 texColor = texture2D(tDiffuse, vUv);
    
    if (uHasMask) {
      vec4 maskColor = texture2D(tLayerMask, vUv);
      // Multiply the layer's alpha by the mask's alpha (or r)
      texColor.a *= (maskColor.a * maskColor.r); // Allows either pure white+alpha or grayscale black/white masking
      
      // If we use brush color for masking, multiplying by both ensures it works whether 
      // the mask is painted black/white (r=0 vs r=1) or transparent/opaque (a=0 vs a=1)
      // Actually, normally masks are white=visible, black/transparent=hidden.
      // Easiest is to just read maskColor.a if we keep our brush logic the same.
      // Let's just use maskColor.a so it behaves like a standard alpha mask.
    }
    
    // RGB is premultiplied or blended by THREE.js blending modes later
    gl_FragColor = vec4(texColor.rgb, texColor.a * uOpacity);
  }
`;

export class CompositeShaderMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        tDiffuse: { value: null },
        tLayerMask: { value: null },
        uOpacity: { value: 1.0 },
        uHasMask: { value: false }
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.NormalBlending
    });
  }

  setLayer(texture: THREE.Texture, opacity: number, blendMode: THREE.Blending) {
    this.uniforms.tDiffuse.value = texture;
    this.uniforms.uOpacity.value = opacity;
    this.uniforms.uHasMask.value = false;
    this.blending = blendMode;
  }

  setLayerMasked(texture: THREE.Texture, maskTexture: THREE.Texture, opacity: number, blendMode: THREE.Blending) {
    this.uniforms.tDiffuse.value = texture;
    this.uniforms.tLayerMask.value = maskTexture;
    this.uniforms.uOpacity.value = opacity;
    this.uniforms.uHasMask.value = true;
    this.blending = blendMode;
  }
}
