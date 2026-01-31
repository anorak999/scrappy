/**
 * PDF Exporter
 * 
 * Exports page as PDF using browser print functionality.
 * 
 * @fileoverview PDF export adapter
 * @author anoraK
 */

import { registerExporter } from './exporter-interface.js';
import { sanitizeFilename, generateTimestamp, extractDomain } from '../core/utils.js';
import { Err, ErrorCodes } from '../core/types.js';

/**
 * Generates filename for PDF export
 * @param {Object} pageData
 * @returns {string}
 */
const generatePdfFilename = (pageData) => {
  const domain = extractDomain(pageData.url);
  const title = sanitizeFilename(pageData.title || 'page');
  const timestamp = generateTimestamp();
  
  return `${domain}_${title}_${timestamp}.pdf`;
};

/**
 * PDF Exporter implementation
 * Uses Chrome's debugger API to generate PDF
 */
const pdfExporter = {
  format: 'pdf',
  extension: '.pdf',
  mimeType: 'application/pdf',
  label: 'PDF Document',
  description: 'Print-ready PDF document',

  /**
   * Exports page data as PDF
   * Requires tabId for Chrome API
   * 
   * @param {Object} pageData
   * @param {Object} [options]
   * @returns {Promise<ExportResult>}
   */
  export: async (pageData, options = {}) => {
    const { tabId } = options;

    if (!tabId) {
      throw new Error('PDF export requires tabId');
    }

    // Check if chrome.debugger is available
    if (typeof chrome === 'undefined' || !chrome.debugger) {
      throw new Error('PDF export requires Chrome debugger API');
    }

    try {
      // Attach debugger
      await new Promise((resolve, reject) => {
        chrome.debugger.attach({ tabId }, '1.3', () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });

      // Generate PDF
      const pdfData = await new Promise((resolve, reject) => {
        chrome.debugger.sendCommand(
          { tabId },
          'Page.printToPDF',
          {
            printBackground: true,
            preferCSSPageSize: true,
            marginTop: 0.4,
            marginBottom: 0.4,
            marginLeft: 0.4,
            marginRight: 0.4,
          },
          (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (result && result.data) {
              resolve(result.data);
            } else {
              reject(new Error('Failed to generate PDF'));
            }
          }
        );
      });

      // Detach debugger
      await new Promise((resolve) => {
        chrome.debugger.detach({ tabId }, resolve);
      });

      // Convert base64 to blob
      const binaryString = atob(pdfData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: 'application/pdf' });
      const filename = options.filename || generatePdfFilename(pageData);

      return {
        blob,
        filename,
        mimeType: 'application/pdf',
        size: blob.size,
      };

    } catch (error) {
      // Ensure debugger is detached on error
      try {
        await new Promise((resolve) => {
          chrome.debugger.detach({ tabId }, resolve);
        });
      } catch {
        // Ignore detach errors
      }

      throw error;
    }
  },
};

// Register the exporter
registerExporter(pdfExporter);

export default pdfExporter;
