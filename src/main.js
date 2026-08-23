/**
 * main.js — Entry point for NEUTRON.
 *
 * Initializes Three.js scene, starts hand tracking, and runs the game loop.
 * The webcam is used for tracking only — its feed is never shown.
 */
import * as THREE from 'three';
import { NeutronCore } from './neutron.js';
import { HandTracker } from './handtracker.js';
import { interpretGesture } from './gestures.js';

// --- Three.js Setup ---
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const canvas = document.getElementById('neutron-canvas');
const statusEl = document.getElementById('status');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 1); // Pitch black

const scene = new THREE.Scene();

// Camera
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0, 5);
camera.lookAt(0, 0, 0);

// Ambient light (very dim)
const ambientLight = new THREE.AmbientLight(0x112211, 0.5);
scene.add(ambientLight);

// --- Post-Processing (Bloom) ---
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.threshold = 0.7;  // Only the brightest crack cores bloom
bloomPass.strength = 2.0;   // Punchy but focused fissure glow
bloomPass.radius = 0.4;     // Tight halo — no broad wash

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// --- Neutron Core ---
const neutron = new NeutronCore(scene);

// --- Hand Tracker ---
const tracker = new HandTracker();
let currentGesture = { 
  mode: 'IDLE', 
  hands: [
    { active: false, openness: 0, position: {x:0, y:0}, velocity: {x:0, y:0}, angularVelocity: 0 },
    { active: false, openness: 0, position: {x:0, y:0}, velocity: {x:0, y:0}, angularVelocity: 0 }
  ],
  distance: 0,
  validHands: 0
};

async function initTracking() {
  try {
    statusEl.textContent = 'Requesting camera access...';
    await tracker.initialize();
    statusEl.textContent = 'Hand tracking active';
    setTimeout(() => {
      statusEl.style.opacity = '0.3';
    }, 2000);
  } catch (err) {
    console.error('Hand tracking failed:', err);
    statusEl.textContent = 'Camera access denied — running in demo mode';
    statusEl.style.color = 'rgba(255, 100, 100, 0.6)';
  }
}

initTracking();

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// --- Debug UI ---
const debugEl = document.getElementById('debug-ui');
let debugMode = false;

window.addEventListener('keydown', (e) => {
  if (e.key === 'd' || e.key === 'D') {
    debugMode = !debugMode;
    debugEl.style.display = debugMode ? 'block' : 'none';
  }
});

// --- Animation Loop ---
const clock = new THREE.Clock();

function updateDebugUI(gesture) {
  if (!debugMode) return;
  const h0 = gesture.hands[0];
  const h1 = gesture.hands[1];
  
  let html = `<strong>STATE:</strong> ${gesture.mode}<br>`;
  html += `<strong>HANDS:</strong> ${gesture.validHands}<br>`;
  if (gesture.validHands === 2) {
    html += `<strong>DISTANCE:</strong> ${gesture.distance.toFixed(3)}<br>`;
  }
  html += `<strong>SCALE:</strong> ${neutron.scale.toFixed(2)} → ${neutron.targetScale.toFixed(2)}<br>`;
  html += `<strong>ROTATION:</strong> ${neutron.rotation.toFixed(2)}<br>`;
  html += `<hr>`;
  if (h0.active) {
    html += `<strong>L OPENNESS:</strong> ${h0.openness.toFixed(2)}<br>`;
    html += `<strong>L ANG VEL:</strong> ${h0.angularVelocity.toFixed(2)}<br>`;
  }
  if (h1.active) {
    html += `<strong>R OPENNESS:</strong> ${h1.openness.toFixed(2)}<br>`;
    html += `<strong>R ANG VEL:</strong> ${h1.angularVelocity.toFixed(2)}<br>`;
  }
  
  debugEl.innerHTML = html;
}

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();

  // Read hand data and interpret gesture
  if (tracker.isReady) {
    const hands = tracker.getHands();
    currentGesture = interpretGesture(hands, currentGesture, delta);
    updateDebugUI(currentGesture);
  }

  // Update neutron core
  neutron.update(currentGesture, delta);

  // Render via composer instead of renderer
  composer.render();
}

animate();

