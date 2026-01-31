/**
 * MHTML Exporter
 * 
 * Exports page as MHTML (Web Archive) format.
 * Uses Chrome's pageCapture API when available.
 * 
 * @fileoverview MHTML export adapter
 * @author anoraK
 */

import { registerExporter } from './exporter-interface.js';
import { sanitizeFilename, generateTimestamp, extractDomain } from '../core/utils.js';
import { Ok, Err, ErrorCodes, tryCatchAsync } from '../core/types.js';

/**
 * Generates MHTML boundary
 * @returns {string}
 */
const generateBoundary = () => {
  return `----=_Part_${Date.now()}_${Math.random().toString(36).substr(2)}`;
};

/**
 * Creates MHTML content manually
 * Fallback when chrome.pageCapture is not available
 * 
 * @param {Object} pageData
 * @returns {string}
 */
const createMhtmlContent = (pageData) => {
  const boundary = generateBoundary();
  const date = new Date(pageData.capturedAt).toUTCString();
  
  const parts = [];

  // MHTML header
  parts.push(`From: <Scrappy Web Scraper>`);
  parts.push(`Subject: ${pageData.title}`);
  parts.push(`Date: ${date}`);
  parts.push(`MIME-Version: 1.0`);
  parts.push(`Content-Type: multipart/related; type="text/html"; boundary="${boundary}"`);
  parts.push(``);
  parts.push(`This is a multi-part message in MIME format.`);
  parts.push(``);

  // Main HTML part
  parts.push(`--${boundary}`);
  parts.push(`Content-Type: text/html; charset="utf-8"`);
  parts.push(`Content-Transfer-Encoding: quoted-printable`);
  parts.push(`Content-Location: ${pageData.url}`);
  parts.push(``);
  parts.push(quotedPrintableEncode(pageData.html));
  parts.push(``);

  // Add resources as separate parts
  if (pageData.resources) {
    for (const [url, result] of pageData.resources.entries()) {
      if (result.ok && result.value) {
        const resource = result.value;
        
        parts.push(`--${boundary}`);
        parts.push(`Content-Type: ${resource.mimeType}`);
        
        if (typeof resource.content === 'string') {
          parts.push(`Content-Transfer-Encoding: quoted-printable`);
          parts.push(`Content-Location: ${url}`);
          parts.push(``);
          parts.push(quotedPrintableEncode(resource.content));
        } else {
          parts.push(`Content-Transfer-Encoding: base64`);
          parts.push(`Content-Location: ${url}`);
          parts.push(``);
          parts.push(arrayBufferToBase64(resource.content));
        }
        parts.push(``);
      }
    }
  }

  // Closing boundary
  parts.push(`--${boundary}--`);
  parts.push(``);

  return parts.join('\r\n');
};

/**
 * Encodes string as quoted-printable
 * @param {string} str
 * @returns {string}
 */
const quotedPrintableEncode = (str) => {
  return str
    .replace(/[^\t\n\r\x20-\x7e]/g, (char) => {
      const code = char.charCodeAt(0);
      if (code < 256) {
        return '=' + code.toString(16).toUpperCase().padStart(2, '0');
      }
      // For Unicode, use UTF-8 encoding
      const bytes = new TextEncoder().encode(char);
      return Array.from(bytes)
        .map(b => '=' + b.toString(16).toUpperCase().padStart(2, '0'))
        .join('');
    })
    .replace(/(.{73}[^=]{0,2})/g, '$1=\r\n') // Soft line breaks
    .replace(/=\r\n$/, ''); // Remove trailing soft break
};

/**
 * Converts ArrayBuffer to base64
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
const arrayBufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/(.{76})/g, '$1\r\n');
};

/**
 * Generates filename for MHTML export
 * @param {Object} pageData
 * @returns {string}
 */
const generateMhtmlFilename = (pageData) => {
  const domain = extractDomain(pageData.url);
  const title = sanitizeFilename(pageData.title || 'page');
  const timestamp = generateTimestamp();
  
  return `${domain}_${title}_${timestamp}.mhtml`;
};

/**
 * Captures page using Chrome's pageCapture API
 * @param {number} tabId
 * @returns {Promise<Result<Blob, Error>>}
 */
const captureWithApi = async (tabId) => {
  return tryCatchAsync(async () => {
    if (typeof chrome !== 'undefined' && chrome.pageCapture) {
      return new Promise((resolve, reject) => {
        chrome.pageCapture.saveAsMHTML({ tabId }, (mhtmlData) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(mhtmlData);
          }
        });
      });
    }
    throw new Error('pageCapture API not available');
  }, ErrorCodes.PERMISSION_DENIED);
};

/**
 * MHTML Exporter implementation
 */
const mhtmlExporter = {
  format: 'mhtml',
  extension: '.mhtml',
  mimeType: 'message/rfc822',
  label: 'MHTML (Web Archive)',
  description: 'Web archive format for offline viewing',

  /**
   * Exports page data as MHTML
   * @param {Object} pageData
   * @param {Object} [options]
   * @returns {Promise<ExportResult>}
   */
  export: async (pageData, options = {}) => {
    let blob;

    // Try Chrome's native pageCapture API first
    if (options.tabId && typeof chrome !== 'undefined' && chrome.pageCapture) {
      const result = await captureWithApi(options.tabId);
      if (result.ok) {
        blob = result.value;
      }
    }

    // Fallback to manual MHTML creation
    if (!blob) {
      const mhtml = createMhtmlContent(pageData);
      blob = new Blob([mhtml], { type: 'message/rfc822' });
    }

    const filename = options.filename || generateMhtmlFilename(pageData);

    return {
      blob,
      filename,
      mimeType: 'message/rfc822',
      size: blob.size,
    };
  },
};

// Register the exporter
registerExporter(mhtmlExporter);

export default mhtmlExporter;
