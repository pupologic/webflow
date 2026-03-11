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
  uniform sampler2D tClippingMask;
  uniform float uOpacity;
  uniform bool uIsClipped;
  
  varying vec2 vUv;
  
  void main() {
    vec4 texColor = texture2D(tDiffuse, vUv);
    
    if (uIsClipped) {
      vec4 maskColor = texture2D(tClippingMask, vUv);
      // Multiply the layer's alpha by the clipping parent's alpha
      texColor.a *= maskColor.a;
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
        tClippingMask: { value: null },
        uOpacity: { value: 1.0 },
        uIsClipped: { value: false }
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
    this.uniforms.uIsClipped.value = false;
    this.blending = blendMode;
  }

  setLayerClipped(texture: THREE.Texture, maskTexture: THREE.Texture, opacity: number, blendMode: THREE.Blending) {
    this.uniforms.tDiffuse.value = texture;
    this.uniforms.tClippingMask.value = maskTexture;
    this.uniforms.uOpacity.value = opacity;
    this.uniforms.uIsClipped.value = true;
    this.blending = blendMode;
  }
}
