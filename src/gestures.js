/**
 * gestures.js — Interprets raw MediaPipe hand landmarks into gesture actions.
 *
 * Simplified: no split/merge state machine. Mode is either 'IDLE' (no hands)
 * or 'ACTIVE' (one or both hands detected). All the heavy lifting (openness,
 * angular velocity) is done per-hand inside HandState.
 */

function dist3D(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = (a.z || 0) - (b.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}

// Self-normalizing per-finger openness calculation. Measures each finger's
// tip extension past its own knuckle, normalized by palm size. Far less
// sensitive to hand size, camera distance, or viewing angle than a single
// global ratio.
//
// TUNING: press "D" in the app to open the debug overlay and watch the
// live OPENNESS value. A relaxed open hand should read close to 1.0; a
// closed fist should read close to 0.0.
function calculateHandOpenness(hand) {
    if (!hand) return 0;
    const wrist = hand[0];

    // Reference length: palm size (wrist to middle-finger MCP knuckle).
    const palmSize = dist3D(wrist, hand[9]);
    if (palmSize < 0.001) return 0;

    const fingers = [
        { mcp: 5, tip: 8 },   // index
        { mcp: 9, tip: 12 },  // middle
        { mcp: 13, tip: 16 }, // ring
        { mcp: 17, tip: 20 }, // pinky
    ];

    let total = 0;
    for (const f of fingers) {
        const mcpDist = dist3D(wrist, hand[f.mcp]);
        const tipDist = dist3D(wrist, hand[f.tip]);
        // How far the tip extends beyond its own knuckle, normalized by
        // palm size. Curled ≈ 0 or negative; fully extended ≈ 1.0+.
        total += clamp((tipDist - mcpDist) / palmSize, -0.3, 1.4);
    }

    // Thumb moves differently from the other four fingers, so it gets its
    // own tip-vs-CMC comparison rather than sharing the same reference.
    const thumbCmcDist = dist3D(wrist, hand[2]);
    const thumbTipDist = dist3D(wrist, hand[4]);
    const thumbExtension = clamp((thumbTipDist - thumbCmcDist) / palmSize, -0.3, 1.4);

    const avgExtension = (total + thumbExtension) / 5;

    // Approximate "fully open" ceiling per finger — tune this using the
    // debug overlay if needed.
    const FINGER_OPEN_RANGE = 1.0;

    return clamp(avgExtension / FINGER_OPEN_RANGE, 0, 1);
}

function calculateHandCenter(hand) {
    if (!hand) return { x: 0, y: 0 };
    const points = [hand[0], hand[5], hand[9], hand[13], hand[17]];
    const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
    return { x: cx, y: cy };
}

function normalizeAngle(angle) {
    while (angle <= -Math.PI) angle += Math.PI * 2;
    while (angle > Math.PI) angle -= Math.PI * 2;
    return angle;
}

class HandState {
    constructor() {
        this.active = false;
        this.confidence = 0;
        this.openness = 0;
        this.depth = 0;
        this.position = { x: 0, y: 0 };
        this.velocity = { x: 0, y: 0 };
        this.angularVelocity = 0;

        // History for translational velocity (rolling buffer)
        this._history = []; // array of { pos, time }
        this._totalTime = 0;

        // Previous angle relative to the fixed interaction center.
        // This drives angularVelocity — computed relative to (0,0) so
        // rotation direction corresponds to the hand's actual circular
        // movement around the core.
        this._prevAngle = null;
    }

    update(handObj, deltaTime, coreCenter) {
        if (!handObj || !handObj.active || !handObj.landmarks) {
            this.active = false;
            this.confidence = 0;
            this._history = [];
            this._totalTime = 0;
            this.angularVelocity = 0;
            this._prevAngle = null;
            return;
        }

        this.active = true;
        this.confidence = handObj.confidence;

        // Smooth openness with EMA
        const rawOpenness = calculateHandOpenness(handObj.landmarks);
        this.openness = this.openness === 0 ? rawOpenness : this.openness * 0.7 + rawOpenness * 0.3;

        // Depth proxy based on 2D size
        const wrist = handObj.landmarks[0];
        const middleMCP = handObj.landmarks[9];
        const size2D = Math.hypot(wrist.x - middleMCP.x, wrist.y - middleMCP.y);
        const rawDepth = (0.25 - size2D) * 1.5;
        this.depth = this.depth === 0 ? rawDepth : this.depth * 0.7 + rawDepth * 0.3;

        this.position = calculateHandCenter(handObj.landmarks);

        this._totalTime += deltaTime;

        // Translational velocity from position history
        this._history.push({
            pos: { x: this.position.x, y: this.position.y },
            time: this._totalTime
        });

        if (this._history.length > 10) {
            this._history.shift();
        }

        if (this._history.length >= 2) {
            const oldest = this._history[0];
            const newest = this._history[this._history.length - 1];
            const dt = newest.time - oldest.time;

            if (dt > 0.001) {
                this.velocity = {
                    x: (newest.pos.x - oldest.pos.x) / dt,
                    y: (newest.pos.y - oldest.pos.y) / dt
                };
            }
        }

        // Angular velocity relative to the fixed interaction center
        const cx = coreCenter ? coreCenter.x : 0;
        const cy = coreCenter ? coreCenter.y : 0;
        const currentAngle = Math.atan2(this.position.y - cy, this.position.x - cx);

        if (this._prevAngle !== null) {
            let dAngle = normalizeAngle(currentAngle - this._prevAngle);
            // Ignore large jumps (hand passing very close to center)
            if (Math.abs(dAngle) > Math.PI / 2) dAngle = 0;

            const rawAngularVelocity = dAngle / Math.max(deltaTime, 0.001);
            // Smooth to avoid jitter from per-frame landmark noise
            this.angularVelocity = this.angularVelocity * 0.7 + rawAngularVelocity * 0.3;
        } else {
            this.angularVelocity = 0;
        }
        this._prevAngle = currentAngle;
    }
}

// Global gesture state — simplified to IDLE/ACTIVE, no split/merge
const state = {
    mode: 'IDLE',
    hands: [new HandState(), new HandState()],
    distance: 0
};

export function interpretGesture(hands, prevGesture, deltaTime) {
    // Process hand states. coreCenter is the fixed interaction center
    // (screen/world origin) that rotation is measured around.
    state.hands[0].update(hands ? hands[0] : null, deltaTime, { x: 0, y: 0 });
    state.hands[1].update(hands ? hands[1] : null, deltaTime, { x: 0, y: 0 });

    const h0 = state.hands[0];
    const h1 = state.hands[1];

    let validHands = 0;
    if (h0.active) validHands++;
    if (h1.active) validHands++;

    // Always compute two-hand distance when both are present
    if (validHands === 2) {
        state.distance = Math.hypot(h0.position.x - h1.position.x, h0.position.y - h1.position.y);
    }

    // Simple mode: hands present = ACTIVE, no hands = IDLE
    state.mode = validHands > 0 ? 'ACTIVE' : 'IDLE';

    return {
        mode: state.mode,
        hands: [
            {
                active: h0.active,
                confidence: h0.confidence,
                openness: h0.openness,
                depth: h0.depth,
                position: h0.position,
                velocity: h0.velocity,
                angularVelocity: h0.angularVelocity
            },
            {
                active: h1.active,
                confidence: h1.confidence,
                openness: h1.openness,
                depth: h1.depth,
                position: h1.position,
                velocity: h1.velocity,
                angularVelocity: h1.angularVelocity
            }
        ],
        distance: state.distance,
        validHands
    };
}
