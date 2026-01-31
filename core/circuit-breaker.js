/**
 * Circuit Breaker Pattern Implementation
 * 
 * Protects against cascading failures during resource fetching.
 * Implements fail-fast logic and automatic recovery.
 * 
 * @fileoverview Circuit breaker with configurable thresholds
 * @author anoraK
 */

import { Err, ErrorCodes } from './types.js';

/**
 * @typedef {'CLOSED' | 'OPEN' | 'HALF_OPEN'} CircuitState
 */

/**
 * @typedef {Object} CircuitBreakerOptions
 * @property {number} [failureThreshold=5] - Failures before opening
 * @property {number} [successThreshold=3] - Successes to close from half-open
 * @property {number} [timeout=30000] - Time in open state before half-open (ms)
 * @property {number} [monitorWindow=60000] - Window for counting failures (ms)
 * @property {Function} [onStateChange] - Callback on state change
 */

/**
 * Creates a circuit breaker instance
 * Follows immutability - returns new state objects
 * 
 * @param {CircuitBreakerOptions} options
 * @returns {Object} Circuit breaker instance
 */
export const createCircuitBreaker = (options = {}) => {
  const {
    failureThreshold = 5,
    successThreshold = 3,
    timeout = 30000,
    monitorWindow = 60000,
    onStateChange = () => {},
  } = options;

  // Internal mutable state (encapsulated)
  let state = 'CLOSED';
  let failures = [];
  let successes = 0;
  let lastFailure = null;
  let openedAt = null;

  const cleanOldFailures = () => {
    const now = Date.now();
    failures = failures.filter(time => now - time < monitorWindow);
  };

  const getState = () => ({
    state,
    failureCount: failures.length,
    successCount: successes,
    lastFailure,
    openedAt,
    isOpen: state === 'OPEN',
    isClosed: state === 'CLOSED',
    isHalfOpen: state === 'HALF_OPEN',
  });

  const transitionTo = (newState) => {
    const oldState = state;
    state = newState;
    
    if (newState === 'OPEN') {
      openedAt = Date.now();
      successes = 0;
    } else if (newState === 'CLOSED') {
      failures = [];
      successes = 0;
      openedAt = null;
    } else if (newState === 'HALF_OPEN') {
      successes = 0;
    }

    if (oldState !== newState) {
      onStateChange({ from: oldState, to: newState, timestamp: Date.now() });
    }
  };

  const shouldAttempt = () => {
    if (state === 'CLOSED') return true;
    
    if (state === 'OPEN') {
      const elapsed = Date.now() - openedAt;
      if (elapsed >= timeout) {
        transitionTo('HALF_OPEN');
        return true;
      }
      return false;
    }
    
    return true; // HALF_OPEN allows attempts
  };

  const recordSuccess = () => {
    if (state === 'HALF_OPEN') {
      successes++;
      if (successes >= successThreshold) {
        transitionTo('CLOSED');
      }
    }
    // In CLOSED state, success is the norm
  };

  const recordFailure = (error) => {
    lastFailure = {
      error: error?.message || String(error),
      timestamp: Date.now(),
    };

    if (state === 'HALF_OPEN') {
      transitionTo('OPEN');
      return;
    }

    if (state === 'CLOSED') {
      cleanOldFailures();
      failures.push(Date.now());
      
      if (failures.length >= failureThreshold) {
        transitionTo('OPEN');
      }
    }
  };

  /**
   * Executes a function through the circuit breaker
   * @template T
   * @param {() => Promise<T>} fn - Async function to execute
   * @returns {Promise<Result<T, Error>>}
   */
  const execute = async (fn) => {
    if (!shouldAttempt()) {
      return Err(
        new Error(`Circuit breaker is OPEN. Retry after ${Math.ceil((timeout - (Date.now() - openedAt)) / 1000)}s`),
        ErrorCodes.CIRCUIT_OPEN,
        'Circuit breaker preventing request'
      );
    }

    try {
      const result = await fn();
      recordSuccess();
      return { ok: true, value: result };
    } catch (error) {
      recordFailure(error);
      return Err(
        error instanceof Error ? error : new Error(String(error)),
        ErrorCodes.NETWORK_FAILURE,
        'Request failed through circuit breaker'
      );
    }
  };

  const reset = () => {
    transitionTo('CLOSED');
    failures = [];
    lastFailure = null;
  };

  const forceOpen = () => {
    transitionTo('OPEN');
  };

  return Object.freeze({
    execute,
    getState,
    reset,
    forceOpen,
    shouldAttempt,
    recordSuccess,
    recordFailure,
  });
};

/**
 * Creates a domain-specific circuit breaker registry
 * Groups circuit breakers by domain to isolate failures
 * 
 * @param {CircuitBreakerOptions} [defaultOptions]
 * @returns {Object} Circuit breaker registry
 */
export const createCircuitBreakerRegistry = (defaultOptions = {}) => {
  const breakers = new Map();

  const getDomain = (url) => {
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown';
    }
  };

  const getBreaker = (url) => {
    const domain = getDomain(url);
    
    if (!breakers.has(domain)) {
      breakers.set(domain, createCircuitBreaker({
        ...defaultOptions,
        onStateChange: (change) => {
          console.log(`[CircuitBreaker] ${domain}: ${change.from} → ${change.to}`);
        },
      }));
    }
    
    return breakers.get(domain);
  };

  const getAllStates = () => {
    const states = {};
    for (const [domain, breaker] of breakers.entries()) {
      states[domain] = breaker.getState();
    }
    return states;
  };

  const resetAll = () => {
    for (const breaker of breakers.values()) {
      breaker.reset();
    }
  };

  const resetDomain = (url) => {
    const domain = getDomain(url);
    if (breakers.has(domain)) {
      breakers.get(domain).reset();
    }
  };

  return Object.freeze({
    getBreaker,
    getAllStates,
    resetAll,
    resetDomain,
    getDomain,
  });
};

/**
 * Higher-order function that wraps any async function with circuit breaker
 * 
 * @template T
 * @param {(...args: any[]) => Promise<T>} fn - Function to protect
 * @param {Object} breaker - Circuit breaker instance
 * @returns {(...args: any[]) => Promise<Result<T, Error>>}
 */
export const withCircuitBreaker = (fn, breaker) => {
  return async (...args) => {
    return breaker.execute(() => fn(...args));
  };
};
