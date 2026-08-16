/**
 * neutron.js — The Neutron Core: a shader-driven energy sphere.
 *
 * Replaces the previous particle-swarm dual-core system with a single
 * persistent energy ball at the world origin. Visual structure is a custom
 * ShaderMaterial on an icosphere, with a decorative particle layer for
 * ambient sparks.
 */
import * as THREE from 'three';

// ── Palette ──────────────────────────────────────────────────────────
const NEUTRON_GREEN = new THREE.Color(0.4, 1.0, 0.5);

// ── Scale tuning ─────────────────────────────────────────────────────
const MIN_SCALE         = 0.3;
const NORMAL_SCALE      = 1.0;
const MAX_SCALE         = 1.8;

// Two-hand distance thresholds (normalized webcam coords, ~0–2 range)
const MIN_HAND_DIST     = 0.08;   // hands nearly touching
const MAX_HAND_DIST     = 0.80;   // hands far apart

// Interpolation speeds
const SCALE_LERP_SPEED    = 6.0;
const ROTATION_LERP_SPEED = 5.0;

// ── Decorative particle config ───────────────────────────────────────
const SPARK_COUNT = 600;

// ── Simplex-style 3D noise (GLSL) ────────────────────────────────────
// Compact permutation-based noise for the vertex/fragment shaders.
const GLSL_NOISE = /* glsl */ `
//  Classic Perlin 3D noise — adapted from Stefan Gustavson's GLSL implementation.
vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec3 fade(vec3 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

float cnoise(vec3 P) {
  vec3 Pi0 = floor(P);
  vec3 Pi1 = Pi0 + vec3(1.0);
  Pi0 = mod(Pi0, 289.0);
  Pi1 = mod(Pi1, 289.0);
  vec3 Pf0 = fract(P);
  vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz;
  vec4 iz1 = Pi1.zzzz;
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

// ── Vertex Shader ────────────────────────────────────────────────────
const vertexShader = /* glsl */ `
${GLSL_NOISE}

uniform float uTime;
uniform float uScale;
uniform float uTurbulence;

varying vec3 vNormal;
varying vec3 vPosition;
varying float vDisplacement;

void main() {
    // Layered noise displacement along normal
    vec3 noisePos = position * 2.0 + uTime * 0.4;
    float n1 = cnoise(noisePos) * 0.5;
    float n2 = cnoise(noisePos * 2.5 + 100.0) * 0.25;
    float n3 = cnoise(noisePos * 5.0 + 200.0) * 0.125;
    float displacement = (n1 + n2 + n3) * uTurbulence;

    vDisplacement = displacement;

    vec3 newPos = position + normal * displacement;

    // Apply core scale
    newPos *= uScale;

    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(newPos, 1.0)).xyz;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
}
`;

// ── Fragment Shader ──────────────────────────────────────────────────
const fragmentShader = /* glsl */ `
${GLSL_NOISE}

uniform float uTime;
uniform float uPulseIntensity;
uniform vec3  uColor;
uniform float uTurbulence;

varying vec3 vNormal;
varying vec3 vPosition;
varying float vDisplacement;

void main() {
    vec3 viewDir = normalize(-vPosition);

    // Fresnel rim glow
    float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 2.5);

    // Noise-driven energy bands
    float colorNoise1 = cnoise(vNormal * 4.0 + uTime * 0.5) * 0.5;
    float colorNoise2 = cnoise(vNormal * 8.0 - uTime * 0.8) * 0.25;
    float combinedNoise = colorNoise1 + colorNoise2;

    // Base energy color with noise variation
    vec3 baseColor = uColor * (0.4 + combinedNoise * 0.35);

    // Dark energy veins where noise dips low
    vec3 veinColor = uColor * vec3(0.06, 0.18, 0.1);
    float veinMask = smoothstep(-0.1, 0.3, -combinedNoise);
    baseColor = mix(baseColor, veinColor, veinMask * 0.7);

    // Pulsing
    float pulse = 1.0 + sin(uTime * 2.5) * uPulseIntensity * 0.12
                      + sin(uTime * 5.7) * uPulseIntensity * 0.05;

    // Displacement-driven brightness variation
    float coreBrightness = 0.8 + clamp(vDisplacement * 2.5, -0.3, 0.5);

    vec3 color = baseColor * coreBrightness * pulse;

    // Pronounced fresnel rim glow — key to the energy orb look
    color += uColor * fresnel * 0.45;

    // Subtle inner brightening, green-tinted
    float innerGlow = pow(max(dot(viewDir, vNormal), 0.0), 6.0);
    color += uColor * innerGlow * 0.08;

    gl_FragColor = vec4(color, 1.0);
}
`;

// ── Spark Vertex Shader ──────────────────────────────────────────────
const sparkVertexShader = /* glsl */ `
attribute float aSize;
attribute float aAlpha;

