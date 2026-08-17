/**
 * neutron.js — The Neutron Core: shader-driven energy sphere with runic rings.
 *
 * Visual elements:
 *  1. Bright plasma core sphere (IcosahedronGeometry + ShaderMaterial)
 *  2. Three rotating runic rings (TorusGeometry + ShaderMaterial)
 *  3. Energy nebula shell (IcosahedronGeometry + transparent ShaderMaterial)
 *  4. Decorative spark particles (Points + ShaderMaterial)
 *
 * Position is always fixed at (0,0,0). Scale and rotation driven by gestures.
 */
import * as THREE from 'three';

// ── Palette ──────────────────────────────────────────────────────────
const NEUTRON_GREEN = new THREE.Color(0.2, 1.0, 0.3);
const CORE_COLOR_VEC = new THREE.Vector3(0.2, 1.0, 0.3);

// ── Scale tuning ─────────────────────────────────────────────────────
const MIN_SCALE         = 0.25;
const NORMAL_SCALE      = 1.0;
const MAX_SCALE         = 2.5;
const MAX_ONE_HAND_SCALE = 1.3;   // one hand can expand slightly beyond normal

// Two-hand distance thresholds (normalized webcam coords, ~0–2 range)
const MIN_HAND_DIST     = 0.05;
const MAX_HAND_DIST     = 1.0;

// Interpolation speeds
const SCALE_LERP_SPEED    = 10.0;
const ROTATION_LERP_SPEED = 6.0;

// Particle counts
const SPARK_COUNT  = 500;

// ── Classic Perlin 3D noise (GLSL) ───────────────────────────────────
const GLSL_NOISE = /* glsl */ `
vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec3 fade(vec3 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

float cnoise(vec3 P) {
  vec3 Pi0 = floor(P); vec3 Pi1 = Pi0 + vec3(1.0);
  Pi0 = mod(Pi0, 289.0); Pi1 = mod(Pi1, 289.0);
  vec3 Pf0 = fract(P); vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz; vec4 iz1 = Pi1.zzzz;
  vec4 ixy  = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);
  vec4 gx0 = ixy0 / 7.0;
  vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5);
  gy0 -= sz0 * (step(0.0, gy0) - 0.5);
  vec4 gx1 = ixy1 / 7.0;
  vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5);
  gy1 -= sz1 * (step(0.0, gy1) - 0.5);
  vec3 g000 = vec3(gx0.x, gy0.x, gz0.x);
  vec3 g100 = vec3(gx0.y, gy0.y, gz0.y);
  vec3 g010 = vec3(gx0.z, gy0.z, gz0.z);
  vec3 g110 = vec3(gx0.w, gy0.w, gz0.w);
  vec3 g001 = vec3(gx1.x, gy1.x, gz1.x);
  vec3 g101 = vec3(gx1.y, gy1.y, gz1.y);
  vec3 g011 = vec3(gx1.z, gy1.z, gz1.z);
  vec3 g111 = vec3(gx1.w, gy1.w, gz1.w);
  vec4 norm0 = taylorInvSqrt(vec4(dot(g000,g000), dot(g010,g010), dot(g100,g100), dot(g110,g110)));
  g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001,g001), dot(g011,g011), dot(g101,g101), dot(g111,g111)));
  g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
  float n000 = dot(g000, Pf0);
  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
  float n111 = dot(g111, Pf1);
  vec3 fade_xyz = fade(Pf0);
  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
  return 2.2 * n_xyz;
}
`;

// ═══════════════════════════════════════════════════════════════════════
//  CORE SPHERE SHADERS — bright plasma with high contrast
// ═══════════════════════════════════════════════════════════════════════

const coreVertexShader = /* glsl */ `
${GLSL_NOISE}

uniform float uTime;
uniform float uTurbulence;

varying vec3 vNormal;
varying vec3 vPosition;
varying float vDisplacement;
varying vec3 vObjPos;

void main() {
    vec3 noisePos = position * 2.0 + uTime * 0.4;
    float n1 = cnoise(noisePos) * 0.5;
    float n2 = cnoise(noisePos * 2.5 + 100.0) * 0.25;
    float n3 = cnoise(noisePos * 5.0 + 200.0) * 0.125;
    float displacement = (n1 + n2 + n3) * uTurbulence;

    vDisplacement = displacement;
    vObjPos = position;

    vec3 newPos = position + normal * displacement;

    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(newPos, 1.0)).xyz;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
}
`;

