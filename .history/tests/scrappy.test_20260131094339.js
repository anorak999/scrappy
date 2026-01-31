/**
 * Scrappy Test Specifications
 * 
 * Comprehensive test suite covering unit tests, integration tests,
 * and edge cases following the testing pyramid.
 * 
 * @fileoverview Test specifications with pattern-based approach
 * @author anoraK
 */

// ============================================================================
// Test Configuration
// ============================================================================

/**
 * Test utilities and mocks
 */
const createMockChrome = () => ({
  runtime: {
    sendMessage: jest.fn(),
    onMessage: { addListener: jest.fn() },
    lastError: null,
    getManifest: () => ({ version: '1.0.0' }),
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn(),
  },
  storage: {
    sync: {
      get: jest.fn(),
      set: jest.fn(),
    },
    local: {
      get: jest.fn(),
      set: jest.fn(),
    },
  },
  downloads: {
    download: jest.fn(),
  },
  scripting: {
    executeScript: jest.fn(),
  },
  notifications: {
    create: jest.fn(),
  },
});

// ============================================================================
// Unit Tests - Core Types
// ============================================================================

describe('Core Types', () => {
  describe('Result Monad', () => {
    const { Ok, Err, tryCatch, tryCatchAsync, combineResults } = require('../core/types.js');

    test('Ok creates successful result', () => {
      const result = Ok(42);
      expect(result.ok).toBe(true);
      expect(result.value).toBe(42);
    });

    test('Err creates failed result', () => {
      const result = Err(new Error('test'), 'TEST_ERROR', 'context');
      expect(result.ok).toBe(false);
      expect(result.error.message).toBe('test');
      expect(result.errorCode).toBe('TEST_ERROR');
    });

    test('Ok.map transforms value', () => {
      const result = Ok(5).map(x => x * 2);
      expect(result.value).toBe(10);
    });

    test('Err.map preserves error', () => {
      const result = Err('error').map(x => x * 2);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('error');
    });

    test('Ok.flatMap chains operations', () => {
      const result = Ok(5).flatMap(x => Ok(x * 2));
      expect(result.value).toBe(10);
    });

    test('Ok.unwrap returns value', () => {
      expect(Ok(42).unwrap()).toBe(42);
    });

    test('Err.unwrap throws', () => {
      expect(() => Err('error').unwrap()).toThrow();
    });

    test('Ok.unwrapOr returns value', () => {
      expect(Ok(42).unwrapOr(0)).toBe(42);
    });

    test('Err.unwrapOr returns default', () => {
      expect(Err('error').unwrapOr(0)).toBe(0);
    });

    test('tryCatch catches sync errors', () => {
      const result = tryCatch(() => { throw new Error('sync error'); });
      expect(result.ok).toBe(false);
    });

    test('tryCatchAsync catches async errors', async () => {
      const result = await tryCatchAsync(async () => { 
        throw new Error('async error'); 
      });
      expect(result.ok).toBe(false);
    });

    test('combineResults combines successful results', () => {
      const results = [Ok(1), Ok(2), Ok(3)];
      const combined = combineResults(results);
      expect(combined.ok).toBe(true);
      expect(combined.value).toEqual([1, 2, 3]);
    });

    test('combineResults fails on any error', () => {
      const results = [Ok(1), Err('error'), Ok(3)];
      const combined = combineResults(results);
      expect(combined.ok).toBe(false);
    });
  });

  describe('Option Type', () => {
    const { Some, None, fromNullable } = require('../core/types.js');

    test('Some creates option with value', () => {
      const opt = Some(42);
      expect(opt.isSome).toBe(true);
      expect(opt.value).toBe(42);
    });

    test('None creates empty option', () => {
      const opt = None();
      expect(opt.isSome).toBe(false);
    });

    test('fromNullable converts null to None', () => {
      expect(fromNullable(null).isSome).toBe(false);
      expect(fromNullable(undefined).isSome).toBe(false);
    });

    test('fromNullable converts value to Some', () => {
      expect(fromNullable(42).isSome).toBe(true);
      expect(fromNullable(42).value).toBe(42);
    });
  });
});

// ============================================================================
// Unit Tests - Memoization
// ============================================================================

