# Scrappy Architecture Documentation

## Overview

Scrappy is a Chrome extension built using **Hexagonal Architecture** (Ports and Adapters) combined with **Functional Programming** principles. This document provides a detailed technical overview of the system design.

## Design Philosophy

### Core Principles

1. **Single Source of Truth (SSOT)**: All page data flows through a single `PageData` object
2. **Separation of Concerns (SoC)**: UI, business logic, and I/O are completely decoupled
3. **Immutability**: All data structures are frozen after creation
4. **Pure Functions**: Core processing has no side effects
5. **Fail-Fast**: Validate inputs early, fail immediately on errors

### Why Hexagonal Architecture?

The hexagonal architecture isolates our core domain logic from external concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                        ADAPTERS (UI)                        │
│                     Popup, Notifications                    │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                          PORTS                              │
│              Message API, Chrome APIs                       │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     CORE DOMAIN                             │
│      HTML Processing, Resource Fetching, Checksums          │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                          PORTS                              │
│              Exporter Interface, Storage API                │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     ADAPTERS (Output)                       │
│           HTML, MHTML, ZIP, PDF Exporters                   │
└─────────────────────────────────────────────────────────────┘
```

**Benefits:**
- Core logic is testable without Chrome APIs
- Exporters can be added/modified independently
- UI can change without affecting business logic
- Easy to mock dependencies for testing

## Data Flow

### Scrape Request Flow

```
┌─────────┐    ┌─────────────┐    ┌──────────────────┐    ┌───────────┐
│  User   │───▶│   Popup     │───▶│  Service Worker  │───▶│  Content  │
│  Click  │    │  (popup.js) │    │ (service-worker) │    │  Script   │
└─────────┘    └─────────────┘    └──────────────────┘    └───────────┘
                                           │                     │
                                           │◀────────────────────┘
                                           │   HTML + Metadata
                                           ▼
                                  ┌──────────────────┐
                                  │  HTML Processor  │
                                  │  - Extract URLs  │
                                  │  - Fetch assets  │
                                  │  - Inline CSS    │
                                  └────────┬─────────┘
                                           │
                                           ▼
                                  ┌──────────────────┐
                                  │    Exporter      │
                                  │  (Format-specific)│
                                  └────────┬─────────┘
                                           │
                                           ▼
                                  ┌──────────────────┐
                                  │   Downloads API  │
                                  │  (Save file)     │
                                  └──────────────────┘
```

### Message Types

| Message | Direction | Purpose |
|---------|-----------|---------|
| `START_SCRAPE` | Popup → Service Worker | Initiate capture |
| `SCRAPE_PROGRESS` | Service Worker → Popup | Progress updates |
| `GET_PAGE_CONTENT` | Service Worker → Content Script | Request DOM |
| `PAGE_CONTENT_RESPONSE` | Content Script → Service Worker | Return DOM |
| `GET_SETTINGS` | Popup → Service Worker | Load preferences |
| `SAVE_SETTINGS` | Popup → Service Worker | Save preferences |

## Component Details

### Core Types (`core/types.js`)

#### Result Monad

The `Result<T, E>` type provides type-safe error handling without exceptions:

```javascript
// Success case
const success = Ok(42);
success.ok;        // true
success.value;     // 42
success.map(x => x * 2);  // Ok(84)

// Error case
const failure = Err(new Error('oops'), 'ERROR_CODE');
failure.ok;        // false
failure.error;     // Error('oops')
failure.map(x => x * 2);  // Err (unchanged)

// Chaining
Ok(5)
  .flatMap(x => x > 0 ? Ok(x) : Err('negative'))
  .map(x => x * 2)
  .match({
    ok: value => console.log('Success:', value),
    err: error => console.log('Error:', error),
  });
```

#### Option Type

The `Option<T>` type eliminates null checks:

```javascript
const some = Some(42);
const none = None();

fromNullable(null);      // None()
fromNullable(undefined); // None()
fromNullable(42);        // Some(42)

some.unwrapOr(0);  // 42
none.unwrapOr(0);  // 0
```

### Circuit Breaker (`core/circuit-breaker.js`)

Protects against cascading failures when fetching resources:

```
     ┌──────────────────────────────────────────────────┐
     │                  STATE DIAGRAM                   │
     └──────────────────────────────────────────────────┘

            failure threshold
                reached
     ┌────────┐         ┌────────┐
     │ CLOSED │────────▶│  OPEN  │
     │(normal)│         │(reject)│
     └────────┘         └────────┘
          ▲                  │
          │                  │ timeout
          │                  │ expired
          │                  ▼
          │            ┌───────────┐
          └────────────│ HALF_OPEN │
           success     │  (probe)  │
           threshold   └───────────┘
           reached           │
                            │ failure
                            │
                            ▼
                      Back to OPEN
