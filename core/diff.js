/**
 * Scrappy Diff Module
 * 
 * Provides simple text diff functionality for comparing captures.
 * Implements a lightweight diff algorithm without external dependencies.
 * 
 * @fileoverview Pure functions for content comparison
 * @author anoraK
 */

// ============================================================================
// Constants
// ============================================================================

const DiffTypes = Object.freeze({
  EQUAL: 'equal',
  INSERT: 'insert',
  DELETE: 'delete',
});

// ============================================================================
// Diff Algorithm
// ============================================================================

/**
 * Computes the Longest Common Subsequence length table
 * @param {string[]} a - First sequence
 * @param {string[]} b - Second sequence
 * @returns {number[][]}
 */
const computeLcsTable = (a, b) => {
  const m = a.length;
  const n = b.length;
  const table = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }
  
  return table;
};

/**
 * Backtrack through LCS table to find diff
 * @param {number[][]} table
 * @param {string[]} a
 * @param {string[]} b
 * @param {number} i
 * @param {number} j
 * @returns {Array<{type: string, value: string}>}
 */
const backtrack = (table, a, b, i, j) => {
  const result = [];
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: DiffTypes.EQUAL, value: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      result.unshift({ type: DiffTypes.INSERT, value: b[j - 1] });
      j--;
    } else if (i > 0) {
      result.unshift({ type: DiffTypes.DELETE, value: a[i - 1] });
      i--;
    }
  }
  
  return result;
};

/**
 * Computes line-by-line diff between two texts
 * @param {string} oldText - Original text
 * @param {string} newText - New text
 * @returns {Array<{type: string, value: string, lineNumber: number}>}
 */
export const computeDiff = (oldText, newText) => {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  
  const table = computeLcsTable(oldLines, newLines);
  const diff = backtrack(table, oldLines, newLines, oldLines.length, newLines.length);
  
  // Add line numbers
  let oldLine = 0;
  let newLine = 0;
  
  return diff.map(item => {
    let lineNumber;
    
    if (item.type === DiffTypes.DELETE) {
      oldLine++;
      lineNumber = oldLine;
    } else if (item.type === DiffTypes.INSERT) {
      newLine++;
      lineNumber = newLine;
    } else {
      oldLine++;
      newLine++;
      lineNumber = newLine;
    }
    
    return { ...item, lineNumber };
  });
};

/**
 * Summarizes diff statistics
 * @param {Array<{type: string}>} diff
 * @returns {{additions: number, deletions: number, unchanged: number}}
 */
export const summarizeDiff = (diff) => {
  return diff.reduce((acc, item) => {
    if (item.type === DiffTypes.INSERT) acc.additions++;
    else if (item.type === DiffTypes.DELETE) acc.deletions++;
    else acc.unchanged++;
    return acc;
  }, { additions: 0, deletions: 0, unchanged: 0 });
};

/**
 * Computes similarity percentage between two texts
 * @param {string} oldText
 * @param {string} newText
 * @returns {number} - Percentage 0-100
 */
export const computeSimilarity = (oldText, newText) => {
  if (oldText === newText) return 100;
  if (!oldText || !newText) return 0;
  
  const diff = computeDiff(oldText, newText);
  const stats = summarizeDiff(diff);
  const total = stats.additions + stats.deletions + stats.unchanged;
  
  if (total === 0) return 100;
  
  return Math.round((stats.unchanged / total) * 100);
};

/**
 * Creates a unified diff string
 * @param {string} oldText
 * @param {string} newText
 * @param {Object} options
 * @returns {string}
 */
export const createUnifiedDiff = (oldText, newText, options = {}) => {
  const {
    oldName = 'old',
    newName = 'new',
    context = 3,
  } = options;
  
  const diff = computeDiff(oldText, newText);
  const lines = [];
  
  lines.push(`--- ${oldName}`);
  lines.push(`+++ ${newName}`);
  
  let lastPrinted = -context - 1;
  
  for (let i = 0; i < diff.length; i++) {
    const item = diff[i];
    
    if (item.type !== DiffTypes.EQUAL) {
      // Print context before if needed
      const contextStart = Math.max(0, i - context);
      
      if (contextStart > lastPrinted + 1) {
        lines.push(`@@ -${contextStart + 1} +${contextStart + 1} @@`);
      }
      
      for (let j = contextStart; j <= i; j++) {
        if (j > lastPrinted) {
          const d = diff[j];
          const prefix = d.type === DiffTypes.INSERT ? '+' : 
                         d.type === DiffTypes.DELETE ? '-' : ' ';
          lines.push(`${prefix}${d.value}`);
          lastPrinted = j;
        }
      }
      
      // Print context after
      for (let j = i + 1; j < Math.min(diff.length, i + context + 1); j++) {
        const d = diff[j];
        if (d.type === DiffTypes.EQUAL) {
          lines.push(` ${d.value}`);
          lastPrinted = j;
        } else {
          break;
        }
      }
    }
  }
  
  return lines.join('\n');
};

export { DiffTypes };