varying float vAlpha;

void main() {
    vAlpha = aAlpha;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (80.0 / -mvPos.z);
    gl_Position = projectionMatrix * mvPos;
}
`;

// ── Spark Fragment Shader ────────────────────────────────────────────
const sparkFragmentShader = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;

void main() {
    // Soft circular particle
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float alpha = vAlpha * smoothstep(0.5, 0.2, d);
    gl_FragColor = vec4(uColor, alpha);
}
`;


// ═════════════════════════════════════════════════════════════════════
// NeutronCore class
// ═════════════════════════════════════════════════════════════════════
export class NeutronCore {
    constructor(scene) {
        this.scene = scene;

        // ── Single core state (always at origin) ─────────────────────
        this.scale           = NORMAL_SCALE;
        this.targetScale     = NORMAL_SCALE;
        this.rotation        = 0;       // current interpolated angular velocity
        this.targetRotation  = 0;
        this.cumulativeRot   = 0;       // accumulated angle for mesh.rotation.y

        // ── Energy sphere ────────────────────────────────────────────
        this._initEnergySphere();

        // ── Point light for local glow ───────────────────────────────
        this.glowLight = new THREE.PointLight(NEUTRON_GREEN, 1.5, 8);
        this.glowLight.position.set(0, 0, 0);
        scene.add(this.glowLight);

        // ── Decorative spark particles ───────────────────────────────
        this._initSparks();
    }

