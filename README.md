# Scrappy

One-click web page scraper. Captures entire web pages locally as HTML, MHTML, PDF, or ZIP.

## Installation

```bash
git clone https://github.com/anorak999/scrappy.git
```

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click "Load unpacked" and select the `scrappy` folder

## Usage

Click the extension icon, select format, capture.

### Keyboard Shortcuts

- `Alt+Shift+H` — HTML
- `Alt+Shift+M` — MHTML  
- `Alt+Shift+P` — PDF
- `Alt+Shift+Z` — ZIP

Customize at `chrome://extensions/shortcuts`

### Context Menu

Right-click any page to access capture options.

## Formats

| Format | Description |
|--------|-------------|
| HTML | Self-contained with embedded resources |
| MHTML | Web archive format |
| ZIP | Structured archive with separate files |
| PDF | Print-ready document |

## Settings

| Setting | Default |
|---------|---------|
| Inline Resources | On |
| Include Scripts | On |
| Include Styles | On |
| Remove Tracking | Off |
| Preserve Forms | Off |
| Timeout | 10s |
| Max Size | 5MB |

## Structure

```
scrappy/
├── manifest.json
├── background/
│   └── service-worker.js
├── content/
│   └── content-script.js
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── core/
│   ├── types.js
│   ├── utils.js
│   ├── memoize.js
│   ├── circuit-breaker.js
│   ├── dead-letter-queue.js
│   ├── resource-fetcher.js
│   ├── html-processor.js
│   └── diff.js
└── exporters/
    ├── html-exporter.js
    ├── mhtml-exporter.js
    ├── zip-exporter.js
    └── pdf-exporter.js
```

## Permissions

- `activeTab` — Access current tab on click
- `scripting` — DOM serialization
- `storage` — Save preferences
- `downloads` — Save files
- `debugger` — PDF generation

## Limitations

- Cannot capture `chrome://` or `file://` URLs
- Some CORS-blocked resources skipped
- Dynamic content may be incomplete

## License

MIT
