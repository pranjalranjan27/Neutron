/**
 * neutron.js — The Neutron Core: dark tangled mass with glowing crack fissures.
 *
 * Visual elements:
 *  1. Gnarled dark mass (high-subdivision IcosahedronGeometry + fractal-noise
 *     displacement ShaderMaterial) — dark matte body with animated green
 *     emissive crack/fissure pattern
 *  2. Electric arc accents — small pool of reusable jagged line bursts
 *
 * Position is always fixed at (0,0,0). Scale and rotation driven by gestures.
 * ALL gesture interaction logic is preserved exactly from the previous version.
 */
import * as THREE from 'three';

// ── Palette ──────────────────────────────────────────────────────────
const NEUTRON_GREEN = new THREE.Color(0.15, 1.0, 0.25);
const CORE_COLOR_VEC = new THREE.Vector3(0.15, 1.0, 0.25);

// ── Scale tuning (UNCHANGED) ─────────────────────────────────────────
const MIN_SCALE         = 0.25;
const NORMAL_SCALE      = 1.0;
const MAX_SCALE         = 2.5;
const MAX_ONE_HAND_SCALE = 1.3;

// Two-hand distance thresholds (UNCHANGED)
const MIN_HAND_DIST     = 0.05;
const MAX_HAND_DIST     = 1.0;

// Interpolation speeds (UNCHANGED)
const SCALE_LERP_SPEED    = 10.0;
const ROTATION_LERP_SPEED = 6.0;

// Arc system
const ARC_POOL_SIZE = 4;
const ARC_SEGMENTS  = 10;

// ── Breathing / instability tuning ───────────────────────────────────
// Layered micro-scale pulsing on top of gesture-driven scale
const BREATH_SLOW_FREQ   = 0.4;   // Hz — slow base breathing cycle
const BREATH_SLOW_AMP    = 0.025; // scale units — subtle
const BREATH_FAST_FREQ   = 1.8;   // Hz — faster layered cycle
const BREATH_FAST_AMP    = 0.010; // smaller amplitude
const BREATH_IRREG_FREQ  = 0.7;   // Hz — irregularity modulator
const BREATH_IRREG_AMP   = 0.008;

// Idle tumble tension jitter
const TUMBLE_JITTER_AMP  = 0.0015; // radians — subtle hesitation

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
//  CORE VERTEX SHADER — 5-octave fractal displacement for gnarled mass
// ═══════════════════════════════════════════════════════════════════════

