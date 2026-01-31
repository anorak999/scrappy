/**
 * Scrappy Service Worker
 * 
 * Main background script orchestrating scraping operations.
 * Implements message-based communication with popup and content scripts.
 * 
 * @fileoverview Service worker with hexagonal architecture
 * @author anoraK
 */

import { 
  Ok, 
  Err, 
  ErrorCodes, 
  MessageTypes, 
  createDefaultConfig,
  createPageData,
  tryCatchAsync,
} from '../core/types.js';
import { processHtml } from '../core/html-processor.js';
import { getDLQ } from '../core/dead-letter-queue.js';
import { getCacheStats, resetAll as resetResourceCache } from '../core/resource-fetcher.js';
import { getExporter, getExporterOptions } from '../exporters/index.js';
import { computeChecksum } from '../core/memoize.js';
import { sanitizeFilename, generateTimestamp, extractDomain } from '../core/utils.js';

// ============================================================================
// State Management (SSOT)
// ============================================================================

/**
 * @typedef {Object} ScrapeJob
 * @property {string} id
 * @property {number} tabId
 * @property {string} status - 'pending' | 'running' | 'complete' | 'failed'
 * @property {number} startedAt
 * @property {number} [completedAt]
 * @property {Object} [result]
 * @property {Object} [error]
 * @property {Object} progress
 */

// Active scrape jobs (in-memory SSOT)
const activeJobs = new Map();

// Job counter for unique IDs
let jobCounter = 0;

/**
 * Creates a new job ID
 * @returns {string}
 */
const createJobId = () => `job_${Date.now()}_${++jobCounter}`;

/**
 * Creates a new scrape job
 * @param {number} tabId
 * @returns {ScrapeJob}
 */
const createJob = (tabId) => {
  const job = Object.freeze({
    id: createJobId(),
    tabId,
    status: 'pending',
    startedAt: Date.now(),
    progress: { stage: 'initializing', percent: 0 },
  });
  activeJobs.set(job.id, job);
  return job;
};

/**
 * Updates a job (immutable update)
 * @param {string} jobId
 * @param {Partial<ScrapeJob>} updates
 * @returns {ScrapeJob}
 */
const updateJob = (jobId, updates) => {
  const existing = activeJobs.get(jobId);
  if (!existing) return null;
  
  const updated = Object.freeze({ ...existing, ...updates });
  activeJobs.set(jobId, updated);
  return updated;
};

/**
 * Gets job by ID
 * @param {string} jobId
 * @returns {ScrapeJob | null}
 */
const getJob = (jobId) => activeJobs.get(jobId) || null;

/**
 * Cleans up old jobs
 */
const cleanupJobs = () => {
  const maxAge = 30 * 60 * 1000; // 30 minutes
  const now = Date.now();
  
  for (const [id, job] of activeJobs.entries()) {
    if (now - job.startedAt > maxAge) {
      activeJobs.delete(id);
    }
  }
};

// Periodic cleanup
setInterval(cleanupJobs, 5 * 60 * 1000);

// ============================================================================
// Settings Management
// ============================================================================

const SETTINGS_KEY = 'scrappy_settings';

/**
 * Gets user settings
 * @returns {Promise<Object>}
 */
const getSettings = async () => {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return result[SETTINGS_KEY] || createDefaultConfig();
};

/**
 * Saves user settings
 * @param {Object} settings
 * @returns {Promise<void>}
 */
const saveSettings = async (settings) => {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
};

// ============================================================================
// Content Script Communication
// ============================================================================

/**
 * Gets page content from content script
 * @param {number} tabId
 * @returns {Promise<Result<Object, Error>>}
 */
const getPageContent = async (tabId) => {
  return tryCatchAsync(async () => {
    // Ensure content script is injected
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content-script.js'],
    });

    // Small delay to ensure script is ready
    await new Promise(resolve => setTimeout(resolve, 100));

    // Request page content
    const response = await chrome.tabs.sendMessage(tabId, {
      type: MessageTypes.GET_PAGE_CONTENT,
    });

    if (!response || response.error) {
      throw new Error(response?.error || 'Failed to get page content');
    }

    return response.data;
  }, ErrorCodes.TAB_ACCESS_DENIED);
};

