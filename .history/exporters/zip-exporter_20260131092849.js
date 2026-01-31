/**
 * ZIP Exporter
 * 
 * Exports page as a ZIP archive with separate asset files.
 * Uses a lightweight ZIP implementation.
 * 
 * @fileoverview ZIP export adapter
 * @author anoraK
 */

import { registerExporter } from './exporter-interface.js';
import { sanitizeFilename, generateTimestamp, extractDomain } from '../core/utils.js';

/**
 * CRC32 lookup table
 * Pre-computed for performance
 */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
})();

/**
 * Calculates CRC32 checksum
 * Pure function
 * 
 * @param {Uint8Array} data
 * @returns {number}
 */
const crc32 = (data) => {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
};

/**
 * Creates a DOS timestamp
 * @param {Date} date
 * @returns {{date: number, time: number}}
 */
const toDosDateTime = (date) => {
  const dosTime = (date.getSeconds() >> 1) |
    (date.getMinutes() << 5) |
    (date.getHours() << 11);
  const dosDate = date.getDate() |
    ((date.getMonth() + 1) << 5) |
    ((date.getFullYear() - 1980) << 9);
  return { date: dosDate, time: dosTime };
};

/**
 * Creates a ZIP file entry
 * Pure function
 * 
 * @param {string} filename
 * @param {Uint8Array} content
 * @param {Date} modDate
 * @returns {Object}
 */
const createZipEntry = (filename, content, modDate = new Date()) => {
  const encoder = new TextEncoder();
  const filenameBytes = encoder.encode(filename);
  const { date, time } = toDosDateTime(modDate);
  const checksum = crc32(content);

  // Local file header
  const header = new Uint8Array(30 + filenameBytes.length);
  const headerView = new DataView(header.buffer);

  headerView.setUint32(0, 0x04034b50, true); // Local file header signature
  headerView.setUint16(4, 20, true); // Version needed to extract
  headerView.setUint16(6, 0, true); // General purpose bit flag
  headerView.setUint16(8, 0, true); // Compression method (stored)
  headerView.setUint16(10, time, true); // Last mod file time
  headerView.setUint16(12, date, true); // Last mod file date
  headerView.setUint32(14, checksum, true); // CRC-32
  headerView.setUint32(18, content.length, true); // Compressed size
  headerView.setUint32(22, content.length, true); // Uncompressed size
  headerView.setUint16(26, filenameBytes.length, true); // File name length
  headerView.setUint16(28, 0, true); // Extra field length

  header.set(filenameBytes, 30);

  return {
    filename,
    filenameBytes,
    content,
    checksum,
    date,
    time,
    header,
    headerSize: header.length,
    contentSize: content.length,
  };
};

/**
 * Creates central directory entry
 * @param {Object} entry
 * @param {number} offset
 * @returns {Uint8Array}
 */
const createCentralDirectoryEntry = (entry, offset) => {
  const cd = new Uint8Array(46 + entry.filenameBytes.length);
  const cdView = new DataView(cd.buffer);

  cdView.setUint32(0, 0x02014b50, true); // Central directory signature
  cdView.setUint16(4, 20, true); // Version made by
  cdView.setUint16(6, 20, true); // Version needed to extract
  cdView.setUint16(8, 0, true); // General purpose bit flag
  cdView.setUint16(10, 0, true); // Compression method
  cdView.setUint16(12, entry.time, true); // Last mod file time
  cdView.setUint16(14, entry.date, true); // Last mod file date
  cdView.setUint32(16, entry.checksum, true); // CRC-32
  cdView.setUint32(20, entry.contentSize, true); // Compressed size
  cdView.setUint32(24, entry.contentSize, true); // Uncompressed size
  cdView.setUint16(28, entry.filenameBytes.length, true); // File name length
  cdView.setUint16(30, 0, true); // Extra field length
  cdView.setUint16(32, 0, true); // File comment length
  cdView.setUint16(34, 0, true); // Disk number start
  cdView.setUint16(36, 0, true); // Internal file attributes
  cdView.setUint32(38, 0, true); // External file attributes
  cdView.setUint32(42, offset, true); // Relative offset of local header

  cd.set(entry.filenameBytes, 46);

  return cd;
};

/**
 * Creates end of central directory record
 * @param {number} entryCount
 * @param {number} cdSize
 * @param {number} cdOffset
 * @returns {Uint8Array}
 */
const createEndOfCentralDirectory = (entryCount, cdSize, cdOffset) => {
  const eocd = new Uint8Array(22);
  const view = new DataView(eocd.buffer);

  view.setUint32(0, 0x06054b50, true); // End of central directory signature
  view.setUint16(4, 0, true); // Disk number
  view.setUint16(6, 0, true); // Disk number with central directory
  view.setUint16(8, entryCount, true); // Total entries on this disk
  view.setUint16(10, entryCount, true); // Total entries
  view.setUint32(12, cdSize, true); // Size of central directory
  view.setUint32(16, cdOffset, true); // Offset of central directory
  view.setUint16(20, 0, true); // ZIP file comment length

  return eocd;
};

