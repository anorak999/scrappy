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
};

const DEFAULT_SETTINGS = {
  format: 'html',
  inlineResources: true,
  includeScripts: true,
  includeStyles: true,
  resourceTimeout: 10000,
  maxResourceSize: 5 * 1024 * 1024,
};

// ============================================================================
// State Management (Immutable)
// ============================================================================

let state = {
  currentTab: null,
  selectedFormat: 'html',
  isCapturing: false,
  settings: { ...DEFAULT_SETTINGS },
  showSettings: false,
  currentJobId: null,
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
  pageTitle: document.getElementById('page-title'),
  pageUrl: document.getElementById('page-url'),
  formatOptions: document.getElementById('format-options'),
  scrapeBtn: document.getElementById('scrape-btn'),
  progressSection: document.getElementById('progress-section'),
  progressFill: document.getElementById('progress-fill'),
  progressText: document.getElementById('progress-text'),
  resultSection: document.getElementById('result-section'),
  resultIcon: document.getElementById('result-icon'),
  resultMessage: document.getElementById('result-message'),
  resultDetails: document.getElementById('result-details'),
  errorSection: document.getElementById('error-section'),
  errorMessage: document.getElementById('error-message'),
  retryBtn: document.getElementById('retry-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  settingsPanel: document.getElementById('settings-panel'),
  settingsClose: document.getElementById('settings-close'),
  settingsReset: document.getElementById('settings-reset'),
  settingsSave: document.getElementById('settings-save'),
  settingInlineResources: document.getElementById('setting-inline-resources'),
  settingIncludeScripts: document.getElementById('setting-include-scripts'),
  settingIncludeStyles: document.getElementById('setting-include-styles'),
  settingTimeout: document.getElementById('setting-timeout'),
  settingMaxSize: document.getElementById('setting-max-size'),
};

// ============================================================================
// Rendering
// ============================================================================

/**
 * Renders UI based on current state
 * Declarative rendering pattern
 */
const render = () => {
  // Format buttons
  const formatBtns = elements.formatOptions.querySelectorAll('.format-btn');
  formatBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.format === state.selectedFormat);
  });

  // Scrape button
  elements.scrapeBtn.disabled = state.isCapturing;
  elements.scrapeBtn.querySelector('.btn-text').textContent = 
    state.isCapturing ? 'Capturing...' : 'Capture Page';
  
  if (state.isCapturing) {
    elements.scrapeBtn.querySelector('.btn-icon').classList.add('spinning');
  } else {
    elements.scrapeBtn.querySelector('.btn-icon').classList.remove('spinning');
  }

  // Settings panel
  elements.settingsPanel.classList.toggle('hidden', !state.showSettings);

  // Settings form
  if (state.settings) {
    elements.settingInlineResources.checked = state.settings.inlineResources;
    elements.settingIncludeScripts.checked = state.settings.includeScripts;
    elements.settingIncludeStyles.checked = state.settings.includeStyles;
    elements.settingTimeout.value = Math.round(state.settings.resourceTimeout / 1000);
    elements.settingMaxSize.value = Math.round(state.settings.maxResourceSize / (1024 * 1024));
  }
};

/**
 * Shows progress UI
 * @param {number} percent
 * @param {string} text
 */
const showProgress = (percent, text) => {
  elements.progressSection.classList.remove('hidden');
  elements.resultSection.classList.add('hidden');
  elements.errorSection.classList.add('hidden');
  
  elements.progressFill.style.width = `${percent}%`;
  elements.progressText.textContent = text;
};

/**
 * Shows result UI
 * @param {Object} result
 */
const showResult = (result) => {
  elements.progressSection.classList.add('hidden');
  elements.resultSection.classList.remove('hidden');
  elements.errorSection.classList.add('hidden');
  
  elements.resultIcon.textContent = '✅';
  elements.resultMessage.textContent = 'Capture complete!';
  
  const sizeKb = Math.round(result.size / 1024);
  const duration = (result.duration / 1000).toFixed(1);
  elements.resultDetails.textContent = 
    `${result.filename} (${sizeKb} KB) - ${duration}s`;
};

/**
 * Shows error UI
 * @param {string} message
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
};

// ============================================================================
// Communication
// ============================================================================

/**
 * Sends message to service worker
 * @param {Object} message
 * @returns {Promise<Object>}
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
 * @returns {Promise<chrome.tabs.Tab>}
 */
const getCurrentTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
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
    resourceTimeout: parseInt(elements.settingTimeout.value) * 1000,
    maxResourceSize: parseInt(elements.settingMaxSize.value) * 1024 * 1024,
  };

  try {
    await sendMessage({ type: MessageTypes.SAVE_SETTINGS, settings });
    updateState({ settings, showSettings: false });
  } catch (error) {
    console.error('Failed to save settings:', error);
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
 * @param {string} format
 */
const selectFormat = (format) => {
  updateState({ selectedFormat: format });
};

/**
 * Opens settings panel
 */
const openSettings = () => {
  updateState({ showSettings: true });
};

/**
 * Closes settings panel
 */
const closeSettings = () => {
  updateState({ showSettings: false });
};

/**
 * Resets settings to defaults
 */
const resetSettings = () => {
  updateState({ settings: { ...DEFAULT_SETTINGS } });
};

// ============================================================================
// Event Listeners
// ============================================================================

/**
 * Sets up event listeners
 * Uses event delegation where appropriate
 */
const setupEventListeners = () => {
  // Format selection
  elements.formatOptions.addEventListener('click', (e) => {
    const btn = e.target.closest('.format-btn');
    if (btn) {
      selectFormat(btn.dataset.format);
    }
  });

  // Scrape button
  elements.scrapeBtn.addEventListener('click', startCapture);

  // Retry button
  elements.retryBtn.addEventListener('click', () => {
    resetUI();
    startCapture();
  });

  // Settings
  elements.settingsBtn.addEventListener('click', openSettings);
  elements.settingsClose.addEventListener('click', closeSettings);
  elements.settingsReset.addEventListener('click', resetSettings);
  elements.settingsSave.addEventListener('click', saveSettings);

  // Listen for progress updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === MessageTypes.SCRAPE_PROGRESS && 
        message.jobId === state.currentJobId) {
      const { stage, percent } = message.progress;
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
      showProgress(percent, stageNames[stage] || stage);
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Escape to close settings
    if (e.key === 'Escape' && state.showSettings) {
      closeSettings();
    }
    // Enter to capture
    if (e.key === 'Enter' && !state.isCapturing && !state.showSettings) {
      startCapture();
    }
  });
};

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initializes the popup
 */
const init = async () => {
  // Get current tab info
  const tab = await getCurrentTab();
  
  if (tab) {
    state = { ...state, currentTab: tab };
    
    elements.pageTitle.textContent = tab.title || 'Untitled';
    elements.pageUrl.textContent = tab.url || '';

    // Check if we can scrape this page
    const isScrapable = tab.url && 
      !tab.url.startsWith('chrome://') && 
      !tab.url.startsWith('chrome-extension://') &&
      !tab.url.startsWith('about:') &&
      !tab.url.startsWith('edge://') &&
      !tab.url.startsWith('file://');

    if (!isScrapable) {
      elements.scrapeBtn.disabled = true;
      elements.scrapeBtn.querySelector('.btn-text').textContent = 'Cannot capture this page';
    }
  }

  // Load settings
  await loadSettings();

  // Setup event listeners
  setupEventListeners();

  // Initial render
  render();
};

// Start
init().catch(console.error);