    // ─── Energy Sphere Setup ─────────────────────────────────────────
    _initEnergySphere() {
        const geo = new THREE.IcosahedronGeometry(1, 64);

        this.uniforms = {
            uTime:           { value: 0 },
            uScale:          { value: NORMAL_SCALE },
            uTurbulence:     { value: 0.12 },
            uPulseIntensity: { value: 1.0 },
            uColor:          { value: new THREE.Vector3(NEUTRON_GREEN.r, NEUTRON_GREEN.g, NEUTRON_GREEN.b) },
        };

        const mat = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: this.uniforms,
            transparent: false,
            depthWrite: true,
            side: THREE.FrontSide,
        });

        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.position.set(0, 0, 0);   // Fixed at origin — never moves
        this.scene.add(this.mesh);
    }

    // ─── Decorative Spark Particles ──────────────────────────────────
    _initSparks() {
        const positions = new Float32Array(SPARK_COUNT * 3);
        const sizes     = new Float32Array(SPARK_COUNT);
        const alphas    = new Float32Array(SPARK_COUNT);

        // Per-spark persistent data for animation
        this.sparkData = [];

        for (let i = 0; i < SPARK_COUNT; i++) {
            // Random spherical distribution outside the core surface
            const theta = Math.random() * Math.PI * 2;
            const phi   = Math.acos(2 * Math.random() - 1);
            const r     = 1.15 + Math.random() * 1.0;   // further outside sphere

            positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = r * Math.cos(phi);

            sizes[i]  = 0.4 + Math.random() * 0.8;   // small wisps
            alphas[i] = 0.08 + Math.random() * 0.2;   // subtle but visible

            this.sparkData.push({
                baseR:    r,
                theta:    theta,
                phi:      phi,
                speed:    0.2 + Math.random() * 0.6,      // orbital speed
                drift:    (Math.random() - 0.5) * 0.3,    // radial drift
                phase:    Math.random() * Math.PI * 2,
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
                uColor: { value: new THREE.Vector3(NEUTRON_GREEN.r, NEUTRON_GREEN.g, NEUTRON_GREEN.b) },
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.sparks = new THREE.Points(geo, mat);
        this.sparks.position.set(0, 0, 0);   // Also fixed at origin
        this.scene.add(this.sparks);
    }

    // ─── Per-Frame Update ────────────────────────────────────────────
    update(gesture, deltaTime) {
        if (deltaTime > 0.1) deltaTime = 0.1; // Cap to prevent physics jumps

        const h0 = gesture.hands[0];
        const h1 = gesture.hands[1];
        const validHands = gesture.validHands;

        // ── SCALE ────────────────────────────────────────────────────
        if (validHands === 0) {
            // No hands → decay to resting scale
            this.targetScale = NORMAL_SCALE;
        } else if (validHands === 2) {
            // Two hands: distance between them drives scale
            const dist = gesture.distance;
            // Smoothstep mapping: [MIN_HAND_DIST, MAX_HAND_DIST] → [MIN_SCALE, MAX_SCALE]
            const t = THREE.MathUtils.clamp(
                (dist - MIN_HAND_DIST) / (MAX_HAND_DIST - MIN_HAND_DIST),
                0, 1
            );
            // Smoothstep for a more natural feel
            const smooth = t * t * (3 - 2 * t);
            this.targetScale = THREE.MathUtils.lerp(MIN_SCALE, MAX_SCALE, smooth);
        } else {
            // One hand: openness drives scale (existing behavior preserved)
            const mainHand = h0.active ? h0 : h1;
            this.targetScale = THREE.MathUtils.lerp(MIN_SCALE, NORMAL_SCALE, mainHand.openness);
        }

        // Smooth interpolation — never snaps
        this.scale = THREE.MathUtils.lerp(this.scale, this.targetScale, deltaTime * SCALE_LERP_SPEED);

        // ── ROTATION ─────────────────────────────────────────────────
        if (validHands === 0) {
            this.targetRotation = 0;
        } else if (validHands === 2) {
            // Use whichever hand has larger angular signal
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

        // ── APPLY TO MESH ────────────────────────────────────────────
        // Position: always (0,0,0) — never set, never changed.
        this.mesh.rotation.y = this.cumulativeRot;

        // Shader uniforms
        this.uniforms.uTime.value += deltaTime;
        this.uniforms.uScale.value = this.scale;

        // More turbulence when compressed, calmer when expanded
        const turbulenceBase = 0.12;
        const compressionFactor = THREE.MathUtils.clamp(1.0 - (this.scale - MIN_SCALE) / (NORMAL_SCALE - MIN_SCALE), 0, 1);
        this.uniforms.uTurbulence.value = turbulenceBase + compressionFactor * 0.10;

        // Pulse intensity ramps up slightly when active
        this.uniforms.uPulseIntensity.value = validHands > 0 ? 1.2 : 0.8;

        // Glow light intensity tracks scale
        this.glowLight.intensity = 1.0 + this.scale * 1.0;

        // ── UPDATE SPARKS ────────────────────────────────────────────
        this._updateSparks(deltaTime);
    }

    _updateSparks(deltaTime) {
        const positions = this.sparks.geometry.attributes.position.array;
        const alphas    = this.sparks.geometry.attributes.aAlpha.array;
        const time      = this.uniforms.uTime.value;

        for (let i = 0; i < SPARK_COUNT; i++) {
            const sd = this.sparkData[i];

            // Orbit around the sphere
            sd.theta += sd.speed * deltaTime;

            // Radial breathing
            const r = (sd.baseR + Math.sin(time * 1.5 + sd.phase) * 0.15 + sd.drift * Math.sin(time * 0.7 + sd.phase)) * this.scale;

            const sinPhi = Math.sin(sd.phi);
            const cosPhi = Math.cos(sd.phi);

            positions[i * 3]     = r * sinPhi * Math.cos(sd.theta);
            positions[i * 3 + 1] = r * sinPhi * Math.sin(sd.theta);
            positions[i * 3 + 2] = r * cosPhi;

            // Twinkle alpha
            alphas[i] = sd.baseAlpha * (0.5 + 0.5 * Math.sin(time * 3.0 + sd.phase));
        }

        this.sparks.geometry.attributes.position.needsUpdate = true;
        this.sparks.geometry.attributes.aAlpha.needsUpdate = true;
    }
}
