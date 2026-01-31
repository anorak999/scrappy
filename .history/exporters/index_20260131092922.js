/**
 * Exporters Index
 * 
 * Aggregates and initializes all format exporters.
 * Plugin-like architecture for extensibility.
 * 
 * @fileoverview Exporter registry and initialization
 * @author anoraK
 */

// Import and register all exporters
import './html-exporter.js';
import './mhtml-exporter.js';
import './zip-exporter.js';
import './pdf-exporter.js';

// Re-export interface functions
export {
  registerExporter,
  getExporter,
  getAllExporters,
  getExporterOptions,
} from './exporter-interface.js';