const coreFragmentShader = /* glsl */ `
${GLSL_NOISE}

uniform float uTime;
uniform float uPulseIntensity;
uniform vec3  uColor;

varying vec3 vNormal;
varying vec3 vPosition;
varying float vDisplacement;
varying vec3 vObjPos;

void main() {
    vec3 viewDir = normalize(-vPosition);

    // Fresnel rim
    float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 2.0);

    // Large-scale cloud pattern
    float cloud = cnoise(vObjPos * 1.5 + uTime * 0.25) * 0.5 + 0.5;

    // Fine detail noise
    float detail1 = cnoise(vObjPos * 4.0 + uTime * 0.45);
    float detail2 = cnoise(vObjPos * 8.0 - uTime * 0.6);
    float detail = detail1 * 0.4 + detail2 * 0.2;

    // Combined energy level for high-contrast surface
    float energyLevel = cloud + detail;

    // Dark vein mask (where energy dips very low)
    float darkMask = smoothstep(0.35, 0.05, energyLevel);
    // Bright plasma mask (where energy peaks)
    float brightMask = smoothstep(0.55, 1.0, energyLevel);
    // White-hot highlight mask (very peak areas)
    float hotMask = smoothstep(0.85, 1.1, energyLevel);

    // Color palette
    vec3 darkColor   = vec3(0.0, 0.02, 0.0);
    vec3 midColor    = uColor * 0.2;
    vec3 brightColor = vec3(0.3, 0.7, 0.35);
    vec3 hotColor    = vec3(0.6, 1.0, 0.7);

    // Build surface color with high contrast
    vec3 surfaceColor = midColor;
    surfaceColor = mix(surfaceColor, brightColor, brightMask);
    surfaceColor = mix(surfaceColor, darkColor, darkMask);
    surfaceColor = mix(surfaceColor, hotColor, hotMask * 0.6);

    // Displacement modulates brightness
    surfaceColor *= (1.0 + vDisplacement * 2.5);

    // Pulsing
    float pulse = 1.0 + sin(uTime * 2.5) * uPulseIntensity * 0.1
                      + sin(uTime * 5.7) * uPulseIntensity * 0.04;
    surfaceColor *= pulse;

    // Fresnel rim glow — bright green edge
    surfaceColor += uColor * fresnel * 0.35;

    // Subtle inner brightening
    float inner = pow(max(dot(viewDir, vNormal), 0.0), 4.0);
    surfaceColor += uColor * inner * 0.06;

    gl_FragColor = vec4(surfaceColor, 1.0);
}
`;

// ═══════════════════════════════════════════════════════════════════════
//  RUNIC RING SHADERS
// ═══════════════════════════════════════════════════════════════════════

const ringVertexShader = /* glsl */ `
${GLSL_NOISE}

uniform float uTime;

varying vec2 vUv;

void main() {
    vUv = uv;

    // Wavy displacement — push each point along its normal with noise
    // Use position along circumference (uv.x) and time for animation
    vec3 noiseCoord = position * 1.8 + uTime * vec3(0.3, 0.2, 0.25);
    float wave1 = cnoise(noiseCoord) * 0.06;
    float wave2 = cnoise(noiseCoord * 2.5 + 50.0) * 0.03;
    float wave3 = sin(uv.x * 6.2832 * 8.0 + uTime * 1.5) * 0.015;

    // Compute a rough normal for the torus (radial outward from tube center)
    vec3 tubeNormal = normalize(position);
    vec3 displaced = position + tubeNormal * (wave1 + wave2 + wave3);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

const ringFragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3  uColor;
uniform float uBrightness;

varying vec2 vUv;

void main() {
    float u = vUv.x; // position around circumference 0-1

    // Animated rune pattern — multiple sine frequencies for glyph-like complexity
    float r1 = sin(u * 40.0 * 6.2832 + uTime * 0.5) * 0.3;
    float r2 = sin(u * 24.0 * 6.2832 - uTime * 0.3) * 0.25;
    float r3 = sin(u * 56.0 * 6.2832 + uTime * 0.7) * 0.15;
    float r4 = sin(u * 12.0 * 6.2832 + uTime * 0.15) * 0.2;
    float runePattern = clamp(0.5 + r1 + r2 + r3 + r4, 0.0, 1.0);

    // Segmented gaps between rune groups
    float seg = fract(u * 16.0 + uTime * 0.04);
    float segMask = smoothstep(0.02, 0.08, seg) * smoothstep(0.98, 0.92, seg);

    // Cardinal diamond accents at 0°, 90°, 180°, 270°
    float d0 = min(abs(u), 1.0 - u);
    float d1 = abs(u - 0.25);
    float d2 = abs(u - 0.5);
    float d3 = abs(u - 0.75);
    float minD = min(min(d0, d1), min(d2, d3));
    float cardinal = smoothstep(0.018, 0.0, minD);

    // Tube cross-section glow (brightest at tube center)
    float v = vUv.y;
    float tubeGlow = smoothstep(1.0, 0.2, abs(v - 0.5) * 2.0);

    float brightness = (runePattern * segMask * 0.25 + 0.04 + cardinal * 0.6) * tubeGlow * uBrightness;

    vec3 color = uColor * brightness;
    gl_FragColor = vec4(color, 1.0);
}
`;

