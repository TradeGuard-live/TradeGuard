/**
 * OrderStateMachine.js
 * 
 * Formal state machine governing order transitions for follower orders.
 * Prevents invalid lifecycle jumps (e.g., transitioning from FILLED to CANCELLED).
 */

export const ORDER_STATES = {
    PENDING: "PENDING",
    SUBMITTED: "SUBMITTED",
    ACKNOWLEDGED: "ACKNOWLEDGED",
    PARTIALLY_FILLED: "PARTIALLY_FILLED",
    FILLED: "FILLED",
    REJECTED: "REJECTED",
    CANCELLED: "CANCELLED",
    FAILED: "FAILED",
    UNKNOWN: "UNKNOWN"
};

const VALID_TRANSITIONS = {
    PENDING: ["SUBMITTED", "FAILED", "REJECTED"],
    SUBMITTED: ["ACKNOWLEDGED", "REJECTED", "UNKNOWN", "FAILED", "FILLED"],
    ACKNOWLEDGED: ["PARTIALLY_FILLED", "FILLED", "CANCELLED", "UNKNOWN"],
    PARTIALLY_FILLED: ["PARTIALLY_FILLED", "FILLED", "CANCELLED", "UNKNOWN"],
    UNKNOWN: ["ACKNOWLEDGED", "PARTIALLY_FILLED", "FILLED", "REJECTED", "CANCELLED", "FAILED"],
    FILLED: [], // Terminal state
    REJECTED: [], // Terminal state
    CANCELLED: [], // Terminal state
    FAILED: [] // Terminal state
};

export class OrderStateMachine {
    /**
     * Checks if a transition from current state to target state is legally permitted
     * @param {string} currentState
     * @param {string} targetState
     * @returns {boolean}
     */
    static canTransition(currentState, targetState) {
        const from = String(currentState || "").toUpperCase();
        const to = String(targetState || "").toUpperCase();

        if (from === to) return true; // Idempotent no-op

        const allowed = VALID_TRANSITIONS[from];
        if (!allowed) return false;

        return allowed.includes(to);
    }

    /**
     * Validates transition or throws an error
     * @param {string} currentState
     * @param {string} targetState
     */
    static validateTransition(currentState, targetState) {
        if (!this.canTransition(currentState, targetState)) {
            throw new Error(`Illegal order state transition: ${currentState} -> ${targetState}`);
        }
    }

    /**
     * Checks if an order state is open (eligible for modification or cancellation)
     * @param {string} state
     * @returns {boolean}
     */
    static isOpen(state) {
        const s = String(state || "").toUpperCase();
        return ["PENDING", "SUBMITTED", "ACKNOWLEDGED", "PARTIALLY_FILLED", "UNKNOWN"].includes(s);
    }

    /**
     * Checks if an order state is terminal
     * @param {string} state
     * @returns {boolean}
     */
    static isTerminal(state) {
        const s = String(state || "").toUpperCase();
        return ["FILLED", "REJECTED", "CANCELLED", "FAILED"].includes(s);
    }
}

export default OrderStateMachine;
