/**
 * Memoization Utilities
 * 
 * Implements efficient caching for expensive computations
 * following pure function principles.
 * 
 * @fileoverview Memoization with TTL, LRU eviction, and async support
 * @author anoraK
 */

/**
 * @typedef {Object} MemoOptions
 * @property {number} [maxSize=100] - Maximum cache entries
 * @property {number} [ttl=300000] - Time to live in ms (default: 5 min)
 * @property {Function} [keyGenerator] - Custom key generation function
 */

/**
 * @typedef {Object} CacheEntry
 * @property {any} value - Cached value
 * @property {number} timestamp - Creation timestamp
 * @property {number} accessCount - Access count for LRU
 */

/**
 * Creates a memoized version of a function with LRU eviction
 * Pure function - no side effects on the original function
 * 
 * @template T
 * @param {(...args: any[]) => T} fn - Function to memoize
 * @param {MemoOptions} [options] - Memoization options
 * @returns {(...args: any[]) => T} - Memoized function
 */
export const memoize = (fn, options = {}) => {
  const {
    maxSize = 100,
    ttl = 5 * 60 * 1000,
    keyGenerator = (...args) => JSON.stringify(args),
  } = options;

  const cache = new Map();
  let accessCounter = 0;

  const isExpired = (entry) => Date.now() - entry.timestamp > ttl;

  const evictLRU = () => {
    if (cache.size < maxSize) return;

    let oldestKey = null;
    let oldestAccess = Infinity;

    for (const [key, entry] of cache.entries()) {
      if (isExpired(entry)) {
        cache.delete(key);
      } else if (entry.accessCount < oldestAccess) {
        oldestAccess = entry.accessCount;
        oldestKey = key;
      }
    }

    if (cache.size >= maxSize && oldestKey !== null) {
      cache.delete(oldestKey);
    }
  };

  const memoized = (...args) => {
    const key = keyGenerator(...args);

    if (cache.has(key)) {
      const entry = cache.get(key);
      if (!isExpired(entry)) {
        entry.accessCount = ++accessCounter;
        return entry.value;
      }
      cache.delete(key);
    }

    evictLRU();

    const value = fn(...args);
    cache.set(key, {
      value,
      timestamp: Date.now(),
      accessCount: ++accessCounter,
    });

    return value;
  };

  // Expose cache control methods
  memoized.clear = () => cache.clear();
  memoized.size = () => cache.size;
  memoized.has = (key) => cache.has(key);
  memoized.invalidate = (key) => cache.delete(key);

  return memoized;
};

/**
 * Creates a memoized version of an async function
 * Handles concurrent calls for the same key (deduplication)
 * 
 * @template T
 * @param {(...args: any[]) => Promise<T>} fn - Async function to memoize
 * @param {MemoOptions} [options] - Memoization options
 * @returns {(...args: any[]) => Promise<T>} - Memoized async function
 */
export const memoizeAsync = (fn, options = {}) => {
  const {
    maxSize = 100,
    ttl = 5 * 60 * 1000,
    keyGenerator = (...args) => JSON.stringify(args),
  } = options;

  const cache = new Map();
  const pendingPromises = new Map();
  let accessCounter = 0;

  const isExpired = (entry) => Date.now() - entry.timestamp > ttl;

  const evictExpired = () => {
    for (const [key, entry] of cache.entries()) {
      if (isExpired(entry)) {
        cache.delete(key);
      }
    }
  };

  const evictLRU = () => {
    evictExpired();
    if (cache.size < maxSize) return;

    const entries = [...cache.entries()]
      .sort((a, b) => a[1].accessCount - b[1].accessCount);

    const toEvict = entries.slice(0, Math.ceil(maxSize * 0.2));
    toEvict.forEach(([key]) => cache.delete(key));
  };

  const memoizedAsync = async (...args) => {
    const key = keyGenerator(...args);

    // Check cache first
    if (cache.has(key)) {
      const entry = cache.get(key);
      if (!isExpired(entry)) {
        entry.accessCount = ++accessCounter;
        return entry.value;
      }
      cache.delete(key);
    }

    // Deduplicate concurrent calls
    if (pendingPromises.has(key)) {
      return pendingPromises.get(key);
    }

    evictLRU();

    const promise = fn(...args)
      .then((value) => {
        cache.set(key, {
          value,
          timestamp: Date.now(),
          accessCount: ++accessCounter,
        });
        return value;
      })
      .finally(() => {
        pendingPromises.delete(key);
      });

    pendingPromises.set(key, promise);
    return promise;
  };

  // Expose cache control methods
  memoizedAsync.clear = () => {
    cache.clear();
    pendingPromises.clear();
  };
  memoizedAsync.size = () => cache.size;
  memoizedAsync.has = (key) => cache.has(key);
  memoizedAsync.invalidate = (key) => cache.delete(key);
  memoizedAsync.pending = () => pendingPromises.size;

  return memoizedAsync;
};

/**
 * Creates a resource-specific memoizer for URL content
 * Optimized for caching fetched resources by URL
 * 
 * @param {number} [maxSize=200] - Maximum cached resources
 * @param {number} [ttl=600000] - TTL (default: 10 min)
 * @returns {Object} Resource cache utilities
 */
export const createResourceCache = (maxSize = 200, ttl = 10 * 60 * 1000) => {
  const cache = new Map();
  const stats = { hits: 0, misses: 0 };

  const normalizeUrl = (url) => {
    try {
      const parsed = new URL(url);
      // Remove tracking parameters
      const trackers = ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid'];
      trackers.forEach(t => parsed.searchParams.delete(t));
      return parsed.href;
    } catch {
      return url;
    }
  };

  return {
    get: (url) => {
      const key = normalizeUrl(url);
      const entry = cache.get(key);

      if (entry && Date.now() - entry.timestamp <= ttl) {
        stats.hits++;
        return { found: true, value: entry.value };
      }

      if (entry) {
        cache.delete(key);
      }

      stats.misses++;
      return { found: false, value: null };
    },

    set: (url, value) => {
      const key = normalizeUrl(url);

      // Evict if at capacity
      if (cache.size >= maxSize) {
        const oldest = [...cache.entries()]
          .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
        if (oldest) cache.delete(oldest[0]);
      }

      cache.set(key, { value, timestamp: Date.now() });
    },

    clear: () => {
      cache.clear();
      stats.hits = 0;
      stats.misses = 0;
    },

    getStats: () => ({
      ...stats,
      size: cache.size,
      hitRate: stats.hits / (stats.hits + stats.misses) || 0,
    }),
  };
};

/**
 * Creates a checksum for content to enable idempotency checks
 * Pure function - deterministic hash generation
 * 
 * @param {string} content - Content to hash
 * @returns {Promise<string>} - SHA-256 hash
 */
export const computeChecksum = async (content) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Memoized checksum computation
 */
export const memoizedChecksum = memoizeAsync(computeChecksum, {
  maxSize: 50,
  ttl: 60 * 1000, // 1 minute
  keyGenerator: (content) => content.substring(0, 1000), // Use prefix as key
});