// ═══════════════════════════════════════════════════════════════════════
//  NEBULA SHELL SHADERS — wispy energy tendrils
// ═══════════════════════════════════════════════════════════════════════

const nebulaVertexShader = /* glsl */ `
${GLSL_NOISE}

uniform float uTime;

varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vWorldPos;

void main() {
    // Displacement for organic flowing shape
    vec3 noiseCoord = position * 0.8 + uTime * vec3(0.1, 0.12, 0.08);
    float displacement = cnoise(noiseCoord) * 0.5 + cnoise(noiseCoord * 2.0) * 0.25;

    vec3 newPos = position + normal * displacement;

    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(newPos, 1.0)).xyz;
    vWorldPos = position;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
}
`;

const nebulaFragmentShader = /* glsl */ `
${GLSL_NOISE}

uniform float uTime;
uniform vec3  uColor;

varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vWorldPos;

void main() {
    vec3 viewDir = normalize(-vPosition);
    float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 1.5);

    // Multi-layer noise for wisp pattern
    float n1 = cnoise(vWorldPos * 1.2 + uTime * vec3(0.12, 0.15, 0.08));
    float n2 = cnoise(vWorldPos * 2.5 + uTime * vec3(-0.08, 0.1, 0.12));
    float n3 = cnoise(vWorldPos * 0.6 + uTime * vec3(0.05, -0.07, 0.1));
    float wispPattern = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;

    // Show wisps where noise is above a threshold
    float wispMask = smoothstep(0.0, 0.4, wispPattern);

    // Alpha: visible where wisps exist AND at silhouette edges
    float alpha = wispMask * fresnel * 0.12;

    vec3 color = uColor * (0.3 + wispPattern * 0.4);

    gl_FragColor = vec4(color, alpha);
}
`;

// ═══════════════════════════════════════════════════════════════════════
//  SPARK PARTICLE SHADERS
// ═══════════════════════════════════════════════════════════════════════

const sparkVertexShader = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
void main() {
    vAlpha = aAlpha;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (100.0 / -mvPos.z);
    gl_Position = projectionMatrix * mvPos;
}
`;

const sparkFragmentShader = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float alpha = vAlpha * smoothstep(0.5, 0.15, d);
    gl_FragColor = vec4(uColor, alpha);
}
`;


// ═══════════════════════════════════════════════════════════════════════
//  NeutronCore class
// ═══════════════════════════════════════════════════════════════════════
export class NeutronCore {
    constructor(scene) {
        this.scene = scene;

        // ── Master group for uniform scaling ──────────────────────────
        this.group = new THREE.Group();
        this.group.position.set(0, 0, 0); // Fixed at origin — never moves
        scene.add(this.group);

        // ── State ────────────────────────────────────────────────────
        this.scale          = NORMAL_SCALE;
        this.targetScale    = NORMAL_SCALE;
        this.rotation       = 0;
        this.targetRotation = 0;
        this.cumulativeRot  = 0;
        this.time           = 0;
        this._noHandTimer   = 0;

        // ── Create visual elements ───────────────────────────────────
        this._initEnergySphere();
        this._initRunicRings();
        this._initEnergyNebula();
        this._initSparks();

        // ── Point light for local glow ───────────────────────────────
        this.glowLight = new THREE.PointLight(NEUTRON_GREEN, 2.0, 10);
        this.glowLight.position.set(0, 0, 0);
        scene.add(this.glowLight);
    }

    // ─── Energy Sphere (Core) ────────────────────────────────────────
    _initEnergySphere() {
        const geo = new THREE.IcosahedronGeometry(1, 64);

        this.coreUniforms = {
            uTime:           { value: 0 },
            uTurbulence:     { value: 0.15 },
            uPulseIntensity: { value: 1.0 },
            uColor:          { value: CORE_COLOR_VEC.clone() },
        };

        const mat = new THREE.ShaderMaterial({
            vertexShader: coreVertexShader,
            fragmentShader: coreFragmentShader,
            uniforms: this.coreUniforms,
            transparent: false,
            depthWrite: true,
            side: THREE.FrontSide,
        });

        this.mesh = new THREE.Mesh(geo, mat);
        this.group.add(this.mesh);
    }

