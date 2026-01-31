/**
 * Resource Fetcher
 * 
 * Handles fetching and inlining of external resources with
 * circuit breaker protection and memoization.
 * 
 * @fileoverview Resource fetching with fault tolerance
 * @author anoraK
 */

import { Ok, Err, ErrorCodes, tryCatchAsync } from './types.js';
import { createCircuitBreakerRegistry } from './circuit-breaker.js';
import { createResourceCache, memoizeAsync } from './memoize.js';
import { getDLQ } from './dead-letter-queue.js';
import { withTimeout, mapAsync } from './utils.js';

// Initialize circuit breaker registry for domain-based protection
const circuitBreakerRegistry = createCircuitBreakerRegistry({
  failureThreshold: 3,
  successThreshold: 2,
  timeout: 30000,
});

// Initialize resource cache
const resourceCache = createResourceCache(200, 10 * 60 * 1000);

/**
 * MIME type mappings for common resource types
 */
const MIME_TYPES = Object.freeze({
  // Styles
  css: 'text/css',
  // Scripts
  js: 'application/javascript',
  mjs: 'application/javascript',
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  // Fonts
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  // Other
  json: 'application/json',
  xml: 'application/xml',
});

/**
 * Infers MIME type from URL
 * @param {string} url
 * @returns {string}
 */
const inferMimeType = (url) => {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split('.').pop()?.toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
  } catch {
    return 'application/octet-stream';
  }
};

/**
 * Determines resource type from URL or MIME type
 * @param {string} url
 * @param {string} mimeType
 * @returns {string}
 */
const getResourceType = (url, mimeType) => {
  if (mimeType.startsWith('text/css')) return 'css';
  if (mimeType.includes('javascript')) return 'js';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('font/') || mimeType.includes('font')) return 'font';
  return 'other';
};

/**
 * Converts ArrayBuffer to Base64
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
const arrayBufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

/**
 * Creates data URI from content
 * @param {string | ArrayBuffer} content
 * @param {string} mimeType
 * @returns {string}
 */
const createDataUri = (content, mimeType) => {
  if (typeof content === 'string') {
    // Text content - use base64 encoding for safety
    const base64 = btoa(unescape(encodeURIComponent(content)));
    return `data:${mimeType};base64,${base64}`;
  }
  // Binary content
  const base64 = arrayBufferToBase64(content);
  return `data:${mimeType};base64,${base64}`;
};

/**
 * Fetches a single resource with circuit breaker protection
 * Pure function - returns Result
 * 
 * @param {string} url - Resource URL
 * @param {Object} config - Scrape configuration
 * @returns {Promise<Result<Resource, Error>>}
 */
export const fetchResource = async (url, config) => {
  // Guard clause: validate URL
  if (!url || typeof url !== 'string') {
    return Err(new Error('Invalid URL'), ErrorCodes.VALIDATION_ERROR);
  }

  // Normalize URL
  let normalizedUrl = url;
  try {
    normalizedUrl = new URL(url).href;
  } catch {
    return Err(new Error(`Invalid URL: ${url}`), ErrorCodes.VALIDATION_ERROR);
  }

  // Check cache first (memoization)
  const cached = resourceCache.get(normalizedUrl);
  if (cached.found) {
    return Ok(cached.value);
  }

  // Get circuit breaker for this domain
  const breaker = circuitBreakerRegistry.getBreaker(normalizedUrl);

  // Execute fetch through circuit breaker
  const result = await breaker.execute(async () => {
    const response = await withTimeout(
      fetch(normalizedUrl, {
        mode: 'cors',
        credentials: 'omit',
        cache: 'force-cache',
      }),
      config.resourceTimeout || 10000,
      `Timeout fetching ${normalizedUrl}`
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || inferMimeType(normalizedUrl);
    const mimeType = contentType.split(';')[0].trim();
    const resourceType = getResourceType(normalizedUrl, mimeType);

    // Check size limit
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > config.maxResourceSize) {
      throw new Error(`Resource too large: ${contentLength} bytes`);
    }

    // Fetch content based on type
    let content;
    if (resourceType === 'css' || resourceType === 'js') {
      content = await response.text();
    } else {
      content = await response.arrayBuffer();
      
      // Check actual size
      if (content.byteLength > config.maxResourceSize) {
        throw new Error(`Resource too large: ${content.byteLength} bytes`);
      }
    }

    // Create resource object (immutable)
    const resource = Object.freeze({
      url: normalizedUrl,
      type: resourceType,
      content,
      mimeType,
      inlined: true,
      dataUri: createDataUri(content, mimeType),
    });

    // Cache the resource
    resourceCache.set(normalizedUrl, resource);

    return resource;
  });

  // Log failures to DLQ
  if (!result.ok) {
    const dlq = getDLQ();
    await dlq.enqueue({
      type: 'RESOURCE_FETCH_FAILURE',
      payload: { url: normalizedUrl },
      error: result.error,
      errorCode: result.errorCode,
      source: 'fetchResource',
      metadata: {
        domain: circuitBreakerRegistry.getDomain(normalizedUrl),
        circuitState: breaker.getState().state,
      },
    });
  }

  return result;
};

/**
 * Fetches multiple resources in parallel with concurrency control
 * Uses higher-order function mapAsync
 * 
 * @param {string[]} urls - Resource URLs
 * @param {Object} config - Scrape configuration
 * @param {Function} [onProgress] - Progress callback
 * @returns {Promise<Map<string, Result>>}
 */
export const fetchResources = async (urls, config, onProgress) => {
  const results = new Map();
  const uniqueUrls = [...new Set(urls)];
  let completed = 0;

  await mapAsync(
    uniqueUrls,
    async (url) => {
      const result = await fetchResource(url, config);
      results.set(url, result);
      
      completed++;
      if (onProgress) {
        onProgress({
          completed,
          total: uniqueUrls.length,
          percent: Math.round((completed / uniqueUrls.length) * 100),
        });
      }
    },
    5 // Concurrency limit
  );

  return results;
};

/**
 * Resolves relative URL to absolute URL
 * Pure function
 * 
 * @param {string} relativeUrl
 * @param {string} baseUrl
 * @returns {string}
 */
export const resolveUrl = (relativeUrl, baseUrl) => {
  if (!relativeUrl) return '';
  
  // Already absolute
  if (relativeUrl.startsWith('http://') || 
      relativeUrl.startsWith('https://') ||
      relativeUrl.startsWith('data:') ||
      relativeUrl.startsWith('blob:')) {
    return relativeUrl;
  }

  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    return relativeUrl;
  }
};

/**
 * Checks if URL should be excluded based on patterns
 * Pure function
 * 
 * @param {string} url
 * @param {string[]} patterns
 * @returns {boolean}
 */
export const shouldExclude = (url, patterns) => {
  const lowerUrl = url.toLowerCase();
  return patterns.some(pattern => {
    const regex = pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(regex, 'i').test(lowerUrl);
  });
};

/**
 * Gets cache statistics
 * @returns {Object}
 */
export const getCacheStats = () => ({
  resources: resourceCache.getStats(),
  circuitBreakers: circuitBreakerRegistry.getAllStates(),
});

/**
 * Resets all caches and circuit breakers
 */
export const resetAll = () => {
  resourceCache.clear();
  circuitBreakerRegistry.resetAll();
};
