/**
 * Format Exporter Interface
 * 
 * Defines the port interface for format exporters.
 * Follows Hexagonal Architecture - this is the port.
 * 
 * @fileoverview Exporter interface definition
 * @author anoraK
 */

/**
 * @typedef {Object} ExportResult
 * @property {Blob} blob - The exported content
 * @property {string} filename - Suggested filename
 * @property {string} mimeType - Content MIME type
 */

/**
 * @typedef {Object} ExporterInterface
 * @property {string} format - Format identifier
 * @property {string} extension - File extension
 * @property {string} mimeType - MIME type
 * @property {string} label - Human-readable label
 * @property {string} description - Format description
 * @property {(pageData: PageData, options?: Object) => Promise<ExportResult>} export - Export function
 */

/**
 * Exporter registry - SSOT for all exporters
 */
const exporterRegistry = new Map();

/**
 * Registers an exporter
 * @param {ExporterInterface} exporter
 */
export const registerExporter = (exporter) => {
  if (!exporter.format || !exporter.export) {
    throw new Error('Invalid exporter: must have format and export function');
  }
  exporterRegistry.set(exporter.format, exporter);
};

/**
 * Gets an exporter by format
 * @param {string} format
 * @returns {ExporterInterface | null}
 */
export const getExporter = (format) => {
  return exporterRegistry.get(format) || null;
};

/**
 * Gets all available exporters
 * @returns {ExporterInterface[]}
 */
export const getAllExporters = () => {
  return [...exporterRegistry.values()];
};

/**
 * Gets exporter options for UI
 * @returns {Array<{value: string, label: string, description: string}>}
 */
export const getExporterOptions = () => {
  return getAllExporters().map(e => ({
    value: e.format,
    label: e.label,
    description: e.description,
    extension: e.extension,
  }));
};
