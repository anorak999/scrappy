/**
 * Functional Utilities
 * 
 * Higher-order functions, composition, and functional helpers.
 * All functions are pure with no side effects.
 * 
 * @fileoverview Functional programming utilities
 * @author anoraK
 */

// ============================================================================
// Function Composition
// ============================================================================

/**
 * Composes functions from right to left
 * @param {...Function} fns - Functions to compose
 * @returns {Function} Composed function
 */
export const compose = (...fns) => 
  fns.reduce((f, g) => (...args) => f(g(...args)));

/**
 * Pipes functions from left to right
 * @param {...Function} fns - Functions to pipe
 * @returns {Function} Piped function
 */
export const pipe = (...fns) => 
  fns.reduce((f, g) => (...args) => g(f(...args)));

/**
 * Async version of pipe
 * @param {...Function} fns - Async functions to pipe
 * @returns {Function} Piped async function
 */
export const pipeAsync = (...fns) => 
  (input) => fns.reduce(
    (promise, fn) => promise.then(fn),
    Promise.resolve(input)
  );

// ============================================================================
// Currying
// ============================================================================

/**
 * Curries a function
 * @param {Function} fn - Function to curry
 * @param {number} [arity] - Expected arity
 * @returns {Function} Curried function
 */
export const curry = (fn, arity = fn.length) => {
  const curried = (...args) => {
    if (args.length >= arity) {
      return fn(...args);
    }
    return (...moreArgs) => curried(...args, ...moreArgs);
  };
  return curried;
};

/**
 * Partially applies arguments to a function
 * @param {Function} fn - Function to partially apply
 * @param {...any} args - Arguments to pre-apply
 * @returns {Function} Partially applied function
 */
export const partial = (fn, ...args) => 
  (...moreArgs) => fn(...args, ...moreArgs);

// ============================================================================
// Array Utilities
// ============================================================================

/**
 * Maps over array with async function, limiting concurrency
 * @template T, R
 * @param {T[]} items - Items to process
 * @param {(item: T, index: number) => Promise<R>} fn - Async mapper
 * @param {number} [concurrency=5] - Max concurrent operations
 * @returns {Promise<R[]>}
 */
export const mapAsync = async (items, fn, concurrency = 5) => {
  const results = [];
  const executing = new Set();

  for (let i = 0; i < items.length; i++) {
    const promise = Promise.resolve().then(() => fn(items[i], i));
    results.push(promise);
    executing.add(promise);

    const cleanup = () => executing.delete(promise);
    promise.then(cleanup, cleanup);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
};

/**
 * Filters array with async predicate
 * @template T
 * @param {T[]} items - Items to filter
 * @param {(item: T) => Promise<boolean>} predicate - Async predicate
 * @returns {Promise<T[]>}
 */
export const filterAsync = async (items, predicate) => {
  const results = await mapAsync(items, async (item) => ({
    item,
    keep: await predicate(item),
  }));
  return results.filter(r => r.keep).map(r => r.item);
};

/**
 * Reduces array with async reducer
 * @template T, R
 * @param {T[]} items - Items to reduce
 * @param {(acc: R, item: T) => Promise<R>} reducer - Async reducer
 * @param {R} initial - Initial value
 * @returns {Promise<R>}
 */
export const reduceAsync = async (items, reducer, initial) => {
  let acc = initial;
  for (const item of items) {
    acc = await reducer(acc, item);
  }
  return acc;
};

/**
 * Chunks array into smaller arrays
 * @template T
 * @param {T[]} array - Array to chunk
 * @param {number} size - Chunk size
 * @returns {T[][]}
 */
export const chunk = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

/**
 * Flattens nested arrays by one level
 * @template T
 * @param {T[][]} arrays - Nested arrays
 * @returns {T[]}
 */
export const flatten = (arrays) => [].concat(...arrays);

/**
 * Unique values from array
 * @template T
 * @param {T[]} array
 * @param {(item: T) => any} [keyFn] - Key function
 * @returns {T[]}
 */
export const unique = (array, keyFn = (x) => x) => {
  const seen = new Set();
  return array.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Groups array by key
 * @template T
 * @param {T[]} array
 * @param {(item: T) => string} keyFn - Key function
 * @returns {Object<string, T[]>}
 */
export const groupBy = (array, keyFn) => 
  array.reduce((acc, item) => {
    const key = keyFn(item);
    (acc[key] = acc[key] || []).push(item);
    return acc;
  }, {});

// ============================================================================
// Object Utilities
// ============================================================================

/**
 * Deep clones an object (immutability helper)
 * @template T
 * @param {T} obj - Object to clone
 * @returns {T}
 */
export const deepClone = (obj) => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof Array) return obj.map(deepClone);
  if (obj instanceof Set) return new Set([...obj].map(deepClone));
  if (obj instanceof Map) return new Map([...obj].map(([k, v]) => [k, deepClone(v)]));
  
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, deepClone(v)])
  );
};

