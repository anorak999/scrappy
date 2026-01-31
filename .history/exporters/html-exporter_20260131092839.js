/**
 * HTML Exporter
 * 
 * Exports page as self-contained HTML file.
 * Adapter implementation for HTML format.
 * 
 * @fileoverview HTML export adapter
 * @author anoraK
 */

import { registerExporter } from './exporter-interface.js';
import { sanitizeFilename, generateTimestamp, extractDomain } from '../core/utils.js';

/**
 * Creates self-contained HTML document
 * Pure function
 * 
 * @param {string} html - Processed HTML
 * @param {Object} pageData - Page data
 * @returns {string}
 */
const createStandaloneHtml = (html, pageData) => {
  // Ensure proper DOCTYPE
  let result = html;
  
  if (!result.trim().toLowerCase().startsWith('<!doctype')) {
    result = `<!DOCTYPE html>\n${result}`;
  }

  // Add comment header
  const header = `
<!--
  Captured by Scrappy - One-Click Web Scraper
  Original URL: ${pageData.url}
  Captured: ${new Date(pageData.capturedAt).toISOString()}
  Title: ${pageData.title}
  
  DISCLAIMER: This content is captured for personal archival purposes only.
  Respect copyright and terms of service of the original website.
-->
`;

  return header + result;
};

/**
 * Generates filename for HTML export
 * Pure function
 * 
 * @param {Object} pageData
 * @returns {string}
 */
const generateHtmlFilename = (pageData) => {
  const domain = extractDomain(pageData.url);
  const title = sanitizeFilename(pageData.title || 'page');
  const timestamp = generateTimestamp();
  
  return `${domain}_${title}_${timestamp}.html`;
};

/**
 * HTML Exporter implementation
 */
const htmlExporter = {
  format: 'html',
  extension: '.html',
  mimeType: 'text/html',
  label: 'HTML (Self-Contained)',
  description: 'Single HTML file with embedded resources',

  /**
   * Exports page data as HTML
   * @param {Object} pageData - Processed page data
   * @param {Object} [options] - Export options
   * @returns {Promise<ExportResult>}
   */
  export: async (pageData, options = {}) => {
    const html = createStandaloneHtml(pageData.html, pageData);
    
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const filename = options.filename || generateHtmlFilename(pageData);

    return {
      blob,
      filename,
      mimeType: 'text/html',
      size: blob.size,
    };
  },
};

// Register the exporter
registerExporter(htmlExporter);

export default htmlExporter;
