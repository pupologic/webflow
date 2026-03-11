import * as THREE from 'three';

const vertexShader = `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    // We apply the mesh's transform to get the true world position
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    // Map UV to NDC (Normalized Device Coordinates) [-1, 1]
    gl_Position = vec4(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const fragmentShader = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform vec3 uBrushPos;
  uniform vec3 uBrushNormal;
  uniform float uBrushAngle;
  uniform float uRadius;
  uniform float uHardness;
  uniform int uShape; 
  uniform sampler2D uBrushTexture;
  uniform bool uUseTexture;
  uniform bool uUseStencil;
  uniform sampler2D uStencilTexture;
  uniform mat3 uStencilMatrix; // Transform from Screen Space to Stencil UV Space
  uniform mat4 uVPMatrix; // View-Projection Matrix for screen space projection
  uniform int uStencilMode; // 0: Alpha, 1: Invert, 2: Luminance
  uniform bool uIsEraser;
  
    varying vec3 vWorldPos;
    varying vec3 vNormal;

    // Rotation matrix for brush randomness/angle
    mat2 rotate2d(float _angle){
        return mat2(cos(_angle),-sin(_angle),
                    sin(_angle),cos(_angle));
    }

    void main() {
      // 1. Normal Masking: Only paint surfaces facing the brush
      // Relaxed threshold (0.05) to prevent aggressive culling on curves
      float angleFactor = dot(normalize(vNormal), normalize(uBrushNormal));
      if (angleFactor < 0.05) discard; 

      // 2. Depth Masking: Converted to a deep volume (decal projector) for radial symmetry.
      // Meshes that aren't perfectly symmetrical cause projected points to float.
      // We now rely heavily on the normal angle culling to prevent back-face painting.
      float depthDist = abs(dot(vWorldPos - uBrushPos, normalize(uBrushNormal)));
      // Relaxed from 1.0 to 1.5 to allow radial symmetry to climb subtle curves without piercing entire arms/legs.
      if (depthDist > uRadius * 1.5) discard;

      float alphaMultiplier = 1.0;

      // 3. Project to 2D Plane (Decal Projection)
      // Vector from brush center to current pixel
      vec3 p = vWorldPos - uBrushPos;
      
      // Compute local Tangent and Bitangent to project 3D onto 2D plane
      vec3 up = abs(uBrushNormal.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      vec3 tangent = normalize(cross(up, normalize(uBrushNormal)));
      vec3 bitangent = cross(normalize(uBrushNormal), tangent);
      
      // Project to 2D local space
      vec2 localPos = vec2(dot(p, tangent), dot(p, bitangent));
      
      // Rotate local coordinates based on brush angle
      localPos = rotate2d(uBrushAngle) * localPos;

      if (!uUseTexture) {
        if (uShape == 0) {
          // Circle / Sphere logic but using 2D Planar Distance
          float dist = length(localPos);
          if (dist > uRadius) discard;
          
          // Calculate softness based on Hardness parameter
          float normalizedDist = dist / uRadius;
          alphaMultiplier = 1.0 - smoothstep(uHardness, 1.0, normalizedDist);
          
        } else {
          // Square logic using 2D Planar Distance
          vec2 d = abs(localPos);
          float maxDist = max(d.x, d.y);
          if (maxDist > uRadius) discard;
          
          // Square softness
          float normalizedDist = maxDist / uRadius;
          alphaMultiplier = 1.0 - smoothstep(uHardness, 1.0, normalizedDist);
        }
      } else {
        // Texture Projection
        if (length(localPos) > uRadius) discard; // Out of projected circle bounds
        
        // Map from [-radius, radius] to UV [0, 1]
        vec2 texUV = (localPos / (uRadius * 2.0)) + 0.5;
        
        // Clamp coordinates to prevent texture wrapping artifacts
        if (texUV.x < 0.0 || texUV.x > 1.0 || texUV.y < 0.0 || texUV.y > 1.0) discard;
        
        // Sample texture
        vec4 texColor = texture2D(uBrushTexture, texUV);
        
        // Handle masks: If texture is fully opaque (common with AI gen/JPEGs), use its luminance as the alpha mask.
        // Otherwise, use the actual alpha channel.
        if (texColor.a > 0.99) {
          alphaMultiplier = (texColor.r + texColor.g + texColor.b) / 3.0;
        } else {
          alphaMultiplier = texColor.a;
        }
        
        // Edge fade
        float dist = length(localPos) / uRadius;
        alphaMultiplier *= (1.0 - smoothstep(uHardness, 1.0, dist));
        
        if (alphaMultiplier <= 0.01) discard;
      }
      
      // Apply angle falloff for smoother edges on curved surfaces
      alphaMultiplier *= smoothstep(0.0, 0.2, angleFactor);

      // 4. Stencil Masking (Projected Screen Space)
      if (uUseStencil) {
          // Project world position to NDC space [-1, 1]
          vec4 projectedPos = uVPMatrix * vec4(vWorldPos, 1.0);
          vec2 screenPos = projectedPos.xy / projectedPos.w; // Perspective divide
          
          // Map NDC (-1..1) to Normalized Screen Coordinates (0..1)
          vec2 screenUV = screenPos * 0.5 + 0.5;
          
          // Apply Stencil Matrix (Maps 0..1 Screen space to Stencil UV space)
          vec3 stencilPos = uStencilMatrix * vec3(screenUV, 1.0);
          
          if (stencilPos.x >= 0.0 && stencilPos.x <= 1.0 && stencilPos.y >= 0.0 && stencilPos.y <= 1.0) {
              vec4 stencilColor = texture2D(uStencilTexture, vec2(stencilPos.x, stencilPos.y)); 
              
              // Calculate luminance
              float lum = (stencilColor.r + stencilColor.g + stencilColor.b) / 3.0;
              
              float stencilMask = 1.0;
              
              if (uStencilMode == 0) { // Alpha
                  stencilMask = stencilColor.a;
                  // Auto fallback to luminance if image has no transparency at all
                  if (stencilMask > 0.99 && stencilColor.r < 0.99) {
                     // stencilMask = lum; // Disabled auto-fallback to give user strict control via modes
                  }
              } else if (uStencilMode == 1) { // Invert (Inverts Alpha)
                  stencilMask = 1.0 - stencilColor.a;
              } else if (uStencilMode == 2) { // Luminance
                  stencilMask = lum * stencilColor.a; // Multiply by alpha so transparent areas don't paint out of nowhere
              }
              
              alphaMultiplier *= stencilMask;
          } else {
              // Outside stencil bounds: No paint allowed (standard stencil behavior)
              alphaMultiplier = 0.0;
          }
      }

      if (uIsEraser) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, alphaMultiplier * uOpacity);
      } else {
        gl_FragColor = vec4(uColor, uOpacity * alphaMultiplier);
      }
    }
  `;