/**
 * Creates a ZIP archive from files
 * Pure function
 * 
 * @param {Array<{name: string, content: Uint8Array}>} files
 * @returns {Blob}
 */
const createZip = (files) => {
  const entries = files.map(f => createZipEntry(f.name, f.content));

  // Calculate total size
  let offset = 0;
  const offsets = entries.map(entry => {
    const entryOffset = offset;
    offset += entry.headerSize + entry.contentSize;
    return entryOffset;
  });

  // Create central directory entries
  const cdEntries = entries.map((entry, i) => 
    createCentralDirectoryEntry(entry, offsets[i])
  );

  const cdOffset = offset;
  const cdSize = cdEntries.reduce((sum, cd) => sum + cd.length, 0);

  // Create EOCD
  const eocd = createEndOfCentralDirectory(entries.length, cdSize, cdOffset);

  // Combine all parts
  const totalSize = offset + cdSize + eocd.length;
  const zipData = new Uint8Array(totalSize);

  let pos = 0;

  // Write local file headers and content
  for (const entry of entries) {
    zipData.set(entry.header, pos);
    pos += entry.header.length;
    zipData.set(entry.content, pos);
    pos += entry.content.length;
  }

  // Write central directory
  for (const cd of cdEntries) {
    zipData.set(cd, pos);
    pos += cd.length;
  }

  // Write EOCD
  zipData.set(eocd, pos);

  return new Blob([zipData], { type: 'application/zip' });
};

/**
 * Extracts path from URL for ZIP structure
 * @param {string} url
 * @param {string} baseUrl
 * @returns {string}
 */
const urlToPath = (url, baseUrl) => {
  try {
    const urlObj = new URL(url);
    const baseObj = new URL(baseUrl);

    // Same origin - use path
    if (urlObj.origin === baseObj.origin) {
      let path = urlObj.pathname;
      if (path.startsWith('/')) path = path.substring(1);
      if (!path) path = 'index';
      return `assets/${path}`.replace(/[<>:"|?*]/g, '_');
    }

    // Different origin - use domain/path
    let path = `assets/${urlObj.hostname}${urlObj.pathname}`;
    return path.replace(/[<>:"|?*]/g, '_');
  } catch {
    return `assets/${sanitizeFilename(url)}`;
  }
};

/**
 * Generates filename for ZIP export
 * @param {Object} pageData
 * @returns {string}
 */
const generateZipFilename = (pageData) => {
  const domain = extractDomain(pageData.url);
  const title = sanitizeFilename(pageData.title || 'page');
  const timestamp = generateTimestamp();
  
  return `${domain}_${title}_${timestamp}.zip`;
};

/**
 * ZIP Exporter implementation
 */
const zipExporter = {
  format: 'zip',
  extension: '.zip',
  mimeType: 'application/zip',
  label: 'ZIP Archive',
  description: 'Separate files in a ZIP archive',

  /**
   * Exports page data as ZIP
   * @param {Object} pageData
   * @param {Object} [options]
   * @returns {Promise<ExportResult>}
   */
  export: async (pageData, options = {}) => {
    const encoder = new TextEncoder();
    const files = [];

    // Add manifest
    const manifest = {
      url: pageData.url,
      title: pageData.title,
      capturedAt: pageData.capturedAt,
      version: '1.0.0',
      files: ['index.html'],
    };

    // Add main HTML file
    files.push({
      name: 'index.html',
      content: encoder.encode(pageData.html),
    });

    // Add resources
    if (pageData.resources) {
      for (const [url, result] of pageData.resources.entries()) {
        if (result.ok && result.value) {
          const resource = result.value;
          const path = urlToPath(url, pageData.url);
          
          let content;
          if (typeof resource.content === 'string') {
            content = encoder.encode(resource.content);
          } else {
            content = new Uint8Array(resource.content);
          }

          files.push({ name: path, content });
          manifest.files.push(path);
        }
      }
    }

    // Add manifest file
    files.push({
      name: 'manifest.json',
      content: encoder.encode(JSON.stringify(manifest, null, 2)),
    });

    // Add README
    const readme = `# Scrappy Web Archive

## Original URL
${pageData.url}

## Page Title
${pageData.title}

## Captured At
${new Date(pageData.capturedAt).toISOString()}

## Contents
- index.html - Main page
- assets/ - Page resources (CSS, JS, images)
- manifest.json - Archive metadata

## Disclaimer
This content was captured for personal archival purposes only.
Please respect copyright and terms of service of the original website.

---
Captured by Scrappy - One-Click Web Scraper
`;

    files.push({
      name: 'README.md',
      content: encoder.encode(readme),
    });

    // Create ZIP
    const blob = createZip(files);
    const filename = options.filename || generateZipFilename(pageData);

    return {
      blob,
      filename,
      mimeType: 'application/zip',
      size: blob.size,
      fileCount: files.length,
    };
  },
};

// Register the exporter
registerExporter(zipExporter);

export default zipExporter;
