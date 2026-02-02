<div align="center">

# 🕷️ Scrappy

**One-Click Web Page Scraper**

A Chrome extension that captures entire web pages locally with a single click.  
Supports HTML, MHTML, PDF, and ZIP export formats.

[![Chrome](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **🎯 One-Click Capture** | Capture any webpage instantly with a single button click |
| **📄 Multiple Formats** | Export to HTML, MHTML, ZIP, or PDF |
| **🔗 Resource Inlining** | Automatically embeds CSS, images, and fonts as data URIs |
| **🌙 AMOLED Dark UI** | Pure black, minimal interface optimized for OLED displays |
| **⚡ Smart Caching** | Memoization prevents redundant network requests |
| **🛡️ Fault Tolerant** | Circuit breakers protect against cascading failures |
| **🔒 Privacy First** | All processing happens locally—no data sent to servers |
| **📊 Resource Stats** | Live preview of images, styles, scripts, fonts counts |
| **📜 Capture History** | Track and review your recent captures |
| **⌨️ Keyboard Shortcuts** | Quick capture with Alt+Shift+H/M/P/Z |
| **🖱️ Context Menu** | Right-click to capture in any format |
| **📐 Size Estimation** | Preview estimated file size before capture |

---

## 🎹 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+Shift+H` | Capture as HTML |
| `Alt+Shift+M` | Capture as MHTML |
| `Alt+Shift+P` | Capture as PDF |
| `Alt+Shift+Z` | Capture as ZIP |

You can customize these shortcuts in `chrome://extensions/shortcuts`

---

## 📦 Installation

### From Source (Developer Mode)

1. **Clone or download** this repository:
   ```bash
   git clone https://github.com/anorak999/scrappy.git
   cd scrappy
   ```

2. **Open Chrome** and navigate to:
   ```
   chrome://extensions
   ```

3. **Enable Developer Mode** (toggle in top-right corner)

4. **Click "Load unpacked"** and select the `scrappy` folder

5. **Pin the extension** by clicking the puzzle icon in Chrome toolbar

### Alternative: Drag & Drop
Drag the entire `scrappy` folder onto the `chrome://extensions` page.

---

## 🚀 Usage

### Basic Capture

1. Navigate to any webpage you want to save
2. Click the **Scrappy** extension icon in your toolbar
3. Select your preferred **export format**:
   - **HTML** — Self-contained single file with embedded resources
   - **MHTML** — Web archive format (native browser support)
   - **ZIP** — Structured archive with separate asset files
   - **PDF** — Print-ready document
4. Click **"Capture Page"**
5. Choose where to save the file

### Settings

Click the ⚙️ gear icon to configure:

| Setting | Description | Default |
|---------|-------------|---------|
| Inline Resources | Embed CSS, JS, images directly in output | ✅ On |
| Include JavaScript | Preserve scripts in captured page | ✅ On |
| Include Stylesheets | Preserve CSS styling | ✅ On |
| Remove Tracking | Strip analytics and tracking scripts | ❌ Off |
| Preserve Form Data | Save form input values | ❌ Off |
| Resource Timeout | Max wait time per resource (seconds) | 10 |
| Max Resource Size | Skip resources larger than (MB) | 5 |

### Quick Options

Toggle these chips in the popup for quick adjustments:

| Option | Description |
|--------|-------------|
| Lazy Load | Scroll page to trigger lazy-loaded content |
| Clean | Remove ads, popups, and overlays |
| Minify | Compress HTML/CSS output |

---

## 🏗️ Architecture

Scrappy is built using **Hexagonal Architecture** (Ports & Adapters) with functional programming principles.

```
┌─────────────────────────────────────────────────────────────┐
│                     POPUP UI (Adapter)                      │
│                  popup.html / popup.js                      │
└─────────────────────────────┬───────────────────────────────┘
                              │ Messages
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   SERVICE WORKER (Port)                     │
│               background/service-worker.js                  │
│         Orchestrates capture, export, download              │
└─────────────────────────────┬───────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  CONTENT SCRIPT │ │   CORE ENGINE   │ │    EXPORTERS    │
│  DOM Serializer │ │  HTML Processor │ │  Format Adapters│
│                 │ │  Resource Fetch │ │  HTML/MHTML/ZIP │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### Directory Structure

```
scrappy/
├── manifest.json           # Chrome extension configuration
├── background/
│   └── service-worker.js   # Main orchestration logic
├── content/
│   └── content-script.js   # DOM capture in page context
├── popup/
│   ├── popup.html          # Extension popup UI
│   ├── popup.css           # AMOLED dark theme styles
│   └── popup.js            # UI logic and state management
├── core/
│   ├── types.js            # Result monad, type definitions
│   ├── utils.js            # Pure utility functions
│   ├── memoize.js          # Caching with LRU eviction
│   ├── circuit-breaker.js  # Fault tolerance pattern
│   ├── dead-letter-queue.js# Error logging and analysis
│   ├── resource-fetcher.js # Network requests with caching
│   ├── html-processor.js   # HTML parsing and inlining
│   └── diff.js             # Content comparison algorithm
├── exporters/
│   ├── exporter-interface.js # Port interface definition
│   ├── html-exporter.js    # Self-contained HTML export
│   ├── mhtml-exporter.js   # Web archive format
│   ├── zip-exporter.js     # Structured archive export
│   ├── pdf-exporter.js     # PDF via Chrome Debugger API
│   └── index.js            # Exporter registry
├── assets/
│   └── icons/              # Extension icons (16/32/48/128px)
└── tests/
    └── scrappy.test.js     # Jest test specifications
```

---

## 🔧 Engineering Principles

Scrappy implements enterprise-grade software engineering patterns:

### 1. Result Monad (Monadic Error Handling)
```javascript
// Instead of try/catch, we use explicit Result types
const result = await fetchResource(url);
if (result.ok) {
  console.log('Data:', result.value);
} else {
  console.log('Error:', result.error, result.errorCode);
}
```

### 2. Circuit Breaker Pattern
Protects against cascading failures when fetching external resources:
- **CLOSED** — Normal operation
- **OPEN** — Failing, requests blocked for recovery
- **HALF-OPEN** — Testing if service recovered

### 3. Memoization with LRU Cache
- Caches fetched resources by URL
- Deduplicates concurrent requests to same URL
- TTL-based expiration prevents stale data

### 4. Dead Letter Queue (DLQ)
Failed operations are captured with full context for debugging:
```javascript
await dlq.enqueue({
  type: 'RESOURCE_FETCH_FAILURE',
  payload: { url },
  error: new Error('CORS blocked'),
  errorCode: 'CORS_BLOCKED',
  source: 'fetchResource',
});
```

### 5. Pure Functions & Immutability
- Core processing functions have no side effects
- Data structures are frozen after creation
- Enables safe concurrent processing

---

## 📊 Export Formats

### HTML (Self-Contained)
- All resources embedded as base64 data URIs
- Works offline in any browser
- Largest file size

### MHTML (Web Archive)
- Standard web archive format
- Native browser support
- Moderate file size

### ZIP (Structured Archive)
- Separate files for HTML, CSS, images
- Preserves original file structure
- Best for editing/analysis

### PDF (Print-Ready)
- Uses Chrome's native print engine
- Vector-quality rendering
- Fixed layout, no interactivity

---

## ⚠️ Limitations

| Limitation | Reason |
|------------|--------|
| Cannot capture `chrome://` pages | Browser security restriction |
| Cannot capture `file://` URLs | Cross-origin policy |
| Some CORS-blocked resources skipped | Server configuration |
| Dynamic content may be incomplete | JavaScript timing |
| PDF requires debugger permission | Chrome API requirement |

---

## 🧪 Development

### Prerequisites
- Node.js 18+ (for testing)
- Chrome/Chromium browser

### Running Tests
```bash
npm install
npm test
```

### Linting
```bash
npm run lint
```

### Building for Distribution
```bash
npm run package
# Creates scrappy.zip in project root
```

---

## 🔐 Permissions Explained

| Permission | Purpose |
|------------|---------|
| `activeTab` | Access current tab only when user clicks extension |
| `scripting` | Inject content script to serialize DOM |
| `storage` | Save user preferences |
| `downloads` | Save captured files to disk |
| `notifications` | Show completion notifications |
| `debugger` | Generate PDF via Chrome print engine |
| `<all_urls>` | Fetch resources from any domain |

---

## 📜 Legal & Ethics

### ✅ Acceptable Use
- Saving articles for offline reading
- Archiving your own content
- Research with proper attribution
- Personal backup purposes

### ❌ Prohibited Use
- Scraping copyrighted content for redistribution
- Bypassing paywalls or access controls
- Mass automated scraping
- Violating website terms of service

**Always respect `robots.txt` and website terms of service.**

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- Built with [Chrome Extensions Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)
- Icons adapted from [Feather Icons](https://feathericons.com/)
- Inspired by SingleFile and other web archiving tools

---

<div align="center">

**Made with ❤️ by [anoraK](https://github.com/anorak999)**

</div>
