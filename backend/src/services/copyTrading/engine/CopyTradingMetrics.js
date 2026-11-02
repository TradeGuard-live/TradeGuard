/**
 * CopyTradingMetrics.js
 * 
 * High-precision monotonic latency recorder. Uses `process.hrtime.bigint()`
 * to capture sub-microsecond execution timings across the pipeline stages.
 * Computes real empirical quantiles (p50, p90, p95, p99, min, max, avg).
 */

export class CopyTradingMetrics {
    constructor(maxSamples = 5000) {
        this.maxSamples = maxSamples;
        this.samples = {
            receipt_to_submit: [],
            submit_to_ack: [],
            end_to_end: []
        };
    }

    /**
     * Converts high-resolution nanosecond difference to milliseconds
     * @param {bigint} startNs
     * @param {bigint} endNs
     * @returns {number} Milliseconds with decimal precision
     */
    static nsToMs(startNs, endNs) {
        if (!startNs || !endNs) return 0;
        const diffNs = Number(endNs - startNs);
        return Math.max(0, diffNs / 1_000_000);
    }

    /**
     * Starts a high-resolution monotonic timer
     * @returns {bigint}
     */
    startTimer() {
        return process.hrtime.bigint();
    }

    /**
     * Records an observed duration sample in milliseconds for a specific pipeline stage
     * @param {"receipt_to_submit"|"submit_to_ack"|"end_to_end"} stage
     * @param {number} durationMs
     */
    recordSample(stage, durationMs) {
        if (!this.samples[stage]) {
            this.samples[stage] = [];
        }
        const val = Number(durationMs || 0);
        if (val < 0) return;

        const list = this.samples[stage];
        if (list.length >= this.maxSamples) {
            list.shift();
        }
        list.push(val);
    }

    /**
     * Calculates empirical quantiles and summary statistics for a given stage
     * @param {"receipt_to_submit"|"submit_to_ack"|"end_to_end"} stage
     * @returns {{ count: number, min: number, max: number, avg: number, p50: number, p90: number, p95: number, p99: number }}
     */
    getStats(stage = "receipt_to_submit") {
        const raw = this.samples[stage] || [];
        if (raw.length === 0) {
            return {
                stage,
                count: 0,
                min: 0,
                max: 0,
                avg: 0,
                p50: 0,
                p90: 0,
                p95: 0,
                p99: 0
            };
        }

        const sorted = [...raw].sort((a, b) => a - b);
        const count = sorted.length;
        const sum = sorted.reduce((acc, v) => acc + v, 0);

        const quantile = (q) => {
            const pos = (count - 1) * q;
            const base = Math.floor(pos);
            const rest = pos - base;
            if (sorted[base + 1] !== undefined) {
                return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
            }
            return sorted[base];
        };

        return {
            stage,
            count,
            min: Math.round(sorted[0] * 100) / 100,
            max: Math.round(sorted[count - 1] * 100) / 100,
            avg: Math.round((sum / count) * 100) / 100,
            p50: Math.round(quantile(0.50) * 100) / 100,
            p90: Math.round(quantile(0.90) * 100) / 100,
            p95: Math.round(quantile(0.95) * 100) / 100,
            p99: Math.round(quantile(0.99) * 100) / 100
        };
    }

    /**
     * Returns comprehensive latency metrics across all measured stages
     * @returns {Object}
     */
    getAllMetrics() {
        return {
            processingLatency: this.getStats("receipt_to_submit"),
            brokerAckLatency: this.getStats("submit_to_ack"),
            endToEndLatency: this.getStats("end_to_end"),
            timestamp: Date.now()
        };
    }

    /**
     * Resets latency buffers
     */
    reset() {
        this.samples.receipt_to_submit = [];
        this.samples.submit_to_ack = [];
        this.samples.end_to_end = [];
    }
}

export const copyTradingMetrics = new CopyTradingMetrics();
export default copyTradingMetrics;