const coreVertexShader = /* glsl */ `
${GLSL_NOISE}

uniform float uTime;

varying vec3 vNormal;
varying vec3 vPosition;
varying float vDisplacement;
varying vec3 vObjPos;

void main() {
    // ── Per-region instability modulator ──────────────────────────────
    // A slow, large-scale noise field that varies the AMPLITUDE of the
    // displacement per-region, creating roiling "hot spots" that drift
    // across the surface over time.
    float regionNoise = cnoise(position * 0.8 + uTime * vec3(0.03, -0.02, 0.04) + 600.0);
    // Map to a multiplier: 0.7 (calmer regions) to 1.4 (active/bulging regions)
    float regionAmplitude = 0.7 + (regionNoise * 0.5 + 0.5) * 0.7;

    // ── 5-octave fractal noise displacement ──────────────────────────
    // Each octave has a different time-offset direction for churning
    vec3 p = position;

    // Octave 1: large lumps — breaks spherical silhouette
    float n1 = cnoise(p * 1.5 + uTime * vec3(0.08, 0.06, 0.07)) * 0.45;

    // Octave 2: medium bumps — secondary irregularity
    float n2 = cnoise(p * 3.0 + uTime * vec3(-0.05, 0.09, -0.06) + 100.0) * 0.25;

    // Octave 3: smaller detail
    float n3 = cnoise(p * 6.0 + uTime * vec3(0.07, -0.04, 0.08) + 200.0) * 0.12;

    // Octave 4: fine roughness
    float n4 = cnoise(p * 12.0 + uTime * vec3(-0.03, 0.05, -0.04) + 300.0) * 0.06;

    // Octave 5: micro-detail
    float n5 = cnoise(p * 24.0 + uTime * vec3(0.04, -0.03, 0.05) + 400.0) * 0.03;

    // Apply per-region amplitude modulation — hot spots writhe more
    float displacement = (n1 + n2 + n3 + n4 + n5) * regionAmplitude;

    vDisplacement = displacement;
    vObjPos = position;

    vec3 newPos = position + normal * displacement;

    // Approximate displaced normal via neighbor sampling for better shading
    float eps = 0.01;
    vec3 tangent1 = normalize(cross(normal, vec3(0.0, 1.0, 0.0)));
    if (length(cross(normal, vec3(0.0, 1.0, 0.0))) < 0.01) {
        tangent1 = normalize(cross(normal, vec3(1.0, 0.0, 0.0)));
    }
    vec3 tangent2 = normalize(cross(normal, tangent1));

    vec3 pN1 = position + tangent1 * eps;
    vec3 pN2 = position + tangent2 * eps;

    // Neighbor region amplitudes for consistent normal approximation
    float raN1 = 0.7 + (cnoise(pN1 * 0.8 + uTime * vec3(0.03, -0.02, 0.04) + 600.0) * 0.5 + 0.5) * 0.7;
    float raN2 = 0.7 + (cnoise(pN2 * 0.8 + uTime * vec3(0.03, -0.02, 0.04) + 600.0) * 0.5 + 0.5) * 0.7;

    float dN1 = (cnoise(pN1 * 1.5 + uTime * vec3(0.08, 0.06, 0.07)) * 0.45
              + cnoise(pN1 * 3.0 + uTime * vec3(-0.05, 0.09, -0.06) + 100.0) * 0.25
              + cnoise(pN1 * 6.0 + uTime * vec3(0.07, -0.04, 0.08) + 200.0) * 0.12) * raN1;

    float dN2 = (cnoise(pN2 * 1.5 + uTime * vec3(0.08, 0.06, 0.07)) * 0.45
              + cnoise(pN2 * 3.0 + uTime * vec3(-0.05, 0.09, -0.06) + 100.0) * 0.25
              + cnoise(pN2 * 6.0 + uTime * vec3(0.07, -0.04, 0.08) + 200.0) * 0.12) * raN2;

    vec3 displaced1 = pN1 + normal * dN1;
    vec3 displaced2 = pN2 + normal * dN2;

    vec3 displacedNormal = normalize(cross(displaced1 - newPos, displaced2 - newPos));

    vNormal = normalize(normalMatrix * displacedNormal);
    vPosition = (modelViewMatrix * vec4(newPos, 1.0)).xyz;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
}
`;

// ═══════════════════════════════════════════════════════════════════════
//  CORE FRAGMENT SHADER — dark body + animated crack-glow fissures
// ═══════════════════════════════════════════════════════════════════════