describe('Memoization', () => {
  const { memoize, memoizeAsync, computeChecksum } = require('../core/memoize.js');

  describe('memoize', () => {
    test('caches function results', () => {
      let callCount = 0;
      const fn = (x) => { callCount++; return x * 2; };
      const memoized = memoize(fn);

      expect(memoized(5)).toBe(10);
      expect(memoized(5)).toBe(10);
      expect(callCount).toBe(1);
    });

    test('respects cache size limit', () => {
      const fn = (x) => x * 2;
      const memoized = memoize(fn, { maxSize: 2 });

      memoized(1);
      memoized(2);
      memoized(3);

      expect(memoized.size()).toBeLessThanOrEqual(2);
    });

    test('expires entries after TTL', async () => {
      jest.useFakeTimers();
      let callCount = 0;
      const fn = (x) => { callCount++; return x; };
      const memoized = memoize(fn, { ttl: 100 });

      memoized(1);
      expect(callCount).toBe(1);

      jest.advanceTimersByTime(150);
      memoized(1);
      expect(callCount).toBe(2);

      jest.useRealTimers();
    });
  });

  describe('memoizeAsync', () => {
    test('caches async function results', async () => {
      let callCount = 0;
      const fn = async (x) => { callCount++; return x * 2; };
      const memoized = memoizeAsync(fn);

      expect(await memoized(5)).toBe(10);
      expect(await memoized(5)).toBe(10);
      expect(callCount).toBe(1);
    });

    test('deduplicates concurrent calls', async () => {
      let callCount = 0;
      const fn = async (x) => { 
        callCount++; 
        await new Promise(r => setTimeout(r, 100));
        return x * 2; 
      };
      const memoized = memoizeAsync(fn);

      const [r1, r2, r3] = await Promise.all([
        memoized(5),
        memoized(5),
        memoized(5),
      ]);

      expect(r1).toBe(10);
      expect(r2).toBe(10);
      expect(r3).toBe(10);
      expect(callCount).toBe(1);
    });
  });

  describe('computeChecksum', () => {
    test('produces consistent hashes', async () => {
      const hash1 = await computeChecksum('test content');
      const hash2 = await computeChecksum('test content');
      expect(hash1).toBe(hash2);
    });

    test('produces different hashes for different content', async () => {
      const hash1 = await computeChecksum('content 1');
      const hash2 = await computeChecksum('content 2');
      expect(hash1).not.toBe(hash2);
    });

    test('returns 64 character hex string', async () => {
      const hash = await computeChecksum('test');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});

// ============================================================================
// Unit Tests - Circuit Breaker
// ============================================================================

describe('Circuit Breaker', () => {
  const { createCircuitBreaker } = require('../core/circuit-breaker.js');

  test('starts in CLOSED state', () => {
    const breaker = createCircuitBreaker();
    expect(breaker.getState().state).toBe('CLOSED');
  });

  test('opens after threshold failures', async () => {
    const breaker = createCircuitBreaker({ 
      failureThreshold: 3,
      monitorWindow: 60000,
    });

    for (let i = 0; i < 3; i++) {
      await breaker.execute(async () => { throw new Error('fail'); });
    }

    expect(breaker.getState().state).toBe('OPEN');
  });

  test('rejects requests when OPEN', async () => {
    const breaker = createCircuitBreaker({ failureThreshold: 1 });
    
    await breaker.execute(async () => { throw new Error('fail'); });
    
    const result = await breaker.execute(async () => 'success');
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('CIRCUIT_OPEN');
  });

  test('transitions to HALF_OPEN after timeout', async () => {
    jest.useFakeTimers();
    
    const breaker = createCircuitBreaker({ 
      failureThreshold: 1,
      timeout: 1000,
    });

    await breaker.execute(async () => { throw new Error('fail'); });
    expect(breaker.getState().state).toBe('OPEN');

    jest.advanceTimersByTime(1500);
    breaker.shouldAttempt();
    
    expect(breaker.getState().state).toBe('HALF_OPEN');
    
    jest.useRealTimers();
  });

  test('closes after success threshold in HALF_OPEN', async () => {
    const breaker = createCircuitBreaker({ 
      failureThreshold: 1,
      successThreshold: 2,
      timeout: 0,
    });

    // Open the breaker
    await breaker.execute(async () => { throw new Error('fail'); });
    
    // Force to HALF_OPEN
    breaker.shouldAttempt();

    // Succeed twice
    await breaker.execute(async () => 'success');
    await breaker.execute(async () => 'success');

    expect(breaker.getState().state).toBe('CLOSED');
  });

  test('reset forces CLOSED state', async () => {
    const breaker = createCircuitBreaker({ failureThreshold: 1 });
    
    await breaker.execute(async () => { throw new Error('fail'); });
    expect(breaker.getState().state).toBe('OPEN');

    breaker.reset();
    expect(breaker.getState().state).toBe('CLOSED');
  });
});

// ============================================================================
// Unit Tests - Dead Letter Queue
// ============================================================================

describe('Dead Letter Queue', () => {
  const { createDeadLetterQueue } = require('../core/dead-letter-queue.js');

  beforeEach(() => {
    // Mock chrome.storage
    global.chrome = createMockChrome();
    chrome.storage.local.get.mockResolvedValue({});
    chrome.storage.local.set.mockResolvedValue();
  });

  test('enqueues entries', async () => {
    const dlq = createDeadLetterQueue({ persistToStorage: false });
    
    const entry = await dlq.enqueue({
      type: 'TEST_ERROR',
      payload: { data: 'test' },
      error: new Error('test error'),
      source: 'test',
    });

    expect(entry.id).toBeDefined();
    expect(entry.type).toBe('TEST_ERROR');
  });

  test('retrieves entries', async () => {
    const dlq = createDeadLetterQueue({ persistToStorage: false });
    
    await dlq.enqueue({
      type: 'ERROR_A',
      payload: {},
      error: 'error a',
      source: 'test',
    });
    
    await dlq.enqueue({
      type: 'ERROR_B',
      payload: {},
      error: 'error b',
      source: 'test',
    });

    const entries = await dlq.getEntries();
    expect(entries).toHaveLength(2);
  });

  test('filters entries by type', async () => {
    const dlq = createDeadLetterQueue({ persistToStorage: false });
    
    await dlq.enqueue({ type: 'A', payload: {}, error: '', source: 'test' });
    await dlq.enqueue({ type: 'B', payload: {}, error: '', source: 'test' });
    await dlq.enqueue({ type: 'A', payload: {}, error: '', source: 'test' });

    const filtered = await dlq.getEntries({ type: 'A' });
    expect(filtered).toHaveLength(2);
  });

  test('respects max entries limit', async () => {
    const dlq = createDeadLetterQueue({ 
      maxEntries: 3,
      persistToStorage: false,
    });

    for (let i = 0; i < 5; i++) {
      await dlq.enqueue({
        type: 'TEST',
        payload: { i },
        error: '',
        source: 'test',
      });
    }

    const entries = await dlq.getEntries();
    expect(entries.length).toBeLessThanOrEqual(3);
  });

  test('provides statistics', async () => {
    const dlq = createDeadLetterQueue({ persistToStorage: false });
    
    await dlq.enqueue({ type: 'A', payload: {}, error: '', source: 'src1', errorCode: 'CODE1' });
    await dlq.enqueue({ type: 'B', payload: {}, error: '', source: 'src2', errorCode: 'CODE1' });

    const stats = await dlq.getStats();
    expect(stats.total).toBe(2);
    expect(stats.byType.A).toBe(1);
    expect(stats.byType.B).toBe(1);
  });
});

// ============================================================================
// Unit Tests - Utilities
// ============================================================================

describe('Utility Functions', () => {
  const utils = require('../core/utils.js');

  describe('compose', () => {
    test('composes functions right to left', () => {
      const add1 = x => x + 1;
      const double = x => x * 2;
      const composed = utils.compose(add1, double);
      expect(composed(5)).toBe(11); // (5 * 2) + 1
    });
  });

  describe('pipe', () => {
    test('pipes functions left to right', () => {
      const add1 = x => x + 1;
      const double = x => x * 2;
      const piped = utils.pipe(add1, double);
      expect(piped(5)).toBe(12); // (5 + 1) * 2
    });
  });

  describe('curry', () => {
    test('curries multi-argument function', () => {
      const add = (a, b, c) => a + b + c;
      const curried = utils.curry(add);
      expect(curried(1)(2)(3)).toBe(6);
      expect(curried(1, 2)(3)).toBe(6);
      expect(curried(1)(2, 3)).toBe(6);
    });
  });

  describe('mapAsync', () => {
    test('maps with concurrency control', async () => {
      const items = [1, 2, 3, 4, 5];
      const results = await utils.mapAsync(items, async x => x * 2, 2);
      expect(results).toEqual([2, 4, 6, 8, 10]);
    });
  });

  describe('chunk', () => {
    test('chunks array into smaller arrays', () => {
      const chunks = utils.chunk([1, 2, 3, 4, 5], 2);
      expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
    });
  });

  describe('unique', () => {
    test('removes duplicate values', () => {
      expect(utils.unique([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
    });

    test('works with key function', () => {
      const items = [{ id: 1 }, { id: 2 }, { id: 1 }];
      expect(utils.unique(items, x => x.id)).toHaveLength(2);
    });
  });

  describe('sanitizeFilename', () => {
    test('removes invalid characters', () => {
      expect(utils.sanitizeFilename('file<>:"/\\|?*name')).toBe('file_________name');
    });

    test('replaces spaces with underscores', () => {
      expect(utils.sanitizeFilename('my file name')).toBe('my_file_name');
    });

    test('truncates long names', () => {
      const longName = 'a'.repeat(300);
      expect(utils.sanitizeFilename(longName).length).toBeLessThanOrEqual(200);
    });
  });

  describe('withTimeout', () => {
    test('resolves if within timeout', async () => {
      const promise = new Promise(r => setTimeout(() => r('done'), 50));
      const result = await utils.withTimeout(promise, 100);
      expect(result).toBe('done');
    });

    test('rejects if timeout exceeded', async () => {
      const promise = new Promise(r => setTimeout(() => r('done'), 200));
      await expect(utils.withTimeout(promise, 50)).rejects.toThrow('timed out');
    });
  });

  describe('deepClone', () => {
    test('creates independent copy', () => {
      const original = { a: { b: 1 } };
      const clone = utils.deepClone(original);
      clone.a.b = 2;
      expect(original.a.b).toBe(1);
    });
  });
});

// ============================================================================
// Integration Tests - HTML Processor
// ============================================================================

describe('HTML Processor', () => {
  const { 
    extractCssUrls, 
    extractHtmlUrls, 
    inlineCssUrls,
    ensureBaseTag,
  } = require('../core/html-processor.js');

  describe('extractCssUrls', () => {
    test('extracts url() references', () => {
      const css = `
        .bg { background: url('image.png'); }
        .icon { background-image: url("sprite.svg"); }
      `;
      const urls = extractCssUrls(css, 'https://example.com/styles/');
      expect(urls).toContain('https://example.com/styles/image.png');
      expect(urls).toContain('https://example.com/styles/sprite.svg');
    });

    test('extracts @import statements', () => {
      const css = `@import url('reset.css'); @import "theme.css";`;
      const urls = extractCssUrls(css, 'https://example.com/css/');
      expect(urls).toContain('https://example.com/css/reset.css');
      expect(urls).toContain('https://example.com/css/theme.css');
    });

    test('ignores data URIs', () => {
      const css = `.icon { background: url('data:image/png;base64,abc'); }`;
      const urls = extractCssUrls(css, 'https://example.com/');
      expect(urls).toHaveLength(0);
    });
  });

  describe('extractHtmlUrls', () => {
    test('extracts stylesheet links', () => {
      const html = `<link rel="stylesheet" href="/styles/main.css">`;
      const config = { excludePatterns: [] };
      const urls = extractHtmlUrls(html, 'https://example.com/', config);
      expect(urls.stylesheets).toContain('https://example.com/styles/main.css');
    });

    test('extracts image sources', () => {
      const html = `<img src="image.jpg"><img src="photo.png">`;
      const config = { excludePatterns: [] };
      const urls = extractHtmlUrls(html, 'https://example.com/', config);
      expect(urls.images).toHaveLength(2);
    });

    test('extracts script sources', () => {
      const html = `<script src="app.js"></script>`;
      const config = { excludePatterns: [], includeScripts: true };
      const urls = extractHtmlUrls(html, 'https://example.com/', config);
      expect(urls.scripts).toContain('https://example.com/app.js');
    });

    test('respects exclude patterns', () => {
      const html = `
        <img src="image.jpg">
        <img src="analytics/tracker.gif">
      `;
      const config = { excludePatterns: ['*analytics*'] };
      const urls = extractHtmlUrls(html, 'https://example.com/', config);
      expect(urls.images).toHaveLength(1);
    });
  });

  describe('ensureBaseTag', () => {
    test('adds base tag if not present', () => {
      const html = '<html><head></head><body></body></html>';
      const result = ensureBaseTag(html, 'https://example.com/');
      expect(result).toContain('<base href="https://example.com/">');
    });

    test('preserves existing base tag', () => {
      const html = '<html><head><base href="https://other.com/"></head></html>';
      const result = ensureBaseTag(html, 'https://example.com/');
      expect(result).toContain('https://other.com/');
      expect(result).not.toContain('https://example.com/');
    });
  });
});

// ============================================================================
// Integration Tests - Exporters
// ============================================================================

describe('Exporters', () => {
  const { getExporter, getExporterOptions } = require('../exporters/index.js');

  test('all exporters are registered', () => {
    const options = getExporterOptions();
    const formats = options.map(o => o.value);
    expect(formats).toContain('html');
    expect(formats).toContain('mhtml');
    expect(formats).toContain('zip');
    expect(formats).toContain('pdf');
  });

  describe('HTML Exporter', () => {
    test('exports valid HTML blob', async () => {
      const exporter = getExporter('html');
      const pageData = {
        url: 'https://example.com/',
        title: 'Test Page',
        html: '<html><body>Test</body></html>',
        capturedAt: Date.now(),
      };

      const result = await exporter.export(pageData);
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.blob.type).toBe('text/html;charset=utf-8');
      expect(result.filename).toMatch(/\.html$/);
    });
  });

  describe('ZIP Exporter', () => {
    test('exports valid ZIP blob', async () => {
      const exporter = getExporter('zip');
      const pageData = {
        url: 'https://example.com/',
        title: 'Test Page',
        html: '<html><body>Test</body></html>',
        resources: new Map(),
        capturedAt: Date.now(),
      };

      const result = await exporter.export(pageData);
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.blob.type).toBe('application/zip');
      expect(result.filename).toMatch(/\.zip$/);
    });
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
  test('handles empty HTML', async () => {
    const { processHtml } = require('../core/html-processor.js');
    const config = { excludePatterns: [], resourceTimeout: 1000, maxResourceSize: 1000000 };
    const result = await processHtml('', 'https://example.com/', config);
    expect(result.ok).toBe(true);
  });

  test('handles malformed URLs gracefully', () => {
    const { resolveUrl } = require('../core/resource-fetcher.js');
    expect(resolveUrl('not a url', 'also not a url')).toBe('not a url');
  });

  test('handles circular CSS imports', async () => {
    // Would need proper mock setup for this test
    // The circuit breaker should prevent infinite loops
  });

  test('handles very large content', async () => {
    const { computeChecksum } = require('../core/memoize.js');
    const largeContent = 'x'.repeat(10 * 1024 * 1024); // 10MB
    const hash = await computeChecksum(largeContent);
    expect(hash).toHaveLength(64);
  });
});

// ============================================================================
// Idempotency Tests
// ============================================================================

describe('Idempotency', () => {
  test('checksum is consistent across invocations', async () => {
    const { computeChecksum } = require('../core/memoize.js');
    const content = '<html><body>Test content</body></html>';
    
    const hash1 = await computeChecksum(content);
    const hash2 = await computeChecksum(content);
    const hash3 = await computeChecksum(content);

    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });

  test('HTML processing is deterministic', async () => {
    const { processHtml } = require('../core/html-processor.js');
    const html = '<html><head></head><body><p>Test</p></body></html>';
    const config = { 
      excludePatterns: [], 
      resourceTimeout: 1000, 
      maxResourceSize: 1000000,
      includeScripts: true,
      includeStyles: true,
    };

    const result1 = await processHtml(html, 'https://example.com/', config);
    const result2 = await processHtml(html, 'https://example.com/', config);

    // Results should be structurally identical (excluding timestamps)
    expect(result1.ok).toBe(result2.ok);
    expect(result1.value.stats).toEqual(result2.value.stats);
  });
});

// ============================================================================
// Export for Jest
// ============================================================================

module.exports = {};
