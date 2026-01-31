/**
 * Scrappy Core Types
 * 
 * Implements SSOT (Single Source of Truth) for all data structures
 * and Monadic Error Handling via Result type.
 * 
 * @fileoverview Core type definitions following immutability principles
 * @author anoraK
 */

// ============================================================================
// Result Monad - Monadic Error Handling
// ============================================================================

/**
 * @template T, E
 * @typedef {Object} Result
 * @property {boolean} ok - Success flag
 * @property {T} [value] - Success value (present when ok=true)
 * @property {E} [error] - Error value (present when ok=false)
 * @property {string} [errorCode] - Machine-readable error code
 * @property {string} [context] - Human-readable context
 */

/**
 * Creates a successful Result
 * @template T
 * @param {T} value - The success value
 * @returns {Result<T, never>}
 */
export const Ok = (value) => Object.freeze({
  ok: true,
  value,
  // Monadic operations
  map: (fn) => Ok(fn(value)),
  flatMap: (fn) => fn(value),
  mapError: () => Ok(value),
  unwrap: () => value,
  unwrapOr: () => value,
  match: (handlers) => handlers.ok(value),
});

/**
 * Creates a failed Result
 * @template E
 * @param {E} error - The error value
 * @param {string} [errorCode] - Machine-readable error code
 * @param {string} [context] - Additional context
 * @returns {Result<never, E>}
 */
export const Err = (error, errorCode = 'UNKNOWN_ERROR', context = '') => Object.freeze({
  ok: false,
  error,
  errorCode,
  context,
  // Monadic operations
  map: () => Err(error, errorCode, context),
  flatMap: () => Err(error, errorCode, context),
  mapError: (fn) => Err(fn(error), errorCode, context),
  unwrap: () => { throw new Error(`Unwrap called on Err: ${error}`); },
  unwrapOr: (defaultValue) => defaultValue,
  match: (handlers) => handlers.err(error, errorCode, context),
});

/**
 * Wraps a potentially throwing function in a Result
 * @template T
 * @param {() => T} fn - Function that might throw
 * @param {string} [errorCode] - Error code if function throws
 * @returns {Result<T, Error>}
 */
export const tryCatch = (fn, errorCode = 'EXECUTION_ERROR') => {
  try {
    return Ok(fn());
  } catch (e) {
    return Err(e instanceof Error ? e : new Error(String(e)), errorCode);
  }
};

/**
 * Wraps an async function in a Result
 * @template T
 * @param {() => Promise<T>} fn - Async function that might throw
 * @param {string} [errorCode] - Error code if function throws
 * @returns {Promise<Result<T, Error>>}
 */
export const tryCatchAsync = async (fn, errorCode = 'ASYNC_ERROR') => {
  try {
    const result = await fn();
    return Ok(result);
  } catch (e) {
    return Err(e instanceof Error ? e : new Error(String(e)), errorCode);
  }
};

/**
 * Combines multiple Results into a single Result
 * @template T
 * @param {Result<T, any>[]} results - Array of Results
 * @returns {Result<T[], any>}
 */
export const combineResults = (results) => {
  const errors = results.filter(r => !r.ok);
  if (errors.length > 0) {
    return Err(
      errors.map(e => e.error),
      'COMBINED_ERRORS',
      `${errors.length} operations failed`
    );
  }
  return Ok(results.map(r => r.value));
};

// ============================================================================
// Option Type - Null Safety
// ============================================================================

/**
 * @template T
 * @typedef {Object} Option
 * @property {boolean} isSome - Has value flag
 * @property {T} [value] - The value (present when isSome=true)
 */

/**
 * Creates a Some option
 * @template T
 * @param {T} value - The value
 * @returns {Option<T>}
 */
export const Some = (value) => Object.freeze({
  isSome: true,
  value,
  map: (fn) => Some(fn(value)),
  flatMap: (fn) => fn(value),
  unwrap: () => value,
  unwrapOr: () => value,
  filter: (predicate) => predicate(value) ? Some(value) : None(),
});

/**
 * Creates a None option
 * @returns {Option<never>}
 */
export const None = () => Object.freeze({
  isSome: false,
  map: () => None(),
  flatMap: () => None(),
  unwrap: () => { throw new Error('Unwrap called on None'); },
  unwrapOr: (defaultValue) => defaultValue,
  filter: () => None(),
});

/**
 * Converts a nullable value to an Option
 * @template T
 * @param {T | null | undefined} value
 * @returns {Option<T>}
 */
