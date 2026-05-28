# NeoSmartpen → Stroke Bridge

A desktop Electron app for capturing, transcribing, and managing handwritten notes from NeoSmartpen (Lamy Safari) devices. Strokes and transcriptions are saved as plain JSON files in a user-chosen local folder.

> **v2.0 (May 2026):** Replaced LogSeq as the storage backend with local JSON files. See [docs/LOCAL-STORAGE-PIVOT-SPEC.md](docs/LOCAL-STORAGE-PIVOT-SPEC.md). The repo name still says `smartpen-logseq-bridge` for git-history continuity; the product is now just the Smartpen Bridge.

## Quick Start

1. **Build the desktop app** (`npm install && npm run electron:build:win`) or run it directly with `npm run dev`
2. Open Settings → **Data Folder**, pick a folder (e.g. `Documents/stroke-data`)
3. Click **Connect Pen** and pair your Lamy smartpen via Bluetooth
4. Write on Ncode paper and watch strokes appear on canvas in real-time
5. Click **Save** — your strokes land at `<dataRoot>/pages/B###/P##.json`
6. (Optional) For transcription, add your own MyScript API keys in Settings (free tier: 2,000 requests/month)

## ✨ Key Features

### Real-Time Pen Integration
- **Bluetooth Connection**: Direct connection to NeoSmartpen via Web Bluetooth API
- **Live Stroke Capture**: See strokes appear on canvas as you write on Ncode paper
- **Offline Sync**: Download notes stored in pen memory with progress tracking
- **Multi-Page Support**: Automatic page detection and organization
- **Battery & Memory Monitoring**: Real-time status updates

### Advanced Stroke Manipulation
- **Duplicate Strokes** (Ctrl+D): Copy selected strokes with automatic positioning
- **Drag & Drop**: Move duplicated strokes freely across canvas
- **Box Selection**: Powerful selection with multiple modes (replace/add/remove)
  - Plain drag: Replace selection
  - Ctrl+drag: Add to selection
  - Shift+drag: Remove from selection
- **Individual Selection**: Ctrl/Shift+click to toggle individual strokes
- **Smart Filtering**: Automatically detect and filter decorative elements (boxes, underlines, circles)
- **Undo System**: Revert deletions with full undo support

### Intelligent Page Management
- **Custom Page Positioning**: Drag page labels to reposition pages anywhere on canvas
- **Page Scaling**: Resize pages 25-500% with corner handle dragging
  - Free resize: Plain drag
  - Aspect ratio locked: Shift+drag
- **Multi-Page Filtering**: Show/hide specific pages with page selector
- **Automatic Layout**: Smart default positioning with reset capability
- **Page-Locked Strokes**: Original strokes stay with their pages during repositioning

### Handwriting Recognition (MyScript)
- **Page-by-Page Transcription**: Process strokes with progress tracking
- **Selective Processing**: Transcribe only selected strokes or specific pages
- **Line Detection**: Intelligent line grouping based on MyScript analysis
- **Hierarchy Analysis**: Automatic indentation detection for nested structure
- **Command Recognition**: Extract inline commands like `[page: Meeting Notes]`
- **Dual Sources**: View transcriptions from both MyScript and LogSeq imports

### LogSeq Integration
- **Database Scanner**: Browse and search existing LogSeq pages
- **Selective Import**: Import specific pages from LogSeq database
- **Smart Storage**: Efficient chunked storage (200 strokes per block)
- **Conflict Resolution**: Overwrite or append when page already exists
- **Sync Tracking**: Visual indicators for saved/synced pages
- **Book Aliases**: Custom naming for notebook identifiers

### Advanced Canvas Features
- **Pan & Zoom**: Alt+drag to pan, Ctrl+scroll to zoom
- **Text View Mode**: Toggle between stroke view and transcribed text
- **Export Options**: Save as SVG or JSON
- **Visual Feedback**: Color-coded borders for different books/pages
- **Selection Indicators**: Clear visual feedback for selected elements
- **Hover Cursors**: Contextual cursors for different interactions