```

**Configuration:**
- `failureThreshold`: Failures before opening (default: 5)
- `successThreshold`: Successes to close from half-open (default: 3)
- `timeout`: Time in open state before probing (default: 30s)
- `monitorWindow`: Window for counting failures (default: 60s)

### Memoization (`core/memoize.js`)

Provides intelligent caching with:

- **LRU Eviction**: Removes least-recently-used entries
- **TTL Expiration**: Entries expire after a time period
- **Request Deduplication**: Concurrent calls for same key share one request

```javascript
const memoizedFetch = memoizeAsync(fetch, {
  maxSize: 100,      // Max cached entries
  ttl: 5 * 60 * 1000, // 5 minute TTL
  keyGenerator: url => new URL(url).href, // Normalize URLs
});
```

### Dead Letter Queue (`core/dead-letter-queue.js`)

Captures failed operations for debugging:

```javascript
// Enqueue an error
await dlq.enqueue({
  type: 'RESOURCE_FETCH_FAILURE',
  payload: { url: 'https://example.com/image.png' },
  error: new Error('CORS blocked'),
  errorCode: 'CORS_BLOCKED',
  source: 'fetchResource',
  metadata: { domain: 'example.com' },
});

// Retrieve entries
const errors = await dlq.getEntries({ type: 'RESOURCE_FETCH_FAILURE' });

// Get statistics
const stats = await dlq.getStats();
// { total: 5, byType: {...}, byErrorCode: {...}, ... }
```

### HTML Processor (`core/html-processor.js`)

Orchestrates the HTML processing pipeline:

```
Input HTML
    │
    ▼
┌───────────────────┐
│  extractHtmlUrls  │ ─── Find stylesheets, scripts, images
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  fetchResources   │ ─── Parallel fetch with circuit breaker
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  extractCssUrls   │ ─── Find URLs within CSS
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  fetchResources   │ ─── Fetch CSS-referenced resources
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ inlineHtmlResources│ ─── Replace URLs with data URIs
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  inlineCssUrls    │ ─── Inline CSS url() references
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  addMetadata      │ ─── Add capture metadata
└─────────┬─────────┘
          │
          ▼
Output HTML (self-contained)
```

### Exporters

Each exporter implements the `ExporterInterface`:

```javascript
interface ExporterInterface {
  format: string;        // 'html', 'mhtml', 'zip', 'pdf'
  extension: string;     // '.html', '.mhtml', '.zip', '.pdf'
  mimeType: string;      // MIME type for the blob
  label: string;         // Human-readable name
  description: string;   // Format description
  
  export(pageData: PageData, options?: Object): Promise<ExportResult>;
}

interface ExportResult {
  blob: Blob;
  filename: string;
  mimeType: string;
  size: number;
}
```

**Adding a new exporter:**

1. Create file in `exporters/`
2. Implement `ExporterInterface`
3. Call `registerExporter()`
4. Import in `exporters/index.js`

## Error Handling Strategy

### Error Categories

| Code | Category | Recovery |
|------|----------|----------|
| `NETWORK_FAILURE` | Network | Retry with backoff |
| `FETCH_TIMEOUT` | Network | Skip or retry |
| `CORS_BLOCKED` | Network | Log and skip |
| `PERMISSION_DENIED` | Permission | Show user message |
| `CIRCUIT_OPEN` | Protection | Wait and retry |
| `RESOURCE_TOO_LARGE` | Validation | Skip resource |
| `SERIALIZATION_FAILED` | Processing | Fail gracefully |

### Error Flow

```
Error occurs
    │
    ▼
┌───────────────────┐
│   Create Result   │ ─── Err(error, code, context)
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  Log to DLQ       │ ─── For debugging
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Update Circuit    │ ─── Track failures
│ Breaker           │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Continue or Abort │ ─── Based on error type
└───────────────────┘
```

## Performance Optimizations

### Caching Layers

1. **Resource Cache**: Fetched resources cached by URL
2. **Checksum Cache**: Computed hashes cached
3. **Chrome Storage**: Settings and DLQ entries persisted

### Concurrency Control

- Resource fetching limited to 5 concurrent requests
- Request deduplication prevents duplicate fetches
- Circuit breakers prevent hammering failed endpoints

### Memory Management

- Resources processed in streams where possible
- Large resources skipped based on `maxResourceSize`
- Caches implement LRU eviction

## Security Considerations

### Permissions

| Permission | Scope | Justification |
|------------|-------|---------------|
| `activeTab` | Current tab only | Capture current page |
| `scripting` | Inject to active tab | DOM serialization |
| `storage` | Extension only | User preferences |
| `downloads` | User initiated | Save files |
| `<all_urls>` | Any URL | Fetch resources |

### Content Security

- Scripts in captured pages are commented out
- No user input is executed as code
- External resources fetched with `credentials: 'omit'`

### Privacy

- No data sent to external servers
- All processing happens locally
- Settings stored in user's sync storage

## Testing Strategy

### Unit Tests

Test pure functions in isolation:
- Result monad operations
- Memoization caching
- URL extraction
- String utilities

### Integration Tests

Test component interactions:
- HTML processing pipeline
- Exporter outputs
- Circuit breaker behavior

### End-to-End Tests

Manual testing checklist:
- Capture various page types
- All export formats
- Error scenarios
- Offline verification

## Future Enhancements

### Planned Features

1. **Batch Capture**: Save multiple tabs at once
2. **Scheduled Capture**: Automatic periodic captures
3. **Custom Selectors**: Capture specific page sections
4. **Cloud Sync**: Sync settings across devices

### Architecture Extensions

1. **Plugin System**: Allow third-party exporters
2. **Worker Threads**: Offload processing to workers
3. **Streaming Export**: Stream large files to disk
4. **IndexedDB Storage**: Store captures locally

---

*This document is part of the Scrappy project. For usage instructions, see [README.md](README.md).*