export const fromNullable = (value) => 
  value != null ? Some(value) : None();

// ============================================================================
// Core Data Types - SSOT Implementation
// ============================================================================

/**
 * @typedef {'html' | 'mhtml' | 'pdf' | 'zip'} ExportFormat
 */

/**
 * @typedef {Object} Resource
 * @property {string} url - Original URL
 * @property {string} type - Resource type (css, js, image, font, etc.)
 * @property {string | ArrayBuffer} content - Inlined content
 * @property {string} mimeType - MIME type
 * @property {boolean} inlined - Whether content was successfully inlined
 * @property {string} [dataUri] - Base64 data URI for embedding
 */

/**
 * @typedef {Object} PageData
 * @property {string} url - Page URL
 * @property {string} title - Page title
 * @property {string} html - Serialized HTML
 * @property {Resource[]} resources - Collected resources
 * @property {Object} metadata - Page metadata
 * @property {number} capturedAt - Capture timestamp
 * @property {string} checksum - Content hash for idempotency
 */

/**
 * @typedef {Object} ScrapeConfig
 * @property {ExportFormat} format - Output format
 * @property {boolean} inlineResources - Whether to inline external resources
 * @property {boolean} includeScripts - Whether to include scripts
 * @property {boolean} includeStyles - Whether to include styles
 * @property {number} resourceTimeout - Timeout for resource fetching (ms)
 * @property {number} maxResourceSize - Maximum resource size to inline (bytes)
 * @property {string[]} excludePatterns - URL patterns to exclude
 */

/**
 * @typedef {Object} ScrapeResult
 * @property {PageData} pageData - Captured page data
 * @property {Blob} output - Output blob
 * @property {string} filename - Suggested filename
 * @property {number} duration - Scrape duration in ms
 * @property {Object} stats - Statistics
 */

/**
 * Creates immutable default scrape configuration
 * @returns {ScrapeConfig}
 */
export const createDefaultConfig = () => Object.freeze({
  format: 'html',
  inlineResources: true,
  includeScripts: true,
  includeStyles: true,
  resourceTimeout: 10000,
  maxResourceSize: 5 * 1024 * 1024, // 5MB
  excludePatterns: [
    '*analytics*',
    '*tracking*',
    '*advertisement*',
  ],
});

/**
 * Creates immutable PageData
 * @param {Partial<PageData>} data
 * @returns {PageData}
 */
export const createPageData = (data) => Object.freeze({
  url: data.url ?? '',
  title: data.title ?? 'Untitled',
  html: data.html ?? '',
  resources: Object.freeze(data.resources ?? []),
  metadata: Object.freeze(data.metadata ?? {}),
  capturedAt: data.capturedAt ?? Date.now(),
  checksum: data.checksum ?? '',
});

// ============================================================================
// Error Codes - Exhaustive Error Handling
// ============================================================================

export const ErrorCodes = Object.freeze({
  // Network errors
  NETWORK_FAILURE: 'NETWORK_FAILURE',
  FETCH_TIMEOUT: 'FETCH_TIMEOUT',
  CORS_BLOCKED: 'CORS_BLOCKED',
  
  // Permission errors
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  TAB_ACCESS_DENIED: 'TAB_ACCESS_DENIED',
  
  // Processing errors
  SERIALIZATION_FAILED: 'SERIALIZATION_FAILED',
  RESOURCE_TOO_LARGE: 'RESOURCE_TOO_LARGE',
  INVALID_FORMAT: 'INVALID_FORMAT',
  
  // Circuit breaker
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  
  // General
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
});

// ============================================================================
// Message Types - Extension Communication
// ============================================================================

export const MessageTypes = Object.freeze({
  // Scraping
  START_SCRAPE: 'START_SCRAPE',
  SCRAPE_PROGRESS: 'SCRAPE_PROGRESS',
  SCRAPE_COMPLETE: 'SCRAPE_COMPLETE',
  SCRAPE_ERROR: 'SCRAPE_ERROR',
  
  // Content script
  GET_PAGE_CONTENT: 'GET_PAGE_CONTENT',
  PAGE_CONTENT_RESPONSE: 'PAGE_CONTENT_RESPONSE',
  
  // Settings
  GET_SETTINGS: 'GET_SETTINGS',
  SAVE_SETTINGS: 'SAVE_SETTINGS',
  SETTINGS_RESPONSE: 'SETTINGS_RESPONSE',
  
  // Status
  GET_STATUS: 'GET_STATUS',
  STATUS_RESPONSE: 'STATUS_RESPONSE',
});