### Data Explorer & Search
- **Four-Tab Interface**:
  - **Strokes Tab**: Browse strokes by book and page with collapsible headers
  - **Transcription Tab**: View transcribed text with hierarchy
  - **LogSeq DB Tab**: Explore saved pages with lazy import
  - **Analysis Tab**: Raw JSON inspection and statistics
- **Search Transcripts**: Full-text search across all transcribed pages in LogSeq
- **Activity Log**: Real-time feedback on all operations
- **Storage Stats**: Track saved pages and sync status

### Professional Workflow Support
- **Create New Pages**: Convert duplicated strokes to new LogSeq pages
- **Coordinate Normalization**: Automatic anchor point calculation
- **Batch Operations**: Process multiple pages efficiently
- **Persistent Settings**: MyScript keys, LogSeq config, UI state
- **Error Recovery**: Graceful handling of connection issues
- **Progress Tracking**: Visual feedback for long operations

## Prerequisites

### For Using the Live Demo
1. **Chrome or Edge browser** (Firefox doesn't support Web Bluetooth)
2. **HTTPS connection** (provided automatically by GitHub Pages)
3. **NeoSmartpen** with Bluetooth capability (Lamy Safari / NWP-F80 tested)
4. **Ncode paper** for the pen to track positions
5. **LogSeq desktop app** with HTTP API enabled (optional, for integration)
6. **MyScript Developer Account** for handwriting recognition (free tier: 2,000 requests/month)

### For Local Development
1. **Chrome or Edge browser** (Firefox doesn't support Web Bluetooth)
2. **Node.js 18+** installed
3. All of the above items from "Using the Live Demo"

## Setup

### Option 1: Use the Live Demo (Recommended for Most Users)

Simply visit the demo URL in Chrome or Edge. No installation required!

Skip to **Step 3** below to configure MyScript API keys.

### Option 2: Run Locally

#### 1. Install Dependencies

```bash
cd smartpen-logseq-bridge
npm install
```

#### 2. Start the Development Server

```bash
npm run dev
```

This opens the app at `http://localhost:3000` (configured in vite.config.js)

> **Note:** Local development must use `localhost` (not `127.0.0.1`) for Web Bluetooth to work properly.

### 3. Configure MyScript API

1. Create an account at [MyScript Developer](https://developer.myscript.com/)
2. Create a new application
3. Copy your **Application Key** and **HMAC Key**
4. Click the **⚙️ Settings** dropdown in the app header
5. Enter your keys in the **MyScript Settings** section
6. Click **Test Keys** to verify

### 4. Enable LogSeq HTTP API (Optional)

1. Open LogSeq
2. Go to **Settings** > **Advanced**
3. Enable **Developer mode**
4. Enable **HTTP APIs server** (default port: 12315)
5. Optionally set an authorization token
6. In the bridge app, click **⚙️ Settings** and configure LogSeq connection

### 5. Connect Your Pen

1. Turn on your Lamy smartpen
2. Click **Connect Pen** in the bridge app
3. Select your pen from the Bluetooth dialog
4. If prompted, enter your pen's password (4 digits)
5. Wait for authorization confirmation

## Usage Guide

### Basic Workflow

#### 1. Capture Strokes

**Real-time Writing:**
- Write on Ncode paper with pen connected
- Strokes appear instantly on canvas
- Multiple pages detected automatically
- Pages shown with colored borders and labels (e.g., "B3017 / P42")

**Offline Sync:**
- Click **Fetch Stored Notes** to download from pen memory
- Progress bar shows transfer status
- All pages loaded onto canvas automatically

#### 2. Select & Filter

**Box Selection:**
- Drag to create selection rectangle
- All intersecting strokes are selected
- Hold Ctrl to add to selection
- Hold Shift to toggle selection

**Page Filtering:**
- Use Page Selector dropdown to choose visible pages
- Select multiple pages (Ctrl+click)
- "Select All" / "Deselect All" buttons
- Filtered view shows only selected pages

**Smart Filtering:**
- Click **🎨 Deselect Decorative** to filter boxes, underlines, circles
- Automatic detection of non-text elements
- Helps focus on actual content

#### 3. Transcribe

**MyScript Transcription:**
1. Select strokes to transcribe (or leave all selected for full page)
2. Click **Transcribe** button
3. Progress modal shows page-by-page status
4. Results appear in **Transcription** tab
5. Hierarchy and indentation automatically detected

**View Results:**
- Switch to **Transcription** tab in left panel
- Expand page cards to see transcribed text
- View hierarchy with indentation
- Check detected commands

#### 4. Manipulate Strokes

**Duplicate & Arrange:**
1. Select strokes you want to work with
2. Press Ctrl+D (or click **🔄 Duplicate**)
3. Duplicated strokes appear in green with slight offset
4. Drag duplicated strokes to reposition
5. Box select multiple duplicates to move as group

**Create New Pages:**
1. Select duplicated strokes you want to save
2. Click **📄 Save as Page (N)**
3. Dialog shows autocomplete for book/page numbers
4. Enter book and page numbers
5. Handle conflicts (overwrite or append if page exists)
6. Converted strokes appear as regular page
7. Remaining duplicates stay for further work

#### 5. Page Management

**Reposition Pages:**
- Drag the "B#/P#" label to move entire page
- Custom positions saved and persist across sessions
- Click **📐 Reset Layout** to return to automatic arrangement

**Resize Pages:**
- Drag corner handle at bottom-right of page border
- Plain drag: Free resize
- Shift+drag: Maintain aspect ratio
- Scale shown in page label (e.g., "150%")
- Click **📏 Reset Sizes** to return to 100%
- Top-left corner stays anchored during resize

#### 6. Save to LogSeq

**Selective Saving:**
- **With selection**: Only saves pages containing selected strokes
- **Without selection**: Saves all visible pages

**Process:**
1. Ensure LogSeq is connected (green indicator)
2. Click **Save to LogSeq** in header
3. Confirmation dialog shows pages to be saved
4. Activity log shows progress
5. Storage status updated with success count

**What Gets Saved:**
- Raw stroke data (for later re-import)
- Transcribed text (if available)
- Hierarchical structure with indentation
- Page metadata (book, page, timestamps)

### Advanced Features

#### LogSeq Database Integration

**Scan Database:**
1. Connect to LogSeq
2. Click **Refresh** in **LogSeq DB** tab
3. Scanner finds all smartpen pages
4. View organized by book with page counts

**Import Pages:**
- Click **Lazy Import** on any page card
- Imports strokes without re-transcription
- Preserves existing transcription text
- View imported strokes on canvas

**Search Transcripts:**
1. Click **🔍 Search Transcripts** in canvas header
2. Enter search term
3. Results show matching text with context
4. Click result to view full page
5. Click **View Strokes** to load onto canvas

#### Text View Mode

**Toggle Views:**
- Click **📝 Show Text** in canvas header
- Displays transcribed text within page boundaries
- Combines MyScript and LogSeq transcriptions
- Click **✏️ Show Strokes** to return to stroke view

**Requirements:**
- Pages must have transcription data
- Either from MyScript or LogSeq imports
- Warning shown if no transcriptions available

#### Book Aliases

**Custom Naming:**
1. Click **⚙️ Settings** dropdown
2. Go to **Book Aliases** section
3. Enter book number and custom name
4. Aliases appear throughout UI
5. Example: "3017" → "Meeting Notes"

### Canvas Navigation

**Mouse Controls:**
- **Alt+drag** or **Middle-click drag**: Pan canvas
- **Ctrl+scroll**: Zoom in/out
- **Scroll**: Pan vertically/horizontally
- **Fit button**: Auto-fit all strokes in view
- **Reset button**: Return to default view (100% zoom)

**Keyboard Shortcuts:**
- **Ctrl+A** (Cmd+A): Select all visible strokes
- **Ctrl+D** (Cmd+D): Duplicate selected strokes
- **Delete**: Delete selected duplicated strokes
- **Escape**: Cancel box selection, clear duplicated selection, or cancel resize

**Selection Modes:**
- **Click**: Select single stroke (replace selection)
- **Ctrl+click**: Toggle individual stroke
- **Shift+click**: Remove stroke from selection
- **Drag**: Box select (replace)
- **Ctrl+drag**: Box select (add)
- **Shift+drag**: Box select (toggle)

### Export Options

**SVG Export:**
- Click **SVG** button in canvas controls
- Exports visible strokes as scalable vector graphics
- Preserves all stroke details
- Perfect for archiving or sharing

**JSON Export:**
- Click **JSON** button in canvas controls
- Exports raw stroke data
- Includes all metadata and dot arrays
- For programmatic analysis or backup

## Data Structure

### Stroke Format
```javascript
{
  pageInfo: {
    section: number,      // Ncode section
    owner: number,        // Ncode owner
    book: number,         // Notebook ID
    page: number          // Page number
  },
  startTime: number,      // Unix timestamp (ms)
  endTime: number,        // Unix timestamp (ms)
  dotArray: [
    { 
      x: number,          // Ncode X coordinate
      y: number,          // Ncode Y coordinate  
      f: number,          // Pressure (force)
      timestamp: number   // Dot timestamp (ms)
    }
  ]
}
```

### Transcription Result
```javascript
{
  text: "Full transcribed text with\nline breaks",
  strokeCount: number,
  pageInfo: { section, owner, book, page },
  lines: [
    {
      text: "Line content",
      indentLevel: 0,        // 0, 1, 2, etc.
      parent: null,          // Index of parent line
      children: [1, 2],      // Indices of child lines
      x: 10.5,               // Leftmost position
      baseline: 25.3,        // Y position
      words: [...]           // Word-level data
    }
  ],
  commands: [
    { 
      command: "page", 
      value: "Meeting Notes", 
      lineIndex: 0 
    }
  ]
}
```

### LogSeq Storage Format
```
smartpen/B3017/P42
  properties::
    book:: 3017
    page:: 42
    section:: 3
    owner:: 1012
    timestamp:: 2024-12-22T10:30:00Z
    stroke-count:: 247
  
  transcription:: This is the transcribed text
  with multiple lines and proper indentation
  preserving the hierarchy from handwriting
  
  stroke-data:: [JSON array of stroke objects]
```

## Architecture

### System Overview
```
┌──────────────┐     BLE      ┌─────────────────┐     HTTP      ┌──────────────┐
│  NeoSmartpen │ ───────────► │  Bridge App     │ ────────────► │   LogSeq     │
│  (Lamy F80)  │              │  (Svelte 4)     │               │   HTTP API   │
└──────────────┘              │   ┌──────────┐  │               └──────────────┘
                              │   │ MyScript │  │                       │
                              │   │ Cloud API│  │                       │
                              │   └──────────┘  │                       │
                              └─────────────────┘                       │
                                      ▲                                  │
                                      └──────────────────────────────────┘
                                            Database Scanner
```

### Component Architecture
```
App.svelte (Root)
├── Header
│   ├── PenControls (Connect, Fetch, Transcribe)
│   ├── ActionBar (Save to LogSeq, Clear)
│   └── SettingsDropdown (MyScript, LogSeq, Book Aliases)
├── LeftPanel
│   ├── Data Explorer (Tabbed Interface)
│   │   ├── StrokeList (Browse by book/page)
│   │   ├── TranscriptionView (View transcribed text)
│   │   ├── LogSeqDbTab (Database browser)
│   │   └── RawJsonViewer (Technical inspection)
│   └── ActivityLog (Real-time feedback)
└── StrokeCanvas
    ├── Canvas Renderer (Drawing engine)
    ├── CanvasControls (Zoom, fit, reset)
    ├── PageSelector (Multi-page filtering)
    └── FilteredStrokesPanel (Decorative strokes)
```

### State Management (Svelte Stores)

**Core Data:**
- `strokes` - All captured strokes
- `pages` - Page organization map
- `selection` - Selected stroke indices
- `clipboard` - Copied strokes
- `pastedStrokes` - Duplicated/pasted strokes

**Transcription:**
- `lastTranscription` - Most recent MyScript result
- `pageTranscriptions` - Per-page transcription cache
- `transcriptionByPage` - Organized transcription data

**LogSeq:**
- `logseqPages` - Scanned database pages
- `storage` - Save status tracking
- `bookAliases` - Custom book names

**UI State:**
- `activeTab` - Current data explorer tab
- `canvasZoom` - Zoom level
- `pagePositions` - Custom page layout
- `pageScales` - Per-page scaling factors
- `logMessages` - Activity log entries

**Advanced:**
- `filteredStrokes` - Decorative elements
- `pendingChanges` - Undo system
- `deletedIndices` - Soft-delete tracking

## Project Structure

```
smartpen-logseq-bridge/
├── index.html              # Entry HTML
├── src/
│   ├── App.svelte          # Root Svelte component
│   ├── main-svelte.js      # Application entry point
│   │
│   ├── components/         # Svelte 4 components
│   │   ├── canvas/         # Canvas and rendering
│   │   │   ├── StrokeCanvas.svelte
│   │   │   ├── CanvasControls.svelte
│   │   │   └── PageSelector.svelte
│   │   ├── dialog/         # Modal dialogs
│   │   │   ├── CreatePageDialog.svelte
│   │   │   ├── SaveConfirmDialog.svelte
│   │   │   ├── SearchTranscriptsDialog.svelte
│   │   │   └── BookSelectionDialog.svelte
│   │   ├── header/         # Top bar components
│   │   │   ├── ActionBar.svelte
│   │   │   └── SettingsDropdown.svelte
│   │   ├── layout/         # App layout
│   │   │   ├── Header.svelte
│   │   │   ├── LeftPanel.svelte
│   │   │   ├── Sidebar.svelte
│   │   │   └── ActivityLog.svelte
│   │   ├── logseq-db/      # Database browser
│   │   │   ├── LogSeqDbTab.svelte
│   │   │   ├── BookAccordion.svelte
│   │   │   ├── PageCard.svelte
│   │   │   └── SyncStatusBadge.svelte
│   │   ├── pen/            # Pen controls
│   │   │   ├── PenControls.svelte
│   │   │   ├── PenInfo.svelte
│   │   │   └── TransferProgress.svelte
│   │   ├── settings/       # Configuration
│   │   │   ├── MyScriptSettings.svelte
│   │   │   ├── LogseqSettings.svelte
│   │   │   └── BookAliasManager.svelte
│   │   ├── strokes/        # Stroke browser
│   │   │   ├── StrokeList.svelte
│   │   │   ├── StrokePageCard.svelte
│   │   │   ├── StrokeItem.svelte
│   │   │   ├── FilteredStrokesPanel.svelte
│   │   │   ├── AnalysisView.svelte
│   │   │   └── RawJsonViewer.svelte
│   │   └── transcription/  # Transcription display
│   │       ├── TranscriptionView.svelte
│   │       ├── HierarchyTree.svelte
│   │       ├── LogseqPreview.svelte
│   │       └── CommandList.svelte
│   │
│   ├── stores/             # Svelte stores (state)
│   │   ├── strokes.js      # Stroke data
│   │   ├── selection.js    # Selection state
│   │   ├── pen.js          # Pen connection
│   │   ├── transcription.js # Transcription results
│   │   ├── settings.js     # Persisted settings
│   │   ├── ui.js           # UI state
│   │   ├── storage.js      # LogSeq storage tracking
│   │   ├── logseqPages.js  # Database scan results
│   │   ├── bookAliases.js  # Book name mappings
│   │   ├── clipboard.js    # Copy/paste
│   │   ├── pastedStrokes.js # Duplicated strokes
│   │   ├── pageOrder.js    # Custom page positions
│   │   ├── pageScale.js    # Page scaling
│   │   ├── filteredStrokes.js # Decorative filtering
│   │   └── pendingChanges.js  # Undo system
│   │
│   ├── lib/                # Business logic
│   │   ├── pen-sdk.js      # NeoSmartpen SDK wrapper
│   │   ├── canvas-renderer.js # Canvas drawing engine
│   │   ├── myscript-api.js # MyScript API client
│   │   ├── logseq-api.js   # LogSeq API client
│   │   ├── logseq-scanner.js # Database scanning
│   │   ├── logseq-import.js  # Page import logic
│   │   ├── stroke-analyzer.js # Shape detection
│   │   ├── stroke-filter.js   # Decorative detection
│   │   ├── stroke-storage.js  # Storage utilities
│   │   └── transcript-search.js # Search engine
│   │
│   └── utils/              # Helpers
│       ├── logger.js       # Console logging
│       ├── storage.js      # LocalStorage helpers
│       └── formatting.js   # Text/number formatting
│
├── electron/               # Electron desktop app wrapper
│
├── docs/                   # Documentation
│   ├── app-specification.md
│   ├── TRANSCRIPT-STORAGE-SPEC.md
│   ├── bridge-uuid-system.md
│   ├── bullet-journal-spec.md
│   ├── logseq-markup-converter-spec.md
│   ├── temporal-data-specification.md
│   ├── implementation-logs/
│   ├── proposals/
│   └── Archive/            # Archived implementation docs
│
├── package.json
├── vite.config.js
└── README.md
```

## Documentation

- **[App Specification](docs/app-specification.md)**: Complete technical documentation of the system architecture, data flows, and APIs.

- **[Transcript Storage Spec](docs/TRANSCRIPT-STORAGE-SPEC.md)**: v3.0 transcript storage system architecture, data flows, and known issues.

- **[Bridge UUID System](docs/bridge-uuid-system.md)**: Custom UUID system for stroke-to-block tracking.

- **[Bullet Journal Detection](docs/bullet-journal-spec.md)**: Specification for future bullet journal symbol detection (checkboxes, circles, dashes).

- **[Temporal Data](docs/temporal-data-specification.md)**: Specification for leveraging temporal metadata for advanced analysis.

- **[LogSeq Markup Converter](docs/logseq-markup-converter-spec.md)**: Specification for markup conversion between formats.

- **[Archive Index](docs/Archive/ARCHIVE-INDEX.md)**: Index of all archived implementation documentation.

## Troubleshooting

### Connection Issues

**"Cannot connect to pen"**
- Ensure Bluetooth is enabled on your computer
- Turn the pen off and on again
- Use Chrome or Edge (not Firefox)
- Check that no other app is connected to the pen
- Try removing the pen from Bluetooth devices and re-pairing

**"Connection timeout"**
- Pen may be in low battery mode
- Check battery level in pen info display
- Move closer to computer (within 10 meters)
- Avoid obstacles between pen and computer

### LogSeq Integration

**"Cannot connect to LogSeq"**
- Verify LogSeq is running
- Check that HTTP API is enabled in LogSeq settings
- Confirm the port (default: 12315)
- If using a token, ensure it's entered correctly in settings
- Try clicking "Test Connection" to diagnose

**"Pages not appearing in database"**
- Click "Refresh" in LogSeq DB tab to re-scan
- Check that pages exist under `smartpen/` namespace
- Verify pages have `stroke-data` property
- Scanner looks for format: `smartpen/B###/P##`

### MyScript Issues

**"MyScript authentication failed"**
- Verify Application Key and HMAC Key are correct
- Check that your MyScript application is activated
- Ensure Text recognition is enabled in MyScript dashboard
- Free tier allows 2,000 requests/month (check quota)
- Click "Test Keys" to verify credentials

**"Transcription returns no text"**
- Ensure strokes form readable writing
- Check that strokes are not too small
- Try transcribing fewer strokes at once
- MyScript requires minimum stroke density

### Canvas Issues

**"No strokes appear after writing"**
- Make sure you're using Ncode paper
- Check the pen tip is working (LED should blink while writing)
- Verify pen is connected (green indicator)
- Try fetching offline data to test connection
- Check that page filter includes the page you wrote on

**"Box selection not working"**
- Make sure you drag at least 5 pixels (small movements are treated as clicks)
- Use Alt+drag for panning, not plain drag
- Ctrl/Shift+drag modifies selection instead of replacing

**"Page positioning seems wrong"**
- Click "Reset Layout" to return to automatic positioning
- Custom positions are saved - clear them if needed
- Check that you're not accidentally dragging page labels

**"Strokes appear in wrong location"**
- This can happen when pen data has incorrect section/owner
- Try importing from LogSeq which fuzzy-matches by book/page
- Check that Ncode paper matches pen's notebook configuration

### Performance Issues

**"Canvas is slow with many strokes"**
- Use page filtering to show only relevant pages
- Clear old strokes you no longer need
- Export and archive completed notes
- Browser may struggle with >2000 strokes visible

**"Transcription takes too long"**
- Processing is page-by-page, so multiple pages take time
- MyScript API has rate limits
- Network latency affects performance
- Consider transcribing selected strokes only

### Data Issues

**"Duplicate strokes appearing"**
- This can happen if same strokes imported multiple times
- Use LogSeq scanner to check what's already saved
- Clear strokes and re-import if needed
- Check activity log for double-save operations

**"Lost my work after refresh"**
- Strokes are not persisted unless saved to LogSeq
- MyScript transcriptions are cached but may expire
- Custom page positions and scales are saved to localStorage
- Always save to LogSeq for permanent storage

## Deployment

### Deploy to GitHub Pages

The app is configured for automatic deployment to GitHub Pages using GitHub Actions.

#### Initial Setup

1. **Push your repository to GitHub** (if not already done):
   ```bash
   git add .
   git commit -m "Add GitHub Pages deployment"
   git push origin main
   ```

2. **Enable GitHub Pages in repository settings**:
   - Go to your repository on GitHub
   - Navigate to **Settings** → **Pages**
   - Under "Source", select **GitHub Actions** (not "Deploy from a branch")
   - Save the changes

3. **Wait for deployment** (2-3 minutes):
   - Go to the **Actions** tab in your repository
   - Watch the "Deploy to GitHub Pages" workflow run
   - Once complete, your app will be live!

4. **Access your deployed app**:
   - Visit `https://yourusername.github.io/smartpen-logseq-bridge/`
   - Replace `yourusername` with your actual GitHub username

#### Automatic Updates

After the initial setup, every push to the `main` branch will automatically trigger a new deployment. No manual intervention needed!

#### Manual Deployment

You can also manually trigger a deployment:
- Go to **Actions** tab in your repository
- Select the "Deploy to GitHub Pages" workflow
- Click **Run workflow**
- Choose the branch (usually `main`)
- Click **Run workflow**

#### Local Preview of Production Build

Before deploying, you can test the production build locally:

```bash
npm run build
npm run preview
```

This will build and serve the app exactly as it will appear on GitHub Pages.

### Important Notes for GitHub Pages Deployment

- **HTTPS is automatic**: GitHub Pages provides HTTPS by default, which is required for Web Bluetooth
- **Base path is configured**: The app is configured to work at `/smartpen-logseq-bridge/` path
- **LogSeq must be local**: Users will need LogSeq running locally with HTTP API enabled
- **MyScript keys**: Users should use their own MyScript API keys for production use
- **Browser requirements**: Only Chrome and Edge support Web Bluetooth

## Development Roadmap

### Completed ✅
- [x] Pen connection and real-time capture
- [x] Offline note sync with progress tracking
- [x] Handwriting transcription (MyScript)
- [x] Line detection with hierarchy
- [x] Indentation analysis
- [x] LogSeq HTTP API integration
- [x] Complete Svelte 4 migration
- [x] Box selection with multiple modes (replace/add/toggle)
- [x] Individual stroke toggle selection
- [x] Keyboard shortcuts (Ctrl+A, Ctrl+D, Delete, Escape)
- [x] Pan and zoom controls
- [x] Selective transcription (selected strokes only)
- [x] Selective LogSeq saving (selected pages only)
- [x] Real-time transcription progress modal
- [x] Multi-page canvas visualization with colored borders
- [x] Page-organized stroke browser with collapsible headers
- [x] Drag page labels to reposition pages
- [x] Drag corner handles to resize pages (with aspect ratio lock)
- [x] Duplicate strokes (Ctrl+D)
- [x] Create new pages from duplicated strokes
- [x] LogSeq database scanner and browser
- [x] Import pages from LogSeq with transcriptions
- [x] Full-text search across transcribed pages
- [x] Text view mode (toggle between strokes and text)
- [x] Book aliases for custom naming
- [x] Decorative stroke detection and filtering
- [x] Activity log with real-time feedback
- [x] Undo system for deletions
- [x] Conflict resolution (overwrite/append)
- [x] Storage tracking and sync indicators

### In Progress 🔄
- [x] Electron desktop app conversion
- [ ] Bullet journal symbol detection (`☐`, `○`, `–`)
- [ ] State detection for tasks (complete/migrated/cancelled)

### Planned 📋
- [ ] Temporal data features (session detection, writing analytics)
- [ ] Enhanced command processing (`[project:]`, `[sketch:]`)
- [ ] Custom Ncode paper templates
- [ ] Selection history (undo/redo for selections)
- [ ] Lasso/freehand selection
- [ ] Smart selection (by time, properties)
- [ ] Export to PDF with proper formatting
- [ ] Collaborative features (share pages)
- [ ] Mobile app version
- [ ] Cloud backup for strokes

## Tech Stack

- **Frontend Framework**: Svelte 4 (reactive components)
- **Build Tool**: Vite (fast development and optimized builds)
- **Pen Integration**: web_pen_sdk (NeoSmartpen Web SDK)
- **Handwriting Recognition**: MyScript Cloud API
- **Knowledge Management**: LogSeq HTTP API
- **Browser APIs**: Web Bluetooth API, Canvas API
- **State Management**: Svelte stores (writable, derived, custom)
- **Storage**: LocalStorage (settings, layout, cache)

## Browser Compatibility

| Feature | Chrome | Edge | Firefox | Safari |
|---------|--------|------|---------|--------|
| Web Bluetooth | ✅ | ✅ | ❌ | ❌ |
| Canvas Rendering | ✅ | ✅ | ✅ | ✅ |
| LocalStorage | ✅ | ✅ | ✅ | ✅ |
| HTTPS Required | ✅ | ✅ | N/A | N/A |

**Recommendation**: Use Chrome or Edge for full functionality. Firefox and Safari do not support Web Bluetooth API.

## Performance Characteristics

- **Real-time capture**: <50ms latency per stroke
- **Offline sync**: ~200 strokes/second transfer rate
- **Transcription**: ~5-10 seconds per page (MyScript API)
- **LogSeq save**: ~1 second per page (local HTTP)
- **Canvas render**: 60 FPS with up to 1000 visible strokes
- **Database scan**: ~100 pages/second
- **Memory usage**: ~50-100MB typical, scales with stroke count

## License

MIT

## Credits

- [NeoSmartpen Web SDK](https://github.com/NeoSmartpen/WEB-SDK2.0) - Pen communication
- [MyScript](https://www.myscript.com/) - Handwriting recognition
- [LogSeq](https://logseq.com/) - Knowledge management platform
- [Svelte](https://svelte.dev/) - UI framework
- [Vite](https://vitejs.dev/) - Build tooling

## Contributing

This is an actively developed project for integrating handwritten notes into LogSeq-based workflows. Contributions, bug reports, and feature suggestions are welcome!

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

### Development Guidelines

- Follow existing code style and patterns
- Use Svelte stores for state management
- Keep components focused and single-purpose
- Add comments for complex logic
- Update documentation for user-facing changes
- Test with real pen hardware when possible

## Support

For issues, questions, or feature requests:
- Open an issue on GitHub
- Check existing documentation in `/docs`
- Review troubleshooting section above
- Consult MyScript and LogSeq documentation for integration issues

## Version History

- **0.3.0** (Current) - Electron desktop app + transcript improvements
  - Electron desktop app conversion
  - Transcript data loss fixes (Y-bounds, blockUuid preservation)
  - Hierarchical block creation order fix
  - BlockUUID assignment bug fix
  - Transcript storage v3.0 architecture

- **0.2.0** - Major feature release
  - Complete Svelte 4 migration
  - Advanced stroke manipulation (duplicate, drag, create pages)
  - LogSeq database integration (scan, search, import)
  - Page positioning and scaling
  - Text view mode
  - Book aliases
  - Decorative stroke filtering
  - Undo system
  - Enhanced UI with activity log

- **0.1.0** - Initial release
  - Basic pen connection
  - Real-time and offline capture
  - MyScript transcription
  - Simple LogSeq integration
  - Canvas with basic selection

---

**Made with ❤️ for note-takers who value both handwriting and digital organization**
