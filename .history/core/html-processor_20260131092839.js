/**
 * HTML Processor
 * 
 * Processes and transforms HTML for resource inlining.
 * Implements recursive resource discovery and replacement.
 * 
 * @fileoverview HTML processing with pure functions
 * @author anoraK
 */

import { Ok, Err, ErrorCodes } from './types.js';
import { fetchResource, fetchResources, resolveUrl, shouldExclude } from './resource-fetcher.js';
import { mapAsync, unique } from './utils.js';

/**
 * Resource extraction patterns
 * Declarative configuration for resource discovery
 */
const RESOURCE_PATTERNS = Object.freeze({
  // CSS: url() references
  cssUrl: /url\s*\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi,
  // CSS: @import statements
  cssImport: /@import\s+(?:url\s*\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;/gi,
  // HTML: src attributes
  htmlSrc: /<(?:img|script|iframe|audio|video|source|embed)\s+[^>]*src\s*=\s*(['"])([^'"]+)\1/gi,
  // HTML: href for stylesheets
  htmlStylesheet: /<link\s+[^>]*rel\s*=\s*['"]stylesheet['"][^>]*href\s*=\s*(['"])([^'"]+)\1/gi,
  // HTML: href for stylesheets (alternate order)
  htmlStylesheetAlt: /<link\s+[^>]*href\s*=\s*(['"])([^'"]+)\1[^>]*rel\s*=\s*['"]stylesheet['"]/gi,
  // HTML: srcset attribute
  htmlSrcset: /srcset\s*=\s*(['"])([^'"]+)\1/gi,
  // HTML: inline style url()
  inlineStyleUrl: /style\s*=\s*(['"])([^'"]*url\s*\([^)]+\)[^'"]*)\1/gi,
});

/**
 * Extracts all URLs from CSS content
 * Pure function - no side effects
 * 
 * @param {string} css - CSS content
 * @param {string} baseUrl - Base URL for resolution
 * @returns {string[]} Array of absolute URLs
 */
export const extractCssUrls = (css, baseUrl) => {
  const urls = [];

  // Extract url() references
  let match;
  const urlPattern = new RegExp(RESOURCE_PATTERNS.cssUrl.source, 'gi');
  while ((match = urlPattern.exec(css)) !== null) {
    const url = match[2];
    if (url && !url.startsWith('data:')) {
      urls.push(resolveUrl(url, baseUrl));
    }
  }

  // Extract @import statements
  const importPattern = new RegExp(RESOURCE_PATTERNS.cssImport.source, 'gi');
  while ((match = importPattern.exec(css)) !== null) {
    const url = match[2];
    if (url && !url.startsWith('data:')) {
      urls.push(resolveUrl(url, baseUrl));
    }
  }

  return unique(urls);
};

/**
 * Inlines URLs in CSS content
 * Pure function - returns new CSS string
 * 
 * @param {string} css - Original CSS
 * @param {string} baseUrl - Base URL
 * @param {Map} resourceMap - Map of URL to Resource
 * @returns {string} CSS with inlined resources
 */
export const inlineCssUrls = (css, baseUrl, resourceMap) => {
  let result = css;

  // Replace url() references
  result = result.replace(RESOURCE_PATTERNS.cssUrl, (match, quote, url) => {
    if (url.startsWith('data:')) return match;
    
    const absoluteUrl = resolveUrl(url, baseUrl);
    const resource = resourceMap.get(absoluteUrl);
    
    if (resource?.ok && resource.value.dataUri) {
      return `url(${quote}${resource.value.dataUri}${quote})`;
    }
    
    return match;
  });

  // Replace @import with inlined CSS
  result = result.replace(RESOURCE_PATTERNS.cssImport, (match, quote, url) => {
    if (url.startsWith('data:')) return match;
    
    const absoluteUrl = resolveUrl(url, baseUrl);
    const resource = resourceMap.get(absoluteUrl);
    
    if (resource?.ok && resource.value.type === 'css') {
      // Recursively inline the imported CSS
      const inlinedCss = inlineCssUrls(
        resource.value.content,
        absoluteUrl,
        resourceMap
      );
      return `/* Inlined from ${url} */\n${inlinedCss}`;
    }
    
    return match;
  });

  return result;
};

/**
 * Extracts all resource URLs from HTML
 * Pure function
 * 
 * @param {string} html - HTML content
 * @param {string} baseUrl - Base URL
 * @param {Object} config - Scrape configuration
 * @returns {Object} Categorized URLs
 */
export const extractHtmlUrls = (html, baseUrl, config) => {
  const urls = {
    stylesheets: [],
    scripts: [],
    images: [],
    other: [],
  };

  let match;

  // Extract stylesheet links
  const stylesheetPattern = new RegExp(RESOURCE_PATTERNS.htmlStylesheet.source, 'gi');
  while ((match = stylesheetPattern.exec(html)) !== null) {
    const url = resolveUrl(match[2], baseUrl);
    if (!shouldExclude(url, config.excludePatterns)) {
      urls.stylesheets.push(url);
    }
  }

  // Alternate stylesheet pattern
  const stylesheetAltPattern = new RegExp(RESOURCE_PATTERNS.htmlStylesheetAlt.source, 'gi');
  while ((match = stylesheetAltPattern.exec(html)) !== null) {
    const url = resolveUrl(match[2], baseUrl);
    if (!shouldExclude(url, config.excludePatterns)) {
      urls.stylesheets.push(url);
    }
  }

  // Extract src attributes
  const srcPattern = new RegExp(RESOURCE_PATTERNS.htmlSrc.source, 'gi');
  while ((match = srcPattern.exec(html)) !== null) {
    const tagMatch = match[0].toLowerCase();
    const url = resolveUrl(match[2], baseUrl);
    
    if (url.startsWith('data:') || shouldExclude(url, config.excludePatterns)) {
      continue;
    }

    if (tagMatch.startsWith('<script')) {
      if (config.includeScripts) urls.scripts.push(url);
    } else if (tagMatch.startsWith('<img')) {
      urls.images.push(url);
    } else {
      urls.other.push(url);
    }
  }

  // Extract srcset images
  const srcsetPattern = new RegExp(RESOURCE_PATTERNS.htmlSrcset.source, 'gi');
  while ((match = srcsetPattern.exec(html)) !== null) {
    const srcset = match[2];
    const srcsetUrls = srcset.split(',').map(part => {
      const [url] = part.trim().split(/\s+/);
      return resolveUrl(url, baseUrl);
    });
    urls.images.push(...srcsetUrls.filter(u => !u.startsWith('data:')));
  }

  // Deduplicate
  return {
    stylesheets: unique(urls.stylesheets),
    scripts: unique(urls.scripts),
    images: unique(urls.images),
    other: unique(urls.other),
  };
};

/**
 * Inlines resources in HTML
 * Higher-order function using map/reduce patterns
 * 
 * @param {string} html - Original HTML
 * @param {string} baseUrl - Base URL
 * @param {Map} resourceMap - Map of URL to Resource
 * @param {Object} config - Configuration
 * @returns {string} HTML with inlined resources
 */
export const inlineHtmlResources = (html, baseUrl, resourceMap, config) => {
  let result = html;

  // Inline stylesheets as <style> tags
  result = result.replace(
    /<link\s+([^>]*rel\s*=\s*['"]stylesheet['"][^>]*)>/gi,
    (match, attrs) => {
      const hrefMatch = attrs.match(/href\s*=\s*(['"])([^'"]+)\1/i);
      if (!hrefMatch) return match;

      const url = resolveUrl(hrefMatch[2], baseUrl);
      const resource = resourceMap.get(url);

      if (resource?.ok && resource.value.type === 'css') {
        const inlinedCss = inlineCssUrls(
          resource.value.content,
          url,
          resourceMap
        );
        return `<style data-original-href="${url}">\n${inlinedCss}\n</style>`;
      }

      return match;
    }
  );

  // Inline images as data URIs
  result = result.replace(
    /<img\s+([^>]*src\s*=\s*(['"])([^'"]+)\2[^>]*)>/gi,
    (match, beforeSrc, quote, src) => {
      if (src.startsWith('data:')) return match;

      const url = resolveUrl(src, baseUrl);
      const resource = resourceMap.get(url);

      if (resource?.ok && resource.value.dataUri) {
        return match.replace(
          new RegExp(`src\\s*=\\s*${quote}[^'"]+${quote}`, 'i'),
          `src=${quote}${resource.value.dataUri}${quote} data-original-src="${url}"`
        );
      }

      return match;
    }
  );

  // Inline srcset
  result = result.replace(
    /srcset\s*=\s*(['"])([^'"]+)\1/gi,
    (match, quote, srcset) => {
      const newSrcset = srcset.split(',').map(part => {
        const parts = part.trim().split(/\s+/);
        const url = resolveUrl(parts[0], baseUrl);
        const resource = resourceMap.get(url);

        if (resource?.ok && resource.value.dataUri) {
          parts[0] = resource.value.dataUri;
        }

        return parts.join(' ');
      }).join(', ');

      return `srcset=${quote}${newSrcset}${quote}`;
    }
  );

  // Inline scripts (optional)
  if (config.includeScripts) {
    result = result.replace(
      /<script\s+([^>]*src\s*=\s*(['"])([^'"]+)\2[^>]*)><\/script>/gi,
      (match, attrs, quote, src) => {
        const url = resolveUrl(src, baseUrl);
        const resource = resourceMap.get(url);

        if (resource?.ok && resource.value.type === 'js') {
          return `<script data-original-src="${url}">\n${resource.value.content}\n</script>`;
        }

        return match;
      }
    );
  }

  // Process inline styles with url()
  result = result.replace(
    /style\s*=\s*(['"])([^'"]*url\s*\([^)]+\)[^'"]*)\1/gi,
    (match, quote, style) => {
      const newStyle = inlineCssUrls(style, baseUrl, resourceMap);
      return `style=${quote}${newStyle}${quote}`;
    }
  );

  return result;
};

/**
 * Adds base tag to HTML if not present
 * Ensures relative URLs work correctly
 * 
 * @param {string} html - HTML content
 * @param {string} baseUrl - Base URL
 * @returns {string}
 */
export const ensureBaseTag = (html, baseUrl) => {
  // Check if base tag exists
  if (/<base\s+[^>]*>/i.test(html)) {
    return html;
  }

  // Add base tag after <head>
  return html.replace(
    /<head([^>]*)>/i,
    `<head$1>\n<base href="${baseUrl}">`
  );
};

/**
 * Adds metadata to HTML
 * 
 * @param {string} html - HTML content
 * @param {Object} metadata - Metadata to add
 * @returns {string}
 */
export const addMetadata = (html, metadata) => {
  const metaTags = [
    `<meta name="scrappy:captured-at" content="${metadata.capturedAt}">`,
    `<meta name="scrappy:original-url" content="${metadata.url}">`,
    `<meta name="scrappy:version" content="1.0.0">`,
  ].join('\n');

  return html.replace(
    /<head([^>]*)>/i,
    `<head$1>\n${metaTags}`
  );
};

/**
 * Processes HTML by recursively fetching and inlining resources
 * Main orchestration function
 * 
 * @param {string} html - Original HTML
 * @param {string} baseUrl - Page URL
 * @param {Object} config - Configuration
 * @param {Function} [onProgress] - Progress callback
 * @returns {Promise<Result<Object>>}
 */
export const processHtml = async (html, baseUrl, config, onProgress) => {
  try {
    const progress = (stage, percent) => {
      if (onProgress) {
        onProgress({ stage, percent });
      }
    };

    progress('extracting', 0);

    // Extract all URLs
    const urls = extractHtmlUrls(html, baseUrl, config);
    const allUrls = [
      ...urls.stylesheets,
      ...urls.scripts,
      ...urls.images,
      ...urls.other,
    ];

    progress('fetching', 10);

    // Fetch all primary resources
    const primaryResources = await fetchResources(allUrls, config, (p) => {
      progress('fetching', 10 + (p.percent * 0.4));
    });

    progress('processing-css', 50);

    // Extract URLs from CSS files and fetch them (second level)
    const cssUrls = [];
    for (const [url, result] of primaryResources.entries()) {
      if (result.ok && result.value.type === 'css') {
        const nestedUrls = extractCssUrls(result.value.content, url);
        cssUrls.push(...nestedUrls.filter(u => !primaryResources.has(u)));
      }
    }

    // Fetch CSS-referenced resources
    if (cssUrls.length > 0) {
      const cssResources = await fetchResources(unique(cssUrls), config, (p) => {
        progress('fetching-css-resources', 50 + (p.percent * 0.2));
      });

      // Merge into primary resources
      for (const [url, result] of cssResources.entries()) {
        primaryResources.set(url, result);
      }
    }

    progress('inlining', 70);

    // Inline resources into HTML
    let processedHtml = inlineHtmlResources(html, baseUrl, primaryResources, config);
    
    // Add base tag and metadata
    processedHtml = ensureBaseTag(processedHtml, baseUrl);
    processedHtml = addMetadata(processedHtml, {
      capturedAt: new Date().toISOString(),
      url: baseUrl,
    });

    progress('complete', 100);

    // Collect statistics
    const stats = {
      totalResources: allUrls.length + cssUrls.length,
      successfulFetches: [...primaryResources.values()].filter(r => r.ok).length,
      failedFetches: [...primaryResources.values()].filter(r => !r.ok).length,
      stylesheets: urls.stylesheets.length,
      scripts: urls.scripts.length,
      images: urls.images.length,
    };

    return Ok({
      html: processedHtml,
      resources: primaryResources,
      stats,
    });

  } catch (error) {
    return Err(
      error instanceof Error ? error : new Error(String(error)),
      ErrorCodes.SERIALIZATION_FAILED,
      'Failed to process HTML'
    );
  }
};