// ============================================================================
// Scraping Pipeline
// ============================================================================

/**
 * Performs the scrape operation
 * Pure orchestration function
 * 
 * @param {number} tabId
 * @param {Object} config
 * @param {Function} onProgress
 * @returns {Promise<Result<Object, Error>>}
 */
const performScrape = async (tabId, config, onProgress) => {
  // Get page content from content script
  onProgress({ stage: 'capturing', percent: 5 });
  
  const contentResult = await getPageContent(tabId);
  if (!contentResult.ok) {
    return contentResult;
  }

  const { html, url, title, metadata } = contentResult.value;

  // Process HTML and inline resources
  onProgress({ stage: 'processing', percent: 10 });
  
  const processResult = await processHtml(html, url, config, (p) => {
    onProgress({ 
      stage: p.stage, 
      percent: 10 + Math.floor(p.percent * 0.7) 
    });
  });

  if (!processResult.ok) {
    return processResult;
  }

  // Compute checksum for idempotency
  const checksum = await computeChecksum(processResult.value.html);

  // Create page data object (immutable)
  const pageData = createPageData({
    url,
    title,
    html: processResult.value.html,
    resources: processResult.value.resources,
    metadata: {
      ...metadata,
      stats: processResult.value.stats,
    },
    capturedAt: Date.now(),
    checksum,
  });

  onProgress({ stage: 'complete', percent: 100 });

  return Ok(pageData);
};

/**
 * Exports scraped data to the specified format
 * 
 * @param {Object} pageData
 * @param {string} format
 * @param {number} tabId
 * @returns {Promise<Result<Object, Error>>}
 */
const exportData = async (pageData, format, tabId) => {
  const exporter = getExporter(format);
  
  if (!exporter) {
    return Err(
      new Error(`Unknown format: ${format}`),
      ErrorCodes.INVALID_FORMAT
    );
  }

  return tryCatchAsync(async () => {
    const result = await exporter.export(pageData, { tabId });
    return result;
  }, ErrorCodes.SERIALIZATION_FAILED);
};

/**
 * Downloads the exported file
 * 
 * @param {Blob} blob
 * @param {string} filename
 * @returns {Promise<Result<number, Error>>}
 */
const downloadFile = async (blob, filename) => {
  return tryCatchAsync(async () => {
    // Convert Blob to Data URL (base64) since URL.createObjectURL is not available in Service Workers
    const reader = new FileReader();
    const dataUrl = await new Promise((resolve, reject) => {
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read blob'));
      reader.readAsDataURL(blob);
    });

    // Trigger download
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: true,
    });

    return downloadId;
  }, ErrorCodes.PERMISSION_DENIED);
};

// ============================================================================
// Main Scrape Handler
// ============================================================================

/**
 * Handles scrape request from popup
 * Main entry point for scraping operation
 * 
 * @param {Object} request
 * @param {chrome.runtime.MessageSender} sender
 * @returns {Promise<Object>}
 */