const coreFragmentShader = /* glsl */ `
${GLSL_NOISE}

uniform float uTime;
uniform vec3  uColor;
uniform float uFlickerSeed; // CPU-driven random seed for flare timing

varying vec3 vNormal;
varying vec3 vPosition;
varying float vDisplacement;
varying vec3 vObjPos;

void main() {
    vec3 viewDir = normalize(-vPosition);
    vec3 N = normalize(vNormal);

    // ── Dark matte body ──────────────────────────────────────────────
    // Near-black with barely perceptible green tint
    vec3 darkBase = vec3(0.005, 0.012, 0.008);

    // Very subtle directional light — just enough for form readability
    vec3 lightDir = normalize(vec3(0.2, 0.5, 1.0));
    float diffuse = max(dot(N, lightDir), 0.0);
    float ambient = 0.08;
    vec3 bodyColor = darkBase * (ambient + diffuse * 0.18);

    // Slight darkening in deep crevices
    float creviceDarken = smoothstep(-0.3, 0.1, vDisplacement);
    bodyColor *= mix(0.4, 1.0, creviceDarken);

    // ── Crack/fissure pattern ────────────────────────────────────────
    // Use a DIFFERENT noise seed from displacement (offset +500) and
    // different frequency so cracks don't align with bumps

    // Primary crack noise — medium frequency for main fissure lines
    float crackNoise1 = cnoise(vObjPos * 3.5 + uTime * vec3(0.04, -0.03, 0.05) + 500.0);
    // Secondary crack noise — higher frequency for branching detail
    float crackNoise2 = cnoise(vObjPos * 7.0 + uTime * vec3(-0.03, 0.05, -0.02) + 700.0);
    // Tertiary — very fine veining
    float crackNoise3 = cnoise(vObjPos * 14.0 + uTime * vec3(0.02, -0.04, 0.03) + 900.0);

    // Combine: the absolute-value trick creates sharp valley lines
    // (like a Voronoi-edge approximation)
    float crackRaw = abs(crackNoise1) * 0.5 + abs(crackNoise2) * 0.3 + abs(crackNoise3) * 0.2;

    // Very tight threshold — only the thinnest noise valleys glow
    float crackMask = 1.0 - smoothstep(0.01, 0.06, crackRaw);

    // Slightly wider for faint sub-surface bleed
    float crackBleed = 1.0 - smoothstep(0.03, 0.14, crackRaw);

    // Deeper crevices have slightly higher crack probability
    float depthBoost = smoothstep(0.1, -0.25, vDisplacement) * 0.15;
    crackMask = clamp(crackMask + depthBoost, 0.0, 1.0);
    crackBleed = clamp(crackBleed + depthBoost * 0.3, 0.0, 1.0);

    // ── Crack instability — flicker + localized flare-ups ────────────
    // Base pulsing (existing)
    float pulse = 0.85 + 0.15 * sin(uTime * 1.5 + crackNoise1 * 4.0);

    // High-frequency flicker noise — makes glow feel strained/arcing
    float flicker = cnoise(vObjPos * 20.0 + uTime * vec3(8.0, -6.0, 7.0) + 1100.0);
    float flickerMod = 0.85 + flicker * 0.15;

    // Localized pressure flare-ups — sparse, bright, brief
    // Uses uFlickerSeed (random value updated on CPU) to pick
    // which region flares and when, so flares aren't every-frame
    float flareNoise = cnoise(vObjPos * 2.0 + uFlickerSeed * 7.0 + 1300.0);
    // Only the peak region (top ~15% of noise) gets a flare
    float flareMask = smoothstep(0.65, 0.85, flareNoise);
    // Flare intensity modulated by a fast time-based falloff
    float flareTime = fract(uFlickerSeed * 3.7);
    float flareIntensity = flareMask * smoothstep(0.3, 0.0, flareTime) * 1.8;

    // Combined crack intensity modulator
    float crackIntensity = pulse * flickerMod + flareIntensity;

    // ── Crack emission color ─────────────────────────────────────────
    // Bright saturated green for the crack cores
    vec3 crackColor = vec3(0.15, 1.0, 0.25) * crackIntensity;
    // Fainter green for the sub-surface bleed
    vec3 bleedColor = vec3(0.05, 0.3, 0.08) * pulse * flickerMod;

    // ── Composite ────────────────────────────────────────────────────
    vec3 finalColor = bodyColor;
    finalColor += bleedColor * crackBleed * 0.2;
    finalColor += crackColor * crackMask * 1.5;

    // NO fresnel rim glow — silhouette edges stay dark

    gl_FragColor = vec4(finalColor, 1.0);
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

        // ── State (UNCHANGED — gesture interaction preserved exactly) ─
        this.scale          = NORMAL_SCALE;
        this.targetScale    = NORMAL_SCALE;
        this.rotation       = 0;
        this.targetRotation = 0;
        this.cumulativeRot  = 0;
        this.time           = 0;
        this._noHandTimer   = 0;

        // ── Idle tumble state ────────────────────────────────────────
        this._idleTumbleX = 0;
        this._idleTumbleZ = 0;
        this._idleInfluence = 1.0; // fades to 0 when hand rotation active

        // ── Create visual elements ───────────────────────────────────
        this._initDarkMass();
        this._initArcs();

        // ── Point light (dim — dark mass doesn't glow much) ──────────
        this.glowLight = new THREE.PointLight(NEUTRON_GREEN, 0.3, 8);
        this.glowLight.position.set(0, 0, 0);
        scene.add(this.glowLight);
    }

    // ─── Dark Mass (Core Mesh) ───────────────────────────────────────
    _initDarkMass() {
        // High subdivision for fine displacement detail
        const geo = new THREE.IcosahedronGeometry(1.4, 64);

        this.coreUniforms = {
            uTime:       { value: 0 },
            uColor:      { value: CORE_COLOR_VEC.clone() },
            uFlickerSeed: { value: 0 },
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

    // ─── Electric Arc Accents ────────────────────────────────────────
    _initArcs() {
        this.arcs = [];

        for (let i = 0; i < ARC_POOL_SIZE; i++) {
            const positions = new Float32Array(ARC_SEGMENTS * 3);
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

            const mat = new THREE.LineBasicMaterial({
                color: new THREE.Color(0.2, 1.0, 0.35),
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                linewidth: 1,
            });

            const line = new THREE.Line(geo, mat);
            this.group.add(line);

            this.arcs.push({
                line,
                geo,
                mat,
                opacity: 0,
                life: 0,       // countdown timer
                active: false,
            });
        }

        // Timer for spawning arcs
        this._arcTimer = 2.0 + Math.random() * 3.0; // first arc after 2-5s
    }

    _spawnArc(arcObj) {
        // Pick random point on unit sphere surface
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 1.0; // base sphere radius

        const startX = r * Math.sin(phi) * Math.cos(theta);
        const startY = r * Math.sin(phi) * Math.sin(theta);
        const startZ = r * Math.cos(phi);

        // Random outward direction with jitter
        const outDir = new THREE.Vector3(startX, startY, startZ).normalize();

        // Generate jagged bolt path
        const positions = arcObj.geo.attributes.position.array;
        let px = startX, py = startY, pz = startZ;

        for (let i = 0; i < ARC_SEGMENTS; i++) {
            positions[i * 3]     = px;
            positions[i * 3 + 1] = py;
            positions[i * 3 + 2] = pz;

            // Step outward with random lateral jitter
            const step = 0.04 + Math.random() * 0.06;
            px += outDir.x * step + (Math.random() - 0.5) * 0.08;
            py += outDir.y * step + (Math.random() - 0.5) * 0.08;
            pz += outDir.z * step + (Math.random() - 0.5) * 0.08;
        }

        arcObj.geo.attributes.position.needsUpdate = true;
        arcObj.opacity = 1.0;
        arcObj.life = 0.15 + Math.random() * 0.1; // 0.15–0.25s duration
        arcObj.active = true;
        arcObj.mat.opacity = 1.0;
    }

    _updateArcs(deltaTime) {
        // Countdown spawn timer
        this._arcTimer -= deltaTime;
        if (this._arcTimer <= 0) {
            // Find an inactive arc to spawn
            for (const arc of this.arcs) {
                if (!arc.active) {
                    this._spawnArc(arc);
                    break;
                }
            }
            this._arcTimer = 2.0 + Math.random() * 3.0; // next arc in 2-5s
        }

        // Update active arcs
        for (const arc of this.arcs) {
            if (!arc.active) continue;

            arc.life -= deltaTime;
            if (arc.life <= 0) {
                arc.active = false;
                arc.opacity = 0;
                arc.mat.opacity = 0;
            } else {
                // Rapid fade-out
                arc.opacity = arc.life / 0.2;
                arc.mat.opacity = Math.min(arc.opacity, 1.0);
            }
        }
    }

    // ─── Per-Frame Update (gesture logic UNCHANGED) ──────────────────
    update(gesture, deltaTime) {
        if (deltaTime > 0.1) deltaTime = 0.1;

        const h0 = gesture.hands[0];
        const h1 = gesture.hands[1];
        const validHands = gesture.validHands;

        this.time += deltaTime;

        // ── SCALE (UNCHANGED) ────────────────────────────────────────
        if (validHands === 0) {
            this._noHandTimer += deltaTime;
            if (this._noHandTimer > 0.3) {
                this.targetScale = NORMAL_SCALE;
            }
        } else {
            this._noHandTimer = 0;

            if (validHands === 2) {
                const dist = gesture.distance;
                const t = THREE.MathUtils.clamp(
                    (dist - MIN_HAND_DIST) / (MAX_HAND_DIST - MIN_HAND_DIST), 0, 1
                );
                const smooth = t * t * (3 - 2 * t);
                this.targetScale = THREE.MathUtils.lerp(MIN_SCALE, MAX_SCALE, smooth);
            } else {
                const mainHand = h0.active ? h0 : h1;
                this.targetScale = THREE.MathUtils.lerp(MIN_SCALE, MAX_ONE_HAND_SCALE, mainHand.openness);
            }
        }

        this.scale = THREE.MathUtils.lerp(this.scale, this.targetScale, deltaTime * SCALE_LERP_SPEED);

        // ── ROTATION (UNCHANGED) ─────────────────────────────────────
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

        // ── IDLE TUMBLE + TENSION JITTER ──────────────────────────────
        // When hand rotation is near zero, add subtle multi-axis drift
        // When hand rotation is active, fade idle influence to zero
        const handRotMagnitude = Math.abs(this.rotation);
        if (handRotMagnitude > 0.1) {
            // Hand is driving rotation — suppress idle tumble
            this._idleInfluence = THREE.MathUtils.lerp(this._idleInfluence, 0, deltaTime * 8.0);
        } else {
            // No significant hand rotation — let idle tumble grow back
            this._idleInfluence = THREE.MathUtils.lerp(this._idleInfluence, 1.0, deltaTime * 2.0);
        }

        // Base idle drift (existing)
        const driftX = Math.sin(this.time * 0.17) * 0.003;
        const driftZ = Math.sin(this.time * 0.13 + 1.7) * 0.003;

        // Tension jitter — noise-driven hesitation layered on idle drift
        // Uses overlapping sines at non-harmonic frequencies for organic feel
        const jitterX = (Math.sin(this.time * 3.7) * Math.sin(this.time * 1.3 + 0.5)
                       + Math.sin(this.time * 7.1 + 2.0) * 0.3) * TUMBLE_JITTER_AMP;
        const jitterZ = (Math.sin(this.time * 2.9 + 1.0) * Math.sin(this.time * 1.7 + 0.8)
                       + Math.sin(this.time * 5.3 + 3.0) * 0.3) * TUMBLE_JITTER_AMP;

        this._idleTumbleX += (driftX + jitterX) * this._idleInfluence;
        this._idleTumbleZ += (driftZ + jitterZ) * this._idleInfluence;

        // ── BREATHING — additive micro-scale pulsing ─────────────────
        // Layered multi-sine oscillation on top of gesture-driven scale
        const t = this.time;
        const breathSlow = Math.sin(t * BREATH_SLOW_FREQ * Math.PI * 2) * BREATH_SLOW_AMP;
        const breathFast = Math.sin(t * BREATH_FAST_FREQ * Math.PI * 2 + 0.7) * BREATH_FAST_AMP;
        const breathIrreg = Math.sin(t * BREATH_IRREG_FREQ * Math.PI * 2 + 2.3)
                          * Math.sin(t * 0.23 + 1.1) * BREATH_IRREG_AMP;
        const breathingOffset = breathSlow + breathFast + breathIrreg;

        // ── APPLY TO VISUALS ─────────────────────────────────────────

        // Scale: gesture-driven + breathing modulation
        this.group.scale.setScalar(this.scale + breathingOffset);

        // Core mesh rotation: hand-driven Y + idle tumble on X/Z
        this.mesh.rotation.y = this.cumulativeRot;
        this.mesh.rotation.x = this._idleTumbleX;
        this.mesh.rotation.z = this._idleTumbleZ;

        // Core shader uniforms
        this.coreUniforms.uTime.value = this.time;

        // Flicker seed: slowly changing random-ish value for flare timing
        // Uses a non-linear time function so flares are irregularly spaced
        this.coreUniforms.uFlickerSeed.value = Math.sin(this.time * 0.37) * 43758.5453 % 1.0;

        // ── Glow light (dim for dark mass, modulated by breathing) ────
        this.glowLight.intensity = 0.2 + this.scale * 0.15 + breathingOffset * 2.0;

        // ── Electric arcs ────────────────────────────────────────────
        this._updateArcs(deltaTime);
    }
}
