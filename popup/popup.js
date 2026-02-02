/**
 * Scrappy Popup Script
 * 
 * Handles user interactions and communicates with service worker.
 * Implements reactive UI updates with declarative patterns.
 * 
 * @fileoverview Popup JavaScript with functional approach
 * @author anoraK
 */

// ============================================================================
// Constants
// ============================================================================

const MessageTypes = {
  START_SCRAPE: 'START_SCRAPE',
  SCRAPE_PROGRESS: 'SCRAPE_PROGRESS',
  SCRAPE_COMPLETE: 'SCRAPE_COMPLETE',
  SCRAPE_ERROR: 'SCRAPE_ERROR',
  GET_SETTINGS: 'GET_SETTINGS',
  SAVE_SETTINGS: 'SAVE_SETTINGS',
  GET_STATUS: 'GET_STATUS',
  GET_PAGE_STATS: 'GET_PAGE_STATS',
};

const DEFAULT_SETTINGS = {
  format: 'html',
  inlineResources: true,
  includeScripts: true,
  includeStyles: true,
  removeTracking: false,
  preserveForms: false,
  resourceTimeout: 10000,
  maxResourceSize: 5 * 1024 * 1024,
};

const DEFAULT_OPTIONS = {
  lazyload: true,
  cleanups: true,
  minify: false,
};

// ============================================================================
// State Management (Immutable)
// ============================================================================

let state = {
  currentTab: null,
  selectedFormat: 'html',
  isCapturing: false,
  settings: { ...DEFAULT_SETTINGS },
  options: { ...DEFAULT_OPTIONS },
  showSettings: false,
  showHistory: false,
  currentJobId: null,
  pageStats: null,
  history: [],
  lastResult: null,
};

/**
 * Updates state immutably
 * @param {Partial<typeof state>} updates
 */
const updateState = (updates) => {
  state = Object.freeze({ ...state, ...updates });
  render();
};

// ============================================================================
// DOM References
// ============================================================================

const elements = {
  // Page info
  pageTitle: document.getElementById('page-title'),
  pageUrl: document.getElementById('page-url'),
  resourceStats: document.getElementById('resource-stats'),
  statImages: document.getElementById('stat-images'),
  statStyles: document.getElementById('stat-styles'),
  statScripts: document.getElementById('stat-scripts'),
  statFonts: document.getElementById('stat-fonts'),
  
  // Metadata
  pageMetadata: document.getElementById('page-metadata'),
  metaDescription: document.getElementById('meta-description'),
  metaTags: document.getElementById('meta-tags'),
  
  // Format
  formatOptions: document.getElementById('format-options'),
  sizeEstimate: document.getElementById('size-estimate'),
  
  // Quick options
  quickOptions: document.getElementById('quick-options'),
  
  // Actions
  scrapeBtn: document.getElementById('scrape-btn'),
  
  // Progress
  progressSection: document.getElementById('progress-section'),
  progressFill: document.getElementById('progress-fill'),
  progressText: document.getElementById('progress-text'),
  progressStats: document.getElementById('progress-stats'),
  progressResources: document.getElementById('progress-resources'),
  
  // Result
  resultSection: document.getElementById('result-section'),
  resultIcon: document.getElementById('result-icon'),
  resultMessage: document.getElementById('result-message'),
  resultDetails: document.getElementById('result-details'),
  openFileBtn: document.getElementById('open-file-btn'),
  copyPathBtn: document.getElementById('copy-path-btn'),
  
  // Error
  errorSection: document.getElementById('error-section'),
  errorMessage: document.getElementById('error-message'),
  retryBtn: document.getElementById('retry-btn'),
  
  // Panels
  historyBtn: document.getElementById('history-btn'),
  historyPanel: document.getElementById('history-panel'),
  historyClose: document.getElementById('history-close'),
  historyList: document.getElementById('history-list'),
  clearHistory: document.getElementById('clear-history'),
  
  settingsBtn: document.getElementById('settings-btn'),
  settingsPanel: document.getElementById('settings-panel'),
  settingsClose: document.getElementById('settings-close'),
  settingsReset: document.getElementById('settings-reset'),
  settingsSave: document.getElementById('settings-save'),
  
  // Settings inputs
  settingInlineResources: document.getElementById('setting-inline-resources'),
  settingIncludeScripts: document.getElementById('setting-include-scripts'),
  settingIncludeStyles: document.getElementById('setting-include-styles'),
  settingRemoveTracking: document.getElementById('setting-remove-tracking'),
  settingPreserveForms: document.getElementById('setting-preserve-forms'),
  settingTimeout: document.getElementById('setting-timeout'),
  settingMaxSize: document.getElementById('setting-max-size'),
};

