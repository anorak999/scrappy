/**
 * Dead Letter Queue Implementation
 * 
 * Handles unprocessable tasks for analysis and recovery.
 * Implements fail-safe error logging and retry mechanisms.
 * 
 * @fileoverview DLQ with persistence and analysis capabilities
 * @author anoraK
 */

/**
 * @typedef {Object} DeadLetterEntry
 * @property {string} id - Unique entry ID
 * @property {string} type - Error type/category
 * @property {any} payload - Original payload that failed
 * @property {string} error - Error message
 * @property {string} errorCode - Machine-readable error code
 * @property {string} source - Source of the error
 * @property {number} timestamp - When the error occurred
 * @property {number} retryCount - Number of retry attempts
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * @typedef {Object} DLQOptions
 * @property {number} [maxEntries=1000] - Maximum entries to keep
 * @property {number} [retentionPeriod=86400000] - How long to keep entries (default: 24h)
 * @property {boolean} [persistToStorage=true] - Persist to chrome.storage
 * @property {Function} [onEntry] - Callback when entry is added
 */

/**
 * Creates a Dead Letter Queue instance
 * 
 * @param {DLQOptions} options
 * @returns {Object} DLQ instance
 */
export const createDeadLetterQueue = (options = {}) => {
  const {
    maxEntries = 1000,
    retentionPeriod = 24 * 60 * 60 * 1000,
    persistToStorage = true,
    onEntry = () => {},
  } = options;

  let entries = [];
  let initialized = false;

  const generateId = () => 
    `dlq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const cleanExpired = () => {
    const cutoff = Date.now() - retentionPeriod;
    entries = entries.filter(e => e.timestamp > cutoff);
  };

  const enforceMaxSize = () => {
    if (entries.length > maxEntries) {
      // Keep most recent entries
      entries = entries
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, maxEntries);
    }
  };

  const persist = async () => {
    if (!persistToStorage) return;
    
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.set({ scrappy_dlq: entries });
      }
    } catch (e) {
      console.error('[DLQ] Failed to persist:', e);
    }
  };

  const load = async () => {
    if (!persistToStorage || initialized) return;
    
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get('scrappy_dlq');
        if (result.scrappy_dlq && Array.isArray(result.scrappy_dlq)) {
          entries = result.scrappy_dlq;
          cleanExpired();
        }
      }
      initialized = true;
    } catch (e) {
      console.error('[DLQ] Failed to load:', e);
      initialized = true;
    }
  };

  /**
   * Adds an entry to the DLQ
   * @param {Object} params
   * @returns {DeadLetterEntry}
   */
  const enqueue = async ({
    type,
    payload,
    error,
    errorCode,
    source,
    metadata = {},
  }) => {
    await load();

    const entry = Object.freeze({
      id: generateId(),
      type,
      payload,
      error: error instanceof Error ? error.message : String(error),
      errorCode: errorCode || 'UNKNOWN_ERROR',
      source,
      timestamp: Date.now(),
      retryCount: 0,
      metadata: Object.freeze(metadata),
    });

    entries.push(entry);
    cleanExpired();
    enforceMaxSize();
    
    await persist();
    onEntry(entry);

    console.warn('[DLQ] Entry added:', entry.id, entry.type, entry.error);
    
    return entry;
  };

  /**
   * Gets all entries, optionally filtered
   * @param {Object} [filter]
   * @returns {DeadLetterEntry[]}
   */
  const getEntries = async (filter = {}) => {
    await load();
    cleanExpired();

    let result = [...entries];

    if (filter.type) {
      result = result.filter(e => e.type === filter.type);
    }
    if (filter.errorCode) {
      result = result.filter(e => e.errorCode === filter.errorCode);
    }
    if (filter.source) {
      result = result.filter(e => e.source === filter.source);
    }
    if (filter.since) {
      result = result.filter(e => e.timestamp >= filter.since);
    }

    return result.sort((a, b) => b.timestamp - a.timestamp);
  };

  /**
   * Gets entry by ID
   * @param {string} id
   * @returns {DeadLetterEntry | null}
   */
  const getEntry = async (id) => {
    await load();
    return entries.find(e => e.id === id) || null;
  };

  /**
   * Removes an entry
   * @param {string} id
   * @returns {boolean}
   */
  const remove = async (id) => {
    await load();
    const initialLength = entries.length;
    entries = entries.filter(e => e.id !== id);
    
    if (entries.length < initialLength) {
      await persist();
      return true;
    }
    return false;
  };

  /**
   * Marks entry as retried, incrementing retry count
   * @param {string} id
   * @returns {DeadLetterEntry | null}
   */
  const markRetried = async (id) => {
    await load();
    const index = entries.findIndex(e => e.id === id);
    
    if (index === -1) return null;

    const updatedEntry = {
      ...entries[index],
      retryCount: entries[index].retryCount + 1,
      lastRetry: Date.now(),
    };

    entries[index] = Object.freeze(updatedEntry);
    await persist();
    
    return updatedEntry;
  };

  /**
   * Clears all entries
   */
  const clear = async () => {
    entries = [];
    await persist();
  };

  /**
   * Gets statistics
   * @returns {Object}
   */
  const getStats = async () => {
    await load();
    cleanExpired();

    const byType = {};
    const byErrorCode = {};
    const bySource = {};

    for (const entry of entries) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      byErrorCode[entry.errorCode] = (byErrorCode[entry.errorCode] || 0) + 1;
      bySource[entry.source] = (bySource[entry.source] || 0) + 1;
    }

    return {
      total: entries.length,
      byType,
      byErrorCode,
      bySource,
      oldestEntry: entries.length > 0 
        ? Math.min(...entries.map(e => e.timestamp))
        : null,
      newestEntry: entries.length > 0
        ? Math.max(...entries.map(e => e.timestamp))
        : null,
    };
  };

  /**
   * Exports entries for analysis
   * @returns {string} JSON string
   */
  const exportEntries = async () => {
    await load();
    return JSON.stringify(entries, null, 2);
  };

  return Object.freeze({
    enqueue,
    getEntries,
    getEntry,
    remove,
    markRetried,
    clear,
    getStats,
    exportEntries,
  });
};

// Singleton DLQ instance for the extension
let dlqInstance = null;

/**
 * Gets or creates the singleton DLQ instance
 * @returns {Object} DLQ instance
 */
export const getDLQ = () => {
  if (!dlqInstance) {
    dlqInstance = createDeadLetterQueue({
      maxEntries: 500,
      retentionPeriod: 7 * 24 * 60 * 60 * 1000, // 7 days
      onEntry: (entry) => {
        // Could trigger notification for critical errors
        if (entry.errorCode === 'PERMISSION_DENIED') {
          console.error('[DLQ] Critical error logged:', entry.id);
        }
      },
    });
  }
  return dlqInstance;
};