export class BrushShaderMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColor: { value: new THREE.Color() },
        uOpacity: { value: 1.0 },
        uBrushPos: { value: new THREE.Vector3() },
        uRadius: { value: 0.1 },
        uHardness: { value: 1.0 },
        uShape: { value: 0 },
        uBrushNormal: { value: new THREE.Vector3(0, 0, 1) },
        uBrushAngle: { value: 0.0 },
        uUseTexture: { value: false },
        uBrushTexture: { value: null },
        uUseStencil: { value: false },
        uStencilTexture: { value: null },
        uStencilMatrix: { value: new THREE.Matrix3() },
        uVPMatrix: { value: new THREE.Matrix4() },
        uStencilMode: { value: 0 },
        uIsEraser: { value: false }
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  setBrush(
    color: string, 
    opacity: number, 
    worldPos: THREE.Vector3, 
    radius: number, 
    hardness: number, 
    isSquare: boolean, 
    texture: THREE.Texture | null = null,
    normal: THREE.Vector3 = new THREE.Vector3(0, 0, 1),
    angle: number = 0.0,
    stencilTexture: THREE.Texture | null = null,
    stencilMatrix: THREE.Matrix3 | null = null,
    vpMatrix: THREE.Matrix4 | null = null,
    stencilMode: number = 0
  ) {
    this.uniforms.uColor.value.set(color);
    this.uniforms.uOpacity.value = opacity;
    this.uniforms.uBrushPos.value.copy(worldPos);
    this.uniforms.uRadius.value = radius;
    this.uniforms.uHardness.value = hardness;
    this.uniforms.uShape.value = isSquare ? 1 : 0;
    this.uniforms.uBrushNormal.value.copy(normal);
    this.uniforms.uBrushAngle.value = angle;
    
    if (texture) {
      this.uniforms.uUseTexture.value = true;
      this.uniforms.uBrushTexture.value = texture;
    } else {
      this.uniforms.uUseTexture.value = false;
      this.uniforms.uBrushTexture.value = null;
    }
    
    if (stencilTexture && stencilMatrix && vpMatrix) {
      this.uniforms.uUseStencil.value = true;
      this.uniforms.uStencilTexture.value = stencilTexture;
      this.uniforms.uStencilMatrix.value.copy(stencilMatrix);
      this.uniforms.uVPMatrix.value.copy(vpMatrix);
      this.uniforms.uStencilMode.value = stencilMode;
    } else {
      this.uniforms.uUseStencil.value = false;
      this.uniforms.uStencilTexture.value = null;
    }

    // Handle Eraser Blending
    if (color === 'erase') {
        this.uniforms.uIsEraser.value = true;
        this.blending = THREE.CustomBlending;
        this.blendEquation = THREE.AddEquation;
        this.blendSrc = THREE.ZeroFactor;
        this.blendDst = THREE.OneMinusSrcAlphaFactor;
        this.blendSrcAlpha = THREE.ZeroFactor;
        this.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    } else {
        this.uniforms.uIsEraser.value = false;
        this.blending = THREE.NormalBlending;
    }
  }
}
