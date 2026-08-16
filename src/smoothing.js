/**
 * smoothing.js - Low-latency tracking filters.
 */
import * as THREE from 'three';

export class EMAFilter {
    constructor(alpha = 0.5) {
        this.alpha = alpha;
        this.value = null;
    }

    update(newValue) {
        if (this.value === null) {
            this.value = newValue;
        } else {
            this.value = this.alpha * newValue + (1 - this.alpha) * this.value;
        }
        return this.value;
    }
    
    reset() {
        this.value = null;
    }
}

export class Vec2EMAFilter {
    constructor(alpha = 0.5) {
        this.xFilter = new EMAFilter(alpha);
        this.yFilter = new EMAFilter(alpha);
    }
    
    update(x, y) {
        return {
            x: this.xFilter.update(x),
            y: this.yFilter.update(y)
        };
    }
    
    reset() {
        this.xFilter.reset();
        this.yFilter.reset();
    }
}

export class LandmarkEMAFilter {
    constructor(alpha = 0.5) {
        this.alpha = alpha;
        this.filtered = null;
    }

    update(landmarks) {
        if (!this.filtered || this.filtered.length !== landmarks.length) {
            this.filtered = landmarks.map(lm => ({ x: lm.x, y: lm.y, z: lm.z }));
            return this.filtered;
        }

        for (let i = 0; i < landmarks.length; i++) {
            this.filtered[i].x = this.alpha * landmarks[i].x + (1 - this.alpha) * this.filtered[i].x;
            this.filtered[i].y = this.alpha * landmarks[i].y + (1 - this.alpha) * this.filtered[i].y;
            this.filtered[i].z = this.alpha * landmarks[i].z + (1 - this.alpha) * this.filtered[i].z;
        }
        
        return this.filtered;
    }

    reset() {
        this.filtered = null;
    }
}