/**
 * Deep freezes an object (immutability enforcement)
 * @template T
 * @param {T} obj - Object to freeze
 * @returns {T}
 */
export const deepFreeze = (obj) => {
  if (obj === null || typeof obj !== 'object') return obj;
  
  Object.keys(obj).forEach(key => {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      deepFreeze(obj[key]);
    }
  });
  
  return Object.freeze(obj);
};

/**
 * Picks specific keys from object
 * @template T
 * @param {T} obj
 * @param {string[]} keys
 * @returns {Partial<T>}
 */
export const pick = (obj, keys) => 
  keys.reduce((acc, key) => {
    if (key in obj) acc[key] = obj[key];
    return acc;
  }, {});

/**
 * Omits specific keys from object
 * @template T
 * @param {T} obj
 * @param {string[]} keys
 * @returns {Partial<T>}
 */
export const omit = (obj, keys) => {
  const keySet = new Set(keys);
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !keySet.has(k))
  );
};

// ============================================================================
// String Utilities
// ============================================================================

/**
 * Sanitizes filename for safe saving
 * @param {string} filename
 * @returns {string}
 */
export const sanitizeFilename = (filename) => 
  filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 200);

/**
 * Extracts domain from URL
 * @param {string} url
 * @returns {string}
 */
export const extractDomain = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
};

/**
 * Generates timestamp string for filenames
 * @returns {string}
 */
export const generateTimestamp = () => {
  const now = new Date();
  return now.toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
};

// ============================================================================
// Timing Utilities
// ============================================================================

/**
 * Delays execution
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
export const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wraps promise with timeout
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms - Timeout in ms
 * @param {string} [message] - Timeout error message
 * @returns {Promise<T>}
 */
export const withTimeout = (promise, ms, message = 'Operation timed out') => 
  Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(message)), ms)
    ),
  ]);

/**
 * Debounces a function
 * @param {Function} fn
 * @param {number} wait
 * @returns {Function}
 */
export const debounce = (fn, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
};

/**
 * Throttles a function
 * @param {Function} fn
 * @param {number} limit
 * @returns {Function}
 */
export const throttle = (fn, limit) => {
  let inThrottle;
  return (...args) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

// ============================================================================
// Guard Clauses
// ============================================================================

/**
 * Asserts condition, throws if false (fail-fast)
 * @param {boolean} condition
 * @param {string} message
 */
export const assert = (condition, message) => {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
};

/**
 * Validates input is not null/undefined
 * @template T
 * @param {T | null | undefined} value
 * @param {string} name
 * @returns {T}
 */
export const requireNonNull = (value, name) => {
  if (value == null) {
    throw new Error(`${name} is required but was ${value}`);
  }
  return value;
};

/**
 * Validates string is not empty
 * @param {string} value
 * @param {string} name
 * @returns {string}
 */
export const requireNonEmpty = (value, name) => {
  requireNonNull(value, name);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
};
