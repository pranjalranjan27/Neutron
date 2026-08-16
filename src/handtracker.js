/**
 * handtracker.js — Wraps MediaPipe Hands for gesture detection.
 * The camera feed is never shown to the user.
 */
import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { LandmarkEMAFilter } from './smoothing.js';

export class HandTracker {
  constructor() {
    this.landmarks = []; // Array of smoothed, normalized hands
    this.rawLandmarks = [];
    this.rawHandedness = []; // FIX: MediaPipe's per-hand Left/Right classification
    this.isReady = false;
    this._hands = null;
    this._camera = null;

    // Filters for up to 2 hands to maintain continuity
    this.filters = [new LandmarkEMAFilter(0.3), new LandmarkEMAFilter(0.3)];
    this.handMissingFrames = [0, 0];

    // Stable identity per slot: keeps the same physical hand mapped to the
    // same slot frame to frame, even when both hands are close together.
    this.slotHandedness = [null, null];
  }

  async initialize() {
    const videoEl = document.getElementById('webcam');

    this._hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    this._hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7, // Increased for stability
    });

    this._hands.onResults((results) => {
      this.rawLandmarks = [];
      this.rawHandedness = [];
      if (results.multiHandLandmarks) {
        for (let i = 0; i < results.multiHandLandmarks.length; i++) {
          this.rawLandmarks.push(results.multiHandLandmarks[i]);
          // FIX: capture MediaPipe's handedness classification alongside
          // the landmarks — this was being read from `results` but silently
          // discarded before, so slot assignment had no stable identity to
          // anchor to.
          const handedness = results.multiHandedness && results.multiHandedness[i];
          this.rawHandedness.push(handedness ? handedness.label : null); // 'Left' | 'Right' | null
        }
      }
      this._processResults();
    });

    this._camera = new Camera(videoEl, {
      onFrame: async () => {
        await this._hands.send({ image: videoEl });
      },
      width: 640,
      height: 480,
    });

    await this._camera.start();
    this.isReady = true;
  }

  _processResults() {
    const activeHands = [null, null];

    // Normalize raw landmarks first
    const incoming = this.rawLandmarks.map(rawHand => {
        return rawHand.map(lm => ({
            x: -((lm.x * 2) - 1),
            y: -((lm.y * 2) - 1),
            z: lm.z
        }));
    });
    const incHandedness = this.rawHandedness;

    // Helper: calculate center of a hand (average of wrist + MCPs)
    const getCenter = (hand) => {
        if (!hand) return null;
        const points = [hand[0], hand[5], hand[9], hand[13], hand[17]];
        const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
        const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
        return { x: cx, y: cy };
    };

    // Calculate centers
    const incCenters = incoming.map(getCenter);
    const knownCenters = [
        getCenter(this.filters[0].filtered),
        getCenter(this.filters[1].filtered)
    ];

    // Distance function
    const dist = (a, b) => {
        if (!a || !b) return Infinity;
        return Math.hypot(a.x - b.x, a.y - b.y);
    };

    let assignments = [null, null]; // matches filter index to incoming index
    let incomingUsed = new Set();

    // PASS 1: match by stable handedness identity first. Prevents the two
    // hands' data from swapping slots when the hands are close together.
    for (let f = 0; f < 2; f++) {
        const knownLabel = this.slotHandedness[f];
        if (!knownLabel) continue;

        for (let inc = 0; inc < incoming.length; inc++) {
            if (incomingUsed.has(inc)) continue;
            if (incHandedness[inc] === knownLabel) {
                assignments[f] = inc;
                incomingUsed.add(inc);
                break;
            }
        }
    }

    // PASS 2: fall back to nearest-position matching for any slot handedness
    // couldn't resolve (e.g. handedness unavailable this frame, or a brand
    // new hand entering the frame for the first time).
    for (let f = 0; f < 2; f++) {
        if (assignments[f] !== null) continue; // Filter already assigned

        let bestDist = Infinity;
        let bestIncomingIdx = -1;

        for (let inc = 0; inc < incoming.length; inc++) {
            if (incomingUsed.has(inc)) continue; // Incoming already assigned

            const d = dist(knownCenters[f], incCenters[inc]);
            if (d < bestDist) {
                bestDist = d;
                bestIncomingIdx = inc;
            }
        }

        // If we found a good match (distance < threshold to avoid teleporting across screen)
        // If no known center (new hand), distance is Infinity, we just assign to first empty filter
        if (bestIncomingIdx !== -1 && (bestDist < 1.0 || !knownCenters[f])) {
            assignments[f] = bestIncomingIdx;
            incomingUsed.add(bestIncomingIdx);
        }
    }

    // Assign any remaining incoming hands to any remaining empty filters
    for (let inc = 0; inc < incoming.length; inc++) {
        if (!incomingUsed.has(inc)) {
            for (let f = 0; f < 2; f++) {
                if (assignments[f] === null) {
                    assignments[f] = inc;
                    incomingUsed.add(inc);
                    break;
                }
            }
        }
    }

    // Update filters and build output
    for (let i = 0; i < 2; i++) {
        const incIdx = assignments[i];

        if (incIdx !== null) {
            // Valid hand detected
            this.handMissingFrames[i] = 0;
            // Remember this slot's handedness for stable re-identification.
            if (incHandedness[incIdx]) {
                this.slotHandedness[i] = incHandedness[incIdx];
            }
            const smoothed = this.filters[i].update(incoming[incIdx]);
            activeHands[i] = {
                active: true,
                confidence: 1.0,
                landmarks: smoothed
            };
        } else {
            // Hand missing
            this.handMissingFrames[i]++;

            // Grace period logic (assuming ~60fps)
            // 0 - 9 frames (~150ms): Fully preserve state
            // 10 - 24 frames (~150-400ms): Gracefully degrade confidence
            // > 24 frames (>400ms): Consider lost entirely
            if (this.handMissingFrames[i] < 24 && this.filters[i].filtered) {
                let conf = 1.0;
                if (this.handMissingFrames[i] >= 10) {
                    conf = 1.0 - ((this.handMissingFrames[i] - 10) / 14); // Ramp down to 0
                }

                activeHands[i] = {
                    active: conf > 0,
                    confidence: Math.max(0, conf),
                    landmarks: this.filters[i].filtered
                };
            } else {
                this.filters[i].reset();
                this.slotHandedness[i] = null; // Clear identity once truly lost
                activeHands[i] = { active: false, confidence: 0, landmarks: null };
            }
        }
    }

    this.landmarks = activeHands;
  }

  /**
   * Returns an array of 2 hand objects: { active, confidence, landmarks }
   */
  getHands() {
    return this.landmarks;
  }

  getHandCount() {
    return this.landmarks.filter(h => h && h.active).length;
  }
}
