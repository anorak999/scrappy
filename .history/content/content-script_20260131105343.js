/**
 * Scrappy Content Script
 * 
 * Runs in the context of web pages to capture DOM content.
 * Implements DOM serialization with dynamic content handling.
 * 
 * @fileoverview Content script for page capture
 * @author anoraK
 */

// Prevent multiple injections
if (window.__scrappy_injected__) {
  console.log('[Scrappy] Content script already injected');
} else {
  window.__scrappy_injected__ = true;

  /**
   * Message types for communication
   */
  const MessageTypes = {
    GET_PAGE_CONTENT: 'GET_PAGE_CONTENT',
    PAGE_CONTENT_RESPONSE: 'PAGE_CONTENT_RESPONSE',
  };

  // ============================================================================
  // DOM Serialization
  // ============================================================================

  /**
   * Gets the full serialized HTML of the page
   * Waits for dynamic content to settle
   * 
   * @returns {Promise<string>}
   */
  const getSerializedHtml = async () => {
    // Wait for any pending dynamic content
    await waitForDynamicContent();

    // Clone the document to avoid modifying the original
    const docClone = document.cloneNode(true);

    // Process the clone
    processClone(docClone);

    // Serialize
    const doctype = getDoctype();
    const html = docClone.documentElement.outerHTML;

    return doctype + '\n' + html;
  };

  /**
   * Gets the DOCTYPE declaration
   * @returns {string}
   */
  const getDoctype = () => {
    const doctype = document.doctype;
    if (!doctype) return '<!DOCTYPE html>';

    return `<!DOCTYPE ${doctype.name}${
      doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : ''
    }${doctype.systemId ? ` "${doctype.systemId}"` : ''}>`;
  };

  /**
   * Waits for dynamic content to settle
   * Handles lazy-loaded images and deferred scripts
   * 
   * @returns {Promise<void>}
   */
  const waitForDynamicContent = async () => {
    // Wait for document ready state
    if (document.readyState !== 'complete') {
      await new Promise(resolve => {
        window.addEventListener('load', resolve, { once: true });
        // Fallback timeout
        setTimeout(resolve, 5000);
      });
    }

    // Wait for lazy-loaded images
    await waitForImages();

    // Wait for network/CPU idle if supported (Robustness for SPAs)
    if (window.requestIdleCallback) {
      await new Promise(resolve => window.requestIdleCallback(resolve, { timeout: 2000 }));
    } else {
      // Fallback delay
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  };

  /**
   * Waits for visible images to load
   * @returns {Promise<void>}
   */
  const waitForImages = async () => {
    const images = Array.from(document.images);
    const visibleImages = images.filter(img => {
      const rect = img.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    });

    const imagePromises = visibleImages
      .filter(img => !img.complete)
      .map(img => new Promise(resolve => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
        // Timeout for each image
        setTimeout(resolve, 3000);
      }));

    if (imagePromises.length > 0) {
      await Promise.race([
        Promise.all(imagePromises),
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]);
    }
  };

  /**
   * Processes the cloned document for serialization
   * @param {Document} doc
   */
  const processClone = (doc) => {
    // Expand lazy-loaded images
    expandLazyImages(doc);

    // Preserve form values
    preserveFormValues(doc);

    // Expand shadow DOM (if accessible)
    expandShadowDom(doc);

    // Remove scripts that might cause issues
    sanitizeScripts(doc);

    // Add capture metadata
    addCaptureMetadata(doc);
  };

  /**
   * Expands lazy-loaded images by converting data-src to src
   * @param {Document} doc
   */
  const expandLazyImages = (doc) => {
    // Common lazy-loading attributes
    const lazyAttrs = ['data-src', 'data-original', 'data-lazy-src', 'data-srcset'];

    const images = doc.querySelectorAll('img');
    images.forEach(img => {
      // Copy data-src to src if src is empty or placeholder
      for (const attr of lazyAttrs) {
        const value = img.getAttribute(attr);
        if (value && (!img.src || img.src.includes('placeholder') || img.src.includes('blank'))) {
          if (attr.includes('srcset')) {
            img.setAttribute('srcset', value);
          } else {
            img.src = value;
          }
        }
      }

      // Expand srcset from data-srcset
      const dataSrcset = img.getAttribute('data-srcset');
      if (dataSrcset) {
        img.setAttribute('srcset', dataSrcset);
      }
    });

    // Handle picture elements
    const sources = doc.querySelectorAll('source');
    sources.forEach(source => {
      for (const attr of lazyAttrs) {
        const value = source.getAttribute(attr);
        if (value) {
          if (attr.includes('srcset')) {
            source.setAttribute('srcset', value);
          } else {
            source.setAttribute('src', value);
          }
        }
      }
    });
  };

  /**
   * Preserves form input values
   * @param {Document} doc
   */
  const preserveFormValues = (doc) => {
    // Helper to safely query by name attribute
    const safeQueryByName = (tagName, name) => {
      if (!name) return null;
      try {
        return document.querySelector(`${tagName}[name="${escapeCssSelector(name)}"]`);
      } catch (e) {
        // Fallback: find by iterating
        return Array.from(document.querySelectorAll(tagName)).find(el => el.name === name);
      }
    };

    // Preserve text inputs
    const textInputs = doc.querySelectorAll('input[type="text"], input[type="email"], input[type="search"], input[type="tel"], input[type="url"], input:not([type])');
    textInputs.forEach(input => {
      const originalInput = safeQueryByName('input', input.name);
      if (originalInput) {
        input.setAttribute('value', originalInput.value);
      }
    });

    // Preserve textareas
    const textareas = doc.querySelectorAll('textarea');
    textareas.forEach(textarea => {
      const originalTextarea = safeQueryByName('textarea', textarea.name);
      if (originalTextarea) {
        textarea.textContent = originalTextarea.value;
      }
    });

    // Preserve checkboxes and radio buttons
    const checkboxes = doc.querySelectorAll('input[type="checkbox"], input[type="radio"]');
    checkboxes.forEach(input => {
      try {
        const selector = `input[type="${input.type}"][name="${escapeCssSelector(input.name)}"][value="${escapeCssSelector(input.value)}"]`;
        const originalInput = document.querySelector(selector);
        if (originalInput && originalInput.checked) {
          input.setAttribute('checked', 'checked');
        }
      } catch (e) {
        // Skip if selector fails
      }
    });

    // Preserve selects
    const selects = doc.querySelectorAll('select');
    selects.forEach(select => {
      const originalSelect = safeQueryByName('select', select.name);
      if (originalSelect) {
        const options = select.querySelectorAll('option');
        options.forEach((option, index) => {
          if (originalSelect.options[index]?.selected) {
            option.setAttribute('selected', 'selected');
          } else {
            option.removeAttribute('selected');
          }
        });
      }
    });
  };

  /**
   * Expands shadow DOM content
   * @param {Document} doc
   */
  const expandShadowDom = (doc) => {
    const elementsWithShadow = doc.querySelectorAll('*');
    elementsWithShadow.forEach(el => {
      // Check if original element has shadow root
      try {
        const originalSelector = getUniqueSelector(el);
        const originalEl = document.querySelector(originalSelector);
        
        if (originalEl?.shadowRoot && originalEl.shadowRoot.mode === 'open') {
          // Create a comment marker
          const marker = doc.createComment(`Shadow DOM content from ${originalSelector}`);
          el.appendChild(marker);

          // Clone shadow content
          const shadowContent = originalEl.shadowRoot.cloneNode(true);
          
          // Append shadow content as regular DOM
          Array.from(shadowContent.childNodes).forEach(child => {
            el.appendChild(child.cloneNode(true));
          });
        }
      } catch (e) {
        // Ignore selector errors in shadow DOM expansion
        console.warn('[Scrappy] Shadow DOM expansion skipped for element:', e);
      }
    });
  };

  /**
   * Escapes special characters in CSS selector strings
   * Uses CSS.escape if available, with fallback for older browsers
   * @param {string} str
   * @returns {string}
   */
  const escapeCssSelector = (str) => {
    // Use native CSS.escape if available (handles all edge cases)
    if (typeof CSS !== 'undefined' && CSS.escape) {
      return CSS.escape(str);
    }
    
    // Fallback: manual escaping
    // Handle empty string
    if (!str) return '';
    
    let result = '';
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      const code = char.charCodeAt(0);
      
      // If first char is a digit, escape it as \3X (hex code + space)
      if (i === 0 && code >= 0x30 && code <= 0x39) {
        result += '\\3' + char + ' ';
      }
      // If first char is a hyphen followed by digit or another hyphen
      else if (i === 0 && char === '-' && str.length > 1) {
        const nextCode = str.charCodeAt(1);
        if ((nextCode >= 0x30 && nextCode <= 0x39) || str[1] === '-') {
          result += '\\-';
        } else {
          result += char;
        }
      }
      // Escape special CSS characters
      else if (/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/.test(char)) {
        result += '\\' + char;
      }
      // Escape control characters and non-printable
      else if (code < 0x20 || code === 0x7F) {
        result += '\\' + code.toString(16) + ' ';
      }
      else {
        result += char;
      }
    }
    
    return result;
  };

  /**
   * Gets a unique selector for an element
   * @param {Element} el
   * @returns {string}
   */
  const getUniqueSelector = (el) => {
    if (el.id) return `#${escapeCssSelector(el.id)}`;
    
    const path = [];
    let current = el;
    
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.tagName.toLowerCase();
      
      if (current.id) {
        selector = `#${escapeCssSelector(current.id)}`;
        path.unshift(selector);
        break;
      }
      
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/)
          .slice(0, 2)
          .map(escapeCssSelector)
          .join('.');
        if (classes) selector += `.${classes}`;
      }
      
      const siblings = current.parentElement?.children;
      if (siblings && siblings.length > 1) {
        const index = Array.from(siblings).indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
      
      path.unshift(selector);
      current = current.parentElement;
    }
    
    return path.join(' > ');
  };

  /**
   * Sanitizes scripts to prevent issues
   * @param {Document} doc
   */
  const sanitizeScripts = (doc) => {
    // Add noscript attribute to scripts to prevent execution
    const scripts = doc.querySelectorAll('script');
    scripts.forEach(script => {
      // Add attribute to identify original scripts
      script.setAttribute('data-scrappy-original', 'true');
      
      // Comment out inline script content
      if (script.textContent && !script.src) {
        const content = script.textContent;
        script.textContent = `/* Scrappy: Original inline script preserved but disabled */\n/* ${content.replace(/\*\//g, '*\\/')} */`;
      }
    });
  };

  /**
   * Adds capture metadata
   * @param {Document} doc
   */
  const addCaptureMetadata = (doc) => {
    const head = doc.head || doc.querySelector('head');
    if (!head) return;

    const metaComment = doc.createComment(`
      Captured by Scrappy Extension
      URL: ${window.location.href}
      Time: ${new Date().toISOString()}
      User-Agent: ${navigator.userAgent}
    `);

    head.insertBefore(metaComment, head.firstChild);
  };

  // ============================================================================
  // Page Metadata Extraction
  // ============================================================================

  /**
   * Extracts page metadata
   * @returns {Object}
   */
  const extractMetadata = () => {
    const getMeta = (name) => {
      // Use iteration instead of querySelector to avoid escaping issues with colons
      const metas = document.querySelectorAll('meta[name], meta[property]');
      for (const el of metas) {
        if (el.getAttribute('name') === name || el.getAttribute('property') === name) {
          return el.content || '';
        }
      }
      return '';
    };

    return {
      title: document.title,
      description: getMeta('description') || getMeta('og:description'),
      author: getMeta('author'),
      keywords: getMeta('keywords'),
      ogTitle: getMeta('og:title'),
      ogImage: getMeta('og:image'),
      ogType: getMeta('og:type'),
      twitterCard: getMeta('twitter:card'),
      canonical: document.querySelector('link[rel="canonical"]')?.href || '',
      language: document.documentElement.lang || '',
      charset: document.characterSet,
      viewport: getMeta('viewport'),
      robots: getMeta('robots'),
    };
  };

  /**
   * Extracts computed styles summary
   * @returns {Object}
   */
  const extractStylesSummary = () => {
    const styleSheets = document.styleSheets.length;
    const inlineStyles = document.querySelectorAll('[style]').length;
    const styleElements = document.querySelectorAll('style').length;

    return {
      styleSheets,
      inlineStyles,
      styleElements,
    };
  };

  // ============================================================================
  // Message Handler
  // ============================================================================

  /**
   * Handles messages from service worker
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === MessageTypes.GET_PAGE_CONTENT) {
      (async () => {
        try {
          const html = await getSerializedHtml();
          const metadata = extractMetadata();
          const stylesSummary = extractStylesSummary();

          sendResponse({
            ok: true,
            data: {
              html,
              url: window.location.href,
              title: document.title,
              metadata: {
                ...metadata,
                styles: stylesSummary,
                scrollHeight: document.body.scrollHeight,
                clientHeight: document.documentElement.clientHeight,
                elementsCount: document.querySelectorAll('*').length,
              },
            },
          });
        } catch (error) {
          console.error('[Scrappy] Content script error:', error);
          sendResponse({
            ok: false,
            error: error.message || 'Failed to capture page content',
          });
        }
      })();

      return true; // Keep channel open for async response
    }

    return false;
  });

  console.log('[Scrappy] Content script loaded for:', window.location.href);
}