const handleScrapeRequest = async (request, sender) => {
  const { tabId, format = 'html' } = request;
  
  // Validate tab
  if (!tabId) {
    return { 
      ok: false, 
      error: 'No tab specified', 
      errorCode: ErrorCodes.VALIDATION_ERROR 
    };
  }

  // Create job
  const job = createJob(tabId);

  // Update job status
  updateJob(job.id, { status: 'running' });

  // Progress callback
  const onProgress = (progress) => {
    updateJob(job.id, { progress });
    
    // Send progress to popup
    chrome.runtime.sendMessage({
      type: MessageTypes.SCRAPE_PROGRESS,
      jobId: job.id,
      progress,
    }).catch(() => {}); // Ignore errors if popup is closed
  };

  try {
    // Get settings
    const settings = await getSettings();
    const config = { ...createDefaultConfig(), ...settings, format };

    // Perform scrape
    const scrapeResult = await performScrape(tabId, config, onProgress);
    
    if (!scrapeResult.ok) {
      throw scrapeResult.error || new Error('Scrape failed');
    }

    const pageData = scrapeResult.value;

    // Export to format
    const exportResult = await exportData(pageData, format, tabId);
    
    if (!exportResult.ok) {
      throw exportResult.error || new Error('Export failed');
    }

    const { blob, filename } = exportResult.value;

    // Download file
    const downloadResult = await downloadFile(blob, filename);
    
    if (!downloadResult.ok) {
      throw downloadResult.error || new Error('Download failed');
    }

    // Success
    const result = {
      downloadId: downloadResult.value,
      filename,
      size: blob.size,
      format,
      stats: pageData.metadata.stats,
      checksum: pageData.checksum,
      duration: Date.now() - job.startedAt,
    };

    updateJob(job.id, { 
      status: 'complete', 
      completedAt: Date.now(),
      result,
    });

    // Send notification (fail-safe)
    try {
      // Icon URL must be from the extension package
      const iconUrl = 'assets/icons/icon128.png';
      
      chrome.notifications.create({
        type: 'basic',
        iconUrl: iconUrl,
        title: 'Scrappy - Capture Complete',
        message: `Saved: ${filename}`,
        priority: 0,
      });
    } catch (e) {
      console.warn('Failed to send notification:', e);
    }

    return { ok: true, jobId: job.id, result };

  } catch (error) {
    const errorMessage = error.message || String(error);
    
    // Log to DLQ
    const dlq = getDLQ();
    await dlq.enqueue({
      type: 'SCRAPE_FAILURE',
      payload: { tabId, format, jobId: job.id },
      error: error,
      errorCode: error.errorCode || ErrorCodes.UNKNOWN_ERROR,
      source: 'handleScrapeRequest',
    });

    updateJob(job.id, { 
      status: 'failed', 
      completedAt: Date.now(),
      error: { message: errorMessage, code: error.errorCode },
    });

    return { 
      ok: false, 
      jobId: job.id,
      error: errorMessage, 
      errorCode: error.errorCode || ErrorCodes.UNKNOWN_ERROR,
    };
  }
};

// ============================================================================
// Message Handlers
// ============================================================================

/**
 * Message router
 */
const messageHandlers = {
  [MessageTypes.START_SCRAPE]: handleScrapeRequest,

  [MessageTypes.GET_SETTINGS]: async () => {
    const settings = await getSettings();
    return { ok: true, settings };
  },

  [MessageTypes.SAVE_SETTINGS]: async (request) => {
    await saveSettings(request.settings);
    return { ok: true };
  },

  [MessageTypes.GET_STATUS]: async (request) => {
    const { jobId } = request;
    
    if (jobId) {
      const job = getJob(jobId);
      return { ok: true, job };
    }

    return {
      ok: true,
      activeJobs: [...activeJobs.values()],
      cacheStats: getCacheStats(),
      exporters: getExporterOptions(),
    };
  },
};

// ============================================================================
// Event Listeners
// ============================================================================

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = messageHandlers[request.type];
  
  if (handler) {
    handler(request, sender)
      .then(sendResponse)
      .catch((error) => {
        console.error('[ServiceWorker] Handler error:', error);
        sendResponse({ 
          ok: false, 
          error: error.message,
          errorCode: ErrorCodes.UNKNOWN_ERROR,
        });
      });
    
    return true; // Keep channel open for async response
  }

  return false;
});

// Installation handler
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Scrappy] Extension installed');
    
    // Set default settings
    saveSettings(createDefaultConfig());

    // Open welcome page (optional)
    // chrome.tabs.create({ url: 'welcome.html' });
  } else if (details.reason === 'update') {
    console.log('[Scrappy] Extension updated to', chrome.runtime.getManifest().version);
  }
});

// Startup handler
chrome.runtime.onStartup.addListener(() => {
  console.log('[Scrappy] Extension started');
  
  // Clean up any stale data
  resetResourceCache();
});

// Action click handler (for direct scrape without popup)
chrome.action.onClicked.addListener(async (tab) => {
  // This only fires if popup is not set
  // Currently popup is set, so this won't fire
  // Left here for potential keyboard shortcut support
});

console.log('[Scrappy] Service worker initialized');