// ============================================================================
// Rendering
// ============================================================================

/**
 * Renders UI based on current state
 */
const render = () => {
  // Format buttons
  const formatBtns = elements.formatOptions.querySelectorAll('.format-btn');
  formatBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.format === state.selectedFormat);
  });

  // Quick options
  const optionChips = elements.quickOptions.querySelectorAll('.option-chip');
  optionChips.forEach(chip => {
    const option = chip.dataset.option;
    chip.classList.toggle('active', state.options[option]);
  });

  // Scrape button
  elements.scrapeBtn.disabled = state.isCapturing;
  elements.scrapeBtn.querySelector('.btn-text').textContent = 
    state.isCapturing ? 'Capturing...' : 'Capture';

  // Panels
  elements.settingsPanel.classList.toggle('hidden', !state.showSettings);
  elements.historyPanel.classList.toggle('hidden', !state.showHistory);

  // Settings form
  if (state.settings) {
    elements.settingInlineResources.checked = state.settings.inlineResources;
    elements.settingIncludeScripts.checked = state.settings.includeScripts;
    elements.settingIncludeStyles.checked = state.settings.includeStyles;
    if (elements.settingRemoveTracking) {
      elements.settingRemoveTracking.checked = state.settings.removeTracking || false;
    }
    if (elements.settingPreserveForms) {
      elements.settingPreserveForms.checked = state.settings.preserveForms || false;
    }
    elements.settingTimeout.value = Math.round(state.settings.resourceTimeout / 1000);
    elements.settingMaxSize.value = Math.round(state.settings.maxResourceSize / (1024 * 1024));
  }

  // Resource stats
  if (state.pageStats) {
    elements.resourceStats.classList.remove('hidden');
    elements.statImages.textContent = state.pageStats.images || 0;
    elements.statStyles.textContent = state.pageStats.stylesheets || 0;
    elements.statScripts.textContent = state.pageStats.scripts || 0;
    elements.statFonts.textContent = state.pageStats.fonts || 0;
    
    // Size estimate
    const estimatedSize = estimateSize(state.pageStats, state.selectedFormat);
    elements.sizeEstimate.textContent = estimatedSize ? `~${estimatedSize}` : '';
  }

  // History
  renderHistory();
};

/**
 * Estimates output file size based on resources and format
 */