    // ─── Runic Rings ─────────────────────────────────────────────────
    _initRunicRings() {
        this.rings = [];

        // multiplier: each ring tracks hand rotation at a different rate
        // so they fan out during rotation rather than moving in lockstep
        const ringConfigs = [
            { radius: 1.35, tube: 0.025, tiltX: 0.12, tiltY: 0.0,   multiplier:  1.0,  brightness: 1.0 },
            { radius: 1.60, tube: 0.020, tiltX: -0.08, tiltY: 0.12, multiplier: -0.7, brightness: 0.8 },
            { radius: 1.90, tube: 0.018, tiltX: 0.05, tiltY: -0.1,  multiplier:  0.45, brightness: 0.6 },
        ];

        for (const cfg of ringConfigs) {
            const geo = new THREE.TorusGeometry(cfg.radius, cfg.tube, 12, 256);

            const uniforms = {
                uTime:       { value: 0 },
                uColor:      { value: CORE_COLOR_VEC.clone() },
                uBrightness: { value: cfg.brightness },
            };

            const mat = new THREE.ShaderMaterial({
                vertexShader: ringVertexShader,
                fragmentShader: ringFragmentShader,
                uniforms,
                transparent: false,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const ringMesh = new THREE.Mesh(geo, mat);

            // Apply tilt
            ringMesh.rotation.x = cfg.tiltX;
            ringMesh.rotation.y = cfg.tiltY;

            this.group.add(ringMesh);

            this.rings.push({
                mesh: ringMesh,
                uniforms,
                multiplier: cfg.multiplier,
                baseTiltX: cfg.tiltX,
                baseTiltY: cfg.tiltY,
            });
        }
    }

    // ─── Energy Nebula Shell ─────────────────────────────────────────
    _initEnergyNebula() {
        const geo = new THREE.IcosahedronGeometry(2.8, 5);

        this.nebulaUniforms = {
            uTime:  { value: 0 },
            uColor: { value: CORE_COLOR_VEC.clone() },
        };

        const mat = new THREE.ShaderMaterial({
            vertexShader: nebulaVertexShader,
            fragmentShader: nebulaFragmentShader,
            uniforms: this.nebulaUniforms,
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.nebula = new THREE.Mesh(geo, mat);
        this.group.add(this.nebula);
    }

    // ─── Decorative Spark Particles ──────────────────────────────────
    _initSparks() {
        const positions = new Float32Array(SPARK_COUNT * 3);
        const sizes     = new Float32Array(SPARK_COUNT);
        const alphas    = new Float32Array(SPARK_COUNT);

        this.sparkData = [];

        for (let i = 0; i < SPARK_COUNT; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi   = Math.acos(2 * Math.random() - 1);
            const r     = 1.2 + Math.random() * 2.5; // spread from near-surface to outer

            positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = r * Math.cos(phi);

            sizes[i]  = 0.3 + Math.random() * 0.8;
            alphas[i] = 0.05 + Math.random() * 0.2;

            this.sparkData.push({
                baseR:     r,
                theta:     theta,
                phi:       phi,
                speed:     0.15 + Math.random() * 0.5,
                drift:     (Math.random() - 0.5) * 0.2,
                phase:     Math.random() * Math.PI * 2,
                baseAlpha: alphas[i],
            });
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));
        geo.setAttribute('aAlpha',   new THREE.BufferAttribute(alphas, 1));

        const mat = new THREE.ShaderMaterial({
            vertexShader:   sparkVertexShader,
            fragmentShader: sparkFragmentShader,
            uniforms: {
                uColor: { value: CORE_COLOR_VEC.clone() },
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.sparks = new THREE.Points(geo, mat);
        this.group.add(this.sparks);
    }

    // ─── Per-Frame Update ────────────────────────────────────────────
    update(gesture, deltaTime) {
        if (deltaTime > 0.1) deltaTime = 0.1;

        const h0 = gesture.hands[0];
        const h1 = gesture.hands[1];
        const validHands = gesture.validHands;

        this.time += deltaTime;

        // ── SCALE ────────────────────────────────────────────────────
        if (validHands === 0) {
            // Delay before resetting to prevent tracking-drop snaps
            this._noHandTimer += deltaTime;
            if (this._noHandTimer > 0.3) {
                this.targetScale = NORMAL_SCALE;
            }
        } else {
            this._noHandTimer = 0;

            if (validHands === 2) {
                // Two hands: distance drives scale
                const dist = gesture.distance;
                const t = THREE.MathUtils.clamp(
                    (dist - MIN_HAND_DIST) / (MAX_HAND_DIST - MIN_HAND_DIST), 0, 1
                );
                const smooth = t * t * (3 - 2 * t);
                this.targetScale = THREE.MathUtils.lerp(MIN_SCALE, MAX_SCALE, smooth);
            } else {
                // One hand: openness drives scale
                const mainHand = h0.active ? h0 : h1;
                this.targetScale = THREE.MathUtils.lerp(MIN_SCALE, MAX_ONE_HAND_SCALE, mainHand.openness);
            }
        }

        this.scale = THREE.MathUtils.lerp(this.scale, this.targetScale, deltaTime * SCALE_LERP_SPEED);

        // ── ROTATION ─────────────────────────────────────────────────
        if (validHands === 0) {
            if (this._noHandTimer > 0.3) {
                this.targetRotation = 0;
            }
        } else if (validHands === 2) {
            if (Math.abs(h0.angularVelocity) > Math.abs(h1.angularVelocity)) {
                this.targetRotation = h0.angularVelocity;
            } else {
                this.targetRotation = h1.angularVelocity;
            }
        } else {
            const mainHand = h0.active ? h0 : h1;
            this.targetRotation = mainHand.angularVelocity;
        }

        this.rotation = THREE.MathUtils.lerp(this.rotation, this.targetRotation, deltaTime * ROTATION_LERP_SPEED);
        this.cumulativeRot += this.rotation * deltaTime;

        // ── APPLY TO VISUALS ─────────────────────────────────────────

        // Scale the entire group
        this.group.scale.setScalar(this.scale);

        // Core sphere rotation (from hand gesture)
        this.mesh.rotation.y = this.cumulativeRot;

        // Core shader uniforms
        this.coreUniforms.uTime.value = this.time;
        const turbulenceBase = 0.15;
        const compressionFactor = THREE.MathUtils.clamp(1.0 - (this.scale - MIN_SCALE) / (NORMAL_SCALE - MIN_SCALE), 0, 1);
        this.coreUniforms.uTurbulence.value = turbulenceBase + compressionFactor * 0.12;
        this.coreUniforms.uPulseIntensity.value = validHands > 0 ? 1.2 : 0.8;

        // ── Ring rotation (hand-driven) ──────────────────────────────
        for (const ring of this.rings) {
            ring.mesh.rotation.x = ring.baseTiltX;
            ring.mesh.rotation.y = ring.baseTiltY;
            // Rings follow hand rotation at their own multiplier rate
            ring.mesh.rotation.z = this.cumulativeRot * ring.multiplier;
            ring.uniforms.uTime.value = this.time;
        }

        // ── Nebula ───────────────────────────────────────────────────
        this.nebulaUniforms.uTime.value = this.time;
        this.nebula.rotation.y = this.time * 0.03; // very slow drift

        // ── Glow light ───────────────────────────────────────────────
        this.glowLight.intensity = 1.5 + this.scale * 1.0;

        // ── Sparks ───────────────────────────────────────────────────
        this._updateSparks(deltaTime);
    }

    _updateSparks(deltaTime) {
        const positions = this.sparks.geometry.attributes.position.array;
        const alphas    = this.sparks.geometry.attributes.aAlpha.array;
        const time      = this.time;

        for (let i = 0; i < SPARK_COUNT; i++) {
            const sd = this.sparkData[i];

            sd.theta += sd.speed * deltaTime;

            // Radial breathing (no manual scale — group handles it)
            const r = sd.baseR + Math.sin(time * 1.5 + sd.phase) * 0.15
                               + sd.drift * Math.sin(time * 0.7 + sd.phase);

            const sinPhi = Math.sin(sd.phi);
            const cosPhi = Math.cos(sd.phi);

            positions[i * 3]     = r * sinPhi * Math.cos(sd.theta);
            positions[i * 3 + 1] = r * sinPhi * Math.sin(sd.theta);
            positions[i * 3 + 2] = r * cosPhi;

            // Twinkle
            alphas[i] = sd.baseAlpha * (0.4 + 0.6 * Math.sin(time * 3.0 + sd.phase));
        }

        this.sparks.geometry.attributes.position.needsUpdate = true;
        this.sparks.geometry.attributes.aAlpha.needsUpdate = true;
    }
}