const estimateSize = (stats, format) => {
  if (!stats) return null;
  
  // Rough estimates based on typical compression
  const baseHtml = stats.htmlSize || 50000;
  const imagesSize = (stats.images || 0) * 100000; // ~100KB avg
  const cssSize = (stats.stylesheets || 0) * 30000; // ~30KB avg
  const jsSize = (stats.scripts || 0) * 50000; // ~50KB avg
  
  let total = baseHtml + imagesSize + cssSize + jsSize;
  
  // Format multipliers
  const multipliers = {
    html: 1.4, // base64 overhead
    mhtml: 1.37,
    zip: 0.6, // compression
    pdf: 0.8,
  };
  
  total *= multipliers[format] || 1;
  
  if (total > 1024 * 1024) {
    return `${(total / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.round(total / 1024)} KB`;
};

/**
 * Renders history list
 */
const renderHistory = () => {
  if (state.history.length === 0) {
    elements.historyList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
        <p>No captures yet</p>
      </div>
    `;
    return;
  }

  const formatIcons = {
    html: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    mhtml: '<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/>',
    zip: '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>',
    pdf: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  };

  elements.historyList.innerHTML = state.history.slice(0, 10).map(item => `
    <div class="history-item" data-filename="${item.filename}">
      <div class="history-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          ${formatIcons[item.format] || formatIcons.html}
        </svg>
      </div>
      <div class="history-info">
        <div class="history-title">${item.title || item.filename}</div>
        <div class="history-meta">${formatRelativeTime(item.timestamp)} · ${formatBytes(item.size)}</div>
      </div>
    </div>
  `).join('');
};

/**
 * Formats bytes to human readable
 */
const formatBytes = (bytes) => {
  if (bytes > 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
};

/**
 * Formats timestamp to relative time
 */
const formatRelativeTime = (timestamp) => {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
};

/**
 * Shows progress UI
 */
const showProgress = (percent, text, resourceInfo = null) => {
  elements.progressSection.classList.remove('hidden');
  elements.resultSection.classList.add('hidden');
  elements.errorSection.classList.add('hidden');
  
  elements.progressFill.style.width = `${percent}%`;
  elements.progressText.textContent = text;
  
  if (resourceInfo) {
    elements.progressStats.classList.remove('hidden');
    elements.progressResources.textContent = resourceInfo;
  }
};

/**
 * Shows result UI
 */
const showResult = (result) => {
  elements.progressSection.classList.add('hidden');
  elements.resultSection.classList.remove('hidden');
  elements.errorSection.classList.add('hidden');
  
  elements.resultMessage.textContent = 'Complete';
  
  const sizeKb = Math.round(result.size / 1024);
  const duration = (result.duration / 1000).toFixed(1);
  elements.resultDetails.textContent = 
    `${result.filename} (${sizeKb} KB) · ${duration}s`;

  // Store result for actions
  updateState({ lastResult: result });
  
  // Add to history
  addToHistory(result);
};

/**
 * Shows error UI
 */
const showError = (message) => {
  elements.progressSection.classList.add('hidden');
  elements.resultSection.classList.add('hidden');
  elements.errorSection.classList.remove('hidden');
  
  elements.errorMessage.textContent = message;
};

/**
 * Resets UI to initial state
 */
const resetUI = () => {
  elements.progressSection.classList.add('hidden');
  elements.resultSection.classList.add('hidden');
  elements.errorSection.classList.add('hidden');
  elements.progressFill.style.width = '0%';
  elements.progressStats.classList.add('hidden');
};

/**
 * Shows toast notification
 */
const showToast = (message, type = 'success') => {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  
  toast.textContent = message;
  toast.className = `toast ${type}`;
  
  // Trigger reflow for animation
  void toast.offsetWidth;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
};

// ============================================================================
// Communication
// ============================================================================

/**
 * Sends message to service worker
 */
const sendMessage = (message) => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
};

/**
 * Gets current active tab
 */
const getCurrentTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
};

/**
 * Gets page statistics from content script
 */
const getPageStats = async (tabId) => {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          images: document.querySelectorAll('img').length,
          stylesheets: document.querySelectorAll('link[rel="stylesheet"]').length,
          scripts: document.querySelectorAll('script[src]').length,
          fonts: document.querySelectorAll('link[rel*="font"]').length,
          htmlSize: document.documentElement.outerHTML.length,
        };
      },
    });
    return result.result;
  } catch (e) {
    console.error('Failed to get page stats:', e);
    return null;
  }
};

/**
 * Gets page metadata from content script
 */
const getPageMetadata = async (tabId) => {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const getMeta = (name) => {
          const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
          return el ? el.content : null;
        };
        return {
          description: getMeta('description') || getMeta('og:description'),
          keywords: getMeta('keywords'),
          author: getMeta('author'),
        };
      },
    });
    return result.result;
  } catch (e) {
    return null;
  }
};

/**
 * Loads user settings
 */
const loadSettings = async () => {
  try {
    const response = await sendMessage({ type: MessageTypes.GET_SETTINGS });
    if (response.ok) {
      updateState({ settings: { ...DEFAULT_SETTINGS, ...response.settings } });
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
};

/**
 * Saves user settings
 */
const saveSettings = async () => {
  const settings = {
    inlineResources: elements.settingInlineResources.checked,
    includeScripts: elements.settingIncludeScripts.checked,
    includeStyles: elements.settingIncludeStyles.checked,
    removeTracking: elements.settingRemoveTracking?.checked || false,
    preserveForms: elements.settingPreserveForms?.checked || false,
    resourceTimeout: parseInt(elements.settingTimeout.value) * 1000,
    maxResourceSize: parseInt(elements.settingMaxSize.value) * 1024 * 1024,
  };

  try {
    await sendMessage({ type: MessageTypes.SAVE_SETTINGS, settings });
    updateState({ settings, showSettings: false });
    showToast('Settings saved');
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
};

/**
 * Loads capture history
 */
const loadHistory = async () => {
  try {
    const result = await chrome.storage.local.get('captureHistory');
    updateState({ history: result.captureHistory || [] });
  } catch (e) {
    console.error('Failed to load history:', e);
  }
};

/**
 * Adds item to history
 */
const addToHistory = async (result) => {
  const item = {
    filename: result.filename,
    title: state.currentTab?.title,
    url: state.currentTab?.url,
    format: state.selectedFormat,
    size: result.size,
    timestamp: Date.now(),
  };
  
  const history = [item, ...state.history].slice(0, 50); // Keep last 50
  
  try {
    await chrome.storage.local.set({ captureHistory: history });
    updateState({ history });
  } catch (e) {
    console.error('Failed to save history:', e);
  }
};

/**
 * Clears history
 */
const clearHistory = async () => {
  try {
    await chrome.storage.local.remove('captureHistory');
    updateState({ history: [] });
    showToast('History cleared');
  } catch (e) {
    console.error('Failed to clear history:', e);
  }
};

// ============================================================================
// Actions
// ============================================================================

/**
 * Initiates page capture
 */
const startCapture = async () => {
  if (state.isCapturing || !state.currentTab) return;

  updateState({ isCapturing: true });
  resetUI();
  showProgress(0, 'Starting capture...');

  try {
    const response = await sendMessage({
      type: MessageTypes.START_SCRAPE,
      tabId: state.currentTab.id,
      format: state.selectedFormat,
      options: state.options,
    });

    if (response.ok) {
      updateState({ currentJobId: response.jobId });
      showResult(response.result);
    } else {
      showError(response.error || 'Capture failed');
    }
  } catch (error) {
    showError(error.message || 'An unexpected error occurred');
  } finally {
    updateState({ isCapturing: false, currentJobId: null });
  }
};

/**
 * Handles format selection
 */
const selectFormat = (format) => {
  updateState({ selectedFormat: format });
};

/**
 * Toggles quick option
 */
const toggleOption = (option) => {
  updateState({
    options: { ...state.options, [option]: !state.options[option] }
  });
};

/**
 * Opens settings panel
 */
const openSettings = () => {
  updateState({ showSettings: true, showHistory: false });
};

/**
 * Closes settings panel
 */
const closeSettings = () => {
  updateState({ showSettings: false });
};

/**
 * Opens history panel
 */
const openHistory = () => {
  updateState({ showHistory: true, showSettings: false });
};

/**
 * Closes history panel
 */
const closeHistory = () => {
  updateState({ showHistory: false });
};

/**
 * Resets settings to defaults
 */
const resetSettings = () => {
  updateState({ settings: { ...DEFAULT_SETTINGS } });
};

/**
 * Copies file path to clipboard
 */
const copyFilePath = async () => {
  if (state.lastResult?.filename) {
    try {
      await navigator.clipboard.writeText(state.lastResult.filename);
      showToast('Path copied');
    } catch (e) {
      showToast('Failed to copy', 'error');
    }
  }
};

// ============================================================================
// Event Listeners
// ============================================================================

const setupEventListeners = () => {
  // Format selection
  elements.formatOptions.addEventListener('click', (e) => {
    const btn = e.target.closest('.format-btn');
    if (btn) selectFormat(btn.dataset.format);
  });

  // Quick options
  elements.quickOptions.addEventListener('click', (e) => {
    const chip = e.target.closest('.option-chip');
    if (chip) toggleOption(chip.dataset.option);
  });

  // Scrape button
  elements.scrapeBtn.addEventListener('click', startCapture);

  // Retry button
  elements.retryBtn.addEventListener('click', () => {
    resetUI();
    startCapture();
  });

  // Result actions
  elements.copyPathBtn?.addEventListener('click', copyFilePath);

  // History panel
  elements.historyBtn.addEventListener('click', openHistory);
  elements.historyClose.addEventListener('click', closeHistory);
  elements.clearHistory.addEventListener('click', clearHistory);

  // Settings panel
  elements.settingsBtn.addEventListener('click', openSettings);
  elements.settingsClose.addEventListener('click', closeSettings);
  elements.settingsReset.addEventListener('click', resetSettings);
  elements.settingsSave.addEventListener('click', saveSettings);

  // Listen for progress updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === MessageTypes.SCRAPE_PROGRESS && 
        message.jobId === state.currentJobId) {
      const { stage, percent, current, total } = message.progress;
      const stageNames = {
        initializing: 'Initializing...',
        capturing: 'Capturing page...',
        processing: 'Processing content...',
        extracting: 'Extracting resources...',
        fetching: 'Fetching resources...',
        'fetching-css-resources': 'Fetching CSS resources...',
        'processing-css': 'Processing stylesheets...',
        inlining: 'Inlining resources...',
        exporting: 'Creating export file...',
        complete: 'Complete!',
      };
      
      const resourceInfo = current && total ? `${current}/${total} resources` : null;
      showProgress(percent, stageNames[stage] || stage, resourceInfo);
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.showSettings) closeSettings();
      if (state.showHistory) closeHistory();
    }
    if (e.key === 'Enter' && !state.isCapturing && !state.showSettings && !state.showHistory) {
      startCapture();
    }
  });
};

// ============================================================================
// Initialization
// ============================================================================

const init = async () => {
  // Get current tab info
  const tab = await getCurrentTab();
  
  if (tab) {
    state = { ...state, currentTab: tab };
    
    // Clear skeleton and show content
    elements.pageTitle.innerHTML = '';
    elements.pageUrl.innerHTML = '';
    elements.pageTitle.textContent = tab.title || 'Untitled';
    elements.pageUrl.textContent = tab.url || '';

    // Check if scrapable
    const isScrapable = tab.url && 
      !tab.url.startsWith('chrome://') && 
      !tab.url.startsWith('chrome-extension://') &&
      !tab.url.startsWith('about:') &&
      !tab.url.startsWith('edge://') &&
      !tab.url.startsWith('file://');

    if (!isScrapable) {
      elements.scrapeBtn.disabled = true;
      elements.scrapeBtn.querySelector('.btn-text').textContent = 'Cannot capture';
    } else {
      // Get page stats
      const stats = await getPageStats(tab.id);
      if (stats) {
        updateState({ pageStats: stats });
      }
      
      // Get metadata
      const metadata = await getPageMetadata(tab.id);
      if (metadata?.description) {
        elements.metaDescription.textContent = metadata.description;
        elements.pageMetadata.classList.remove('hidden');
      }
    }
  }

  // Load settings and history
  await Promise.all([loadSettings(), loadHistory()]);

  // Setup event listeners
  setupEventListeners();

  // Initial render
  render();
};

// Start
init().catch(console.error);
