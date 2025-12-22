# NeoSmartpen → LogSeq Bridge

A bridge application for syncing handwritten notes from NeoSmartpen (Lamy Safari) to LogSeq, featuring handwriting recognition via MyScript.

## 🚀 Live Demo

**Try it now:** [https://yourusername.github.io/smartpen-logseq-bridge/](https://yourusername.github.io/smartpen-logseq-bridge/)

> **Note:** Replace `yourusername` with your actual GitHub username once deployed.

### Quick Start (No Installation Required)
1. Open the live demo in **Chrome or Edge browser** (required for Web Bluetooth)
2. Click **Connect Pen** and pair your Lamy smartpen
3. Write on Ncode paper and watch strokes appear in real-time
4. For transcription, you'll need your own MyScript API keys (free tier available)
5. For LogSeq integration, ensure LogSeq desktop app is running locally with HTTP API enabled

## Features

### Core Features
- **Bluetooth Connection**: Connect to your Lamy smartpen via Web Bluetooth API
- **Real-time Preview**: See strokes as you write on the canvas
- **Offline Sync**: Download stored notes from the pen's memory
- **Box Selection**: Drag to select multiple strokes with multiple modes
- **Shape Detection**: Automatically detect rectangles/boxes drawn around content
- **SVG Export**: Export drawings as scalable vector graphics
- **JSON Export**: Export stroke data for analysis or backup

### Handwriting Recognition (MyScript)
- **Selective Transcription**: Transcribe only selected strokes or all strokes
- **Progress Tracking**: Real-time progress modal showing page-by-page transcription status
- **Text Transcription**: Convert handwritten strokes to text using MyScript Cloud API
- **Line Detection**: Intelligent line grouping that trusts MyScript's recognition
- **Indentation Analysis**: Automatic detection of hierarchical structure
- **Hierarchy Building**: Parent/child relationships based on indentation
- **LogSeq Preview**: See how transcribed notes will appear in LogSeq

### LogSeq Integration
- **Selective Saving**: Save only pages containing selected strokes, or all pages if none selected
- **HTTP API Connection**: Send notes directly to LogSeq
- **Block Structure**: Preserves indentation as nested blocks
- **Command Detection**: Recognize inline commands like `[page: Meeting Notes]`

### Data Explorer
- **Strokes Tab**: Browse strokes organized by page with collapsible headers
  - Expandable page groups showing stroke counts
  - Selection indicators showing selected/total strokes per page
  - Smooth scrolling through all pages and strokes
- **Transcription Tab**: View transcription results with hierarchy visualization
- **LogSeq DB Tab**: Browse previously saved data in LogSeq
- **Raw JSON Tab**: Inspect raw stroke data for debugging

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

Simply visit [https://yourusername.github.io/smartpen-logseq-bridge/](https://yourusername.github.io/smartpen-logseq-bridge/) in Chrome or Edge. No installation required!

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

#### 3. Configure MyScript API

1. Create an account at [MyScript Developer](https://developer.myscript.com/)
2. Create a new application
3. Copy your **Application Key** and **HMAC Key**
4. Enter these in the app's MyScript settings panel
5. Click **Test Keys** to verify

### 4. Enable LogSeq HTTP API (Optional)

1. Open LogSeq
2. Go to **Settings** > **Advanced**
3. Enable **Developer mode**
4. Enable **HTTP APIs server** (default port: 12315)
5. Optionally set an authorization token

### 5. Connect Your Pen

1. Turn on your Lamy smartpen
2. Click **Connect Pen** in the bridge app
3. Select your pen from the Bluetooth dialog
4. If prompted, enter your pen's password (4 digits)

## Usage

### Canvas Controls & Selection

The canvas provides intuitive ways to select and interact with your strokes:

#### Box Selection (Drag to Select)

**Plain drag** - Click and drag to create a selection rectangle
- All strokes intersecting the box are selected
- Previous selection is cleared
- Perfect for selecting a region of strokes

**Ctrl+drag** - Add to existing selection
- Hold `Ctrl` (or `Cmd` on Mac) while dragging
- New strokes are added without clearing previous selection
- Great for building complex selections across multiple areas

**Shift+drag** - Toggle strokes in selection box
- Hold `Shift` while dragging
- Selected strokes become unselected, unselected become selected
- Useful for refining selections

#### Individual Stroke Selection

- **Click** - Select single stroke (clears all others)
- **Ctrl+click** or **Shift+click** - Toggle individual stroke
  - Adds stroke if not selected
  - Removes stroke if already selected
  - Other selections remain unchanged

#### Canvas Navigation

- **Alt+drag** - Pan the canvas
- **Middle-click drag** - Pan the canvas (alternative)
- **Scroll** - Pan vertically/horizontally
- **Ctrl+scroll** - Zoom in/out
- **Fit button** - Auto-fit all strokes in view

#### Keyboard Shortcuts

- **Ctrl+A** or **Cmd+A** - Select all visible strokes
- **Escape** - Cancel active box selection
- **Click empty space** - Clear all selections

### Real-time Writing

Once connected, write on Ncode paper and see strokes appear on the canvas in real-time.

**Multi-page visualization**: If you write on multiple pages, each page is displayed with:
- Colored borders to distinguish different pages
- Book/Page labels (e.g., "B3017 / P42") positioned above each page region
- Unique colors for easy visual identification

### Offline Sync

1. Click **Fetch Stored Notes** to retrieve notes stored in the pen's memory
2. Notes will be downloaded and rendered on the canvas
3. Stroke count and transcribe button will update automatically

### Handwriting Transcription

**Transcribing Selected Strokes:**
1. Capture strokes (real-time or offline)
2. Select specific strokes using:
   - Box selection (drag to select)
   - Individual selection (Ctrl+click)
   - Page filtering (use page selector to show only certain pages)
3. Click **Transcribe** button
4. A progress modal will appear showing:
   - Current page being transcribed (e.g., "Page 2/5")
   - Book and page numbers
   - Success/error counts
   - Elapsed time
5. View results in the **Transcription** tab

**Transcribing All Strokes:**
- If no strokes are selected, clicking **Transcribe** will process all visible strokes
- Each page is transcribed separately for accurate coordinate handling

**Transcription Results:**
The Transcription tab shows:
- Raw transcribed text
- Lines with hierarchy analysis
- LogSeq-formatted preview
- Detected commands
- Organized by page with expandable cards

### Shape Detection

The app automatically detects hand-drawn rectangles. These can be used to:
- Mark regions of text for specific routing
- Create visual boundaries around related content
- Identify command/action areas on your notes

### Saving to LogSeq

**Selective Saving:**
The "Save to LogSeq" button behavior depends on your selection:

- **With strokes selected**: Only saves pages that contain selected strokes
  - Example: If you select strokes from Page 42 and Page 43, only those two pages are saved
  - Other pages remain unchanged in LogSeq
  - Useful for updating specific pages without re-saving everything

- **No strokes selected**: Saves all pages with stroke data
  - All pages are processed and sent to LogSeq
  - Includes transcription data if available

**What Gets Saved:**
For each page being saved:
1. Raw stroke data (for later import/reference)
2. Transcription text (if transcribed)
3. Hierarchical structure (indentation preserved)
4. Metadata (timestamps, page info)

**LogSeq Page Structure:**
```
smartpen/B3017/P42
  properties::
    book:: 3017
    page:: 42
    timestamp:: 2024-12-22
  
  - First line of transcription
    - Indented child line
  - Second line
  
  stroke-data:: [JSON]
```

### Using the Data Explorer

The left panel contains a tabbed Data Explorer with four views:

**Strokes Tab:**
- Browse all captured strokes organized by page
- Each page group shows:
  - Book and page number (e.g., "B3017 P42")
  - Total stroke count for that page
  - Selection indicator (e.g., "8/42" = 8 of 42 selected)
- Click page headers to expand/collapse stroke lists
- Scroll smoothly through all pages and their strokes
- Click individual strokes to select them on the canvas

**Transcription Tab:**
- View transcription results after running MyScript
- Each transcribed page displays in a card with:
  - Book/page identification
  - Stroke count and word count
  - Hierarchical text with indentation
  - Detected commands highlighted
- Expandable/collapsible for easy navigation

**LogSeq DB Tab:**
- Browse data previously saved to LogSeq
- Click "Refresh" to scan LogSeq database
- Organized by book with expandable page lists
- "Lazy Import" buttons to re-import strokes without re-transcribing
- Useful for retrieving old notes or working offline

**Raw JSON Tab:**
- Technical view of raw stroke data
- Useful for debugging or data analysis
- Copy/export JSON for external processing

## Data Structure

### Stroke Data
```javascript
{
  pageInfo: {
    section: number,  // Ncode section
    owner: number,    // Ncode owner
    book: number,     // Notebook ID
    page: number      // Page number
  },
  startTime: number,  // Unix timestamp (ms)
  endTime: number,    // Unix timestamp (ms)
  dotArray: [
    { x, y, f, timestamp }  // Position, pressure, time
  ]
}
```

### Transcription Result
```javascript
{
  text: "Full transcribed text with\nline breaks",
  lines: [
    {
      text: "Line content",
      indentLevel: 0,      // 0, 1, 2, etc.
      parent: null,        // Index of parent line
      children: [1, 2],    // Indices of child lines
      x: 10.5,             // Leftmost position
      baseline: 25.3       // Y position
    }
  ],
  commands: [
    { command: "page", value: "Meeting Notes", lineIndex: 0 }
  ]
}
```

## Architecture

```
┌──────────────┐     BLE      ┌─────────────────┐     HTTP      ┌──────────────┐
│  NeoSmartpen │ ───────────► │  Bridge App     │ ────────────► │   LogSeq     │
│  (Lamy F80)  │              │                 │               │   HTTP API   │
└──────────────┘              │   ┌──────────┐  │               └──────────────┘
                              │   │ MyScript │  │
                              │   │ Cloud API│  │
                              │   └──────────┘  │
                              └─────────────────┘
```

## Project Structure

```
smartpen-logseq-bridge/
├── index.html              # Entry HTML
├── src/
│   ├── App.svelte          # Root Svelte component
│   ├── main-svelte.js      # Application entry point
│   ├── components/         # Svelte 4 components
│   │   ├── canvas/         # Canvas and rendering
│   │   ├── pen/            # Pen controls and info
│   │   ├── settings/       # MyScript & LogSeq config
│   │   ├── strokes/        # Stroke list and selection
│   │   ├── transcription/  # Transcription display
│   │   └── layout/         # App layout components
│   ├── stores/             # Svelte stores (state)
│   │   ├── strokes.js      # Stroke data
│   │   ├── selection.js    # Selection state
│   │   ├── pen.js          # Pen connection
│   │   ├── transcription.js # Transcription results
│   │   ├── settings.js     # Persisted settings
│   │   └── ui.js           # UI state
│   ├── lib/                # Business logic
│   │   ├── pen-sdk.js      # NeoSmartpen SDK wrapper
│   │   ├── canvas-renderer.js # Canvas drawing engine
│   │   ├── myscript-api.js # MyScript API client
│   │   └── logseq-api.js   # LogSeq API client
│   └── utils/              # Helpers
├── docs/
│   ├── app-specification.md        # Full technical spec
│   ├── line-detection-algorithm.md # Line/indent detection
│   ├── svelte-migration-spec.md    # Architecture docs
│   ├── selection-behavior-final.md # Selection system docs
│   └── box-selection-user-guide.md # Selection user guide
├── package.json
├── vite.config.js
└── README.md
```

## Documentation

- **[Technical Specification](docs/app-specification.md)**: Complete technical documentation of the system architecture, data flows, and APIs.

- **[Line Detection Algorithm](docs/line-detection-algorithm.md)**: Explains how the app determines line boundaries and calculates indentation from MyScript recognition results.

- **[Selection System Guide](docs/selection-behavior-final.md)**: Technical documentation of the selection system including box selection and keyboard shortcuts.

- **[Box Selection User Guide](docs/box-selection-user-guide.md)**: User-facing guide for all selection features and workflows.

- **[Svelte Migration Spec](docs/svelte-migration-spec.md)**: Architecture documentation for the Svelte 4 implementation.

## Troubleshooting

### "Cannot connect to pen"
- Ensure Bluetooth is enabled on your computer
- Turn the pen off and on again
- Use Chrome or Edge (not Firefox)
- Check that no other app is connected to the pen

### "Cannot connect to LogSeq"
- Verify LogSeq is running
- Check that HTTP API is enabled in LogSeq settings
- Confirm the port (default: 12315)
- If using a token, ensure it's entered correctly

### "MyScript authentication failed"
- Verify Application Key and HMAC Key are correct
- Check that your MyScript application is activated
- Ensure Text recognition is enabled in MyScript dashboard
- Free tier allows 2,000 requests/month

### "No strokes appear"
- Make sure you're using Ncode paper
- Check the pen tip is working (LED should blink while writing)
- Try fetching offline data to test the connection

### "Box selection not working"
- Make sure you're dragging at least 5 pixels (small movements are treated as clicks)
- Use Alt+drag for panning, not Shift+drag
- Plain drag selects, Ctrl/Shift+drag modifies selection

### "Words on wrong lines"
- This can happen with common short words ("the", "and", "1")
- The app trusts MyScript's line detection, which is generally accurate
- Future versions will add interactive line adjustment

### "Transcription only processed some of my strokes"
- Check if you have strokes selected (selection count shown in top-right)
- Transcription processes only selected strokes when you have a selection
- To transcribe everything: Clear selection (click empty canvas) then click Transcribe
- You can also use the Page Selector to filter which pages are visible/transcribed

### "Save to LogSeq didn't save all my pages"
- Similar to transcription: Save respects your selection
- With strokes selected: Only saves pages containing those strokes
- To save everything: Clear selection before clicking "Save to LogSeq"
- Check the activity log for confirmation of which pages were saved

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

## Roadmap

### Completed ✅
- [x] Pen connection and real-time capture
- [x] Offline note sync
- [x] Handwriting transcription (MyScript)
- [x] Line detection with hierarchy
- [x] Indentation analysis
- [x] LogSeq preview formatting
- [x] Svelte 4 migration
- [x] Box selection with multiple modes (replace/add/toggle)
- [x] Individual stroke toggle selection
- [x] Keyboard shortcuts (Ctrl+A, Escape)
- [x] Pan and zoom controls
- [x] Selective transcription (selected strokes only)
- [x] Selective LogSeq saving (selected pages only)
- [x] Real-time transcription progress modal
- [x] Multi-page canvas visualization with colored borders
- [x] Page-organized stroke browser with collapsible headers

### In Progress 🔄
- [ ] Command detection and processing (`[page:]`, `[project:]`, etc.)
- [ ] Interactive line guides for manual adjustment

### Planned 📋
- [ ] Direct LogSeq block insertion
- [ ] Custom Ncode paper templates
- [ ] Multi-page document handling
- [ ] Selection history (undo/redo)
- [ ] Lasso/freehand selection
- [ ] Smart selection (by time, color, properties)

## Tech Stack

- **Svelte 4** - UI framework (reactive components)
- **Vite** - Build tool and dev server
- **web_pen_sdk** - NeoSmartpen Web SDK
- **MyScript Cloud API** - Handwriting recognition
- **Web Bluetooth API** - Pen communication
- **Canvas API** - Stroke rendering

## License

MIT

## Credits

- [NeoSmartpen Web SDK](https://github.com/NeoSmartpen/WEB-SDK2.0)
- [MyScript](https://www.myscript.com/) - Handwriting recognition
- [LogSeq](https://logseq.com/)

## Contributing

This is a personal project for integrating handwritten notes into a LogSeq-based workflow. Contributions and suggestions are welcome!

## Quick Reference

### Selection Modes
| Action | Result |
|--------|--------|
| Drag | Select strokes in box (replace) |
| Ctrl+Drag | Add strokes in box to selection |
| Shift+Drag | Toggle strokes in box |
| Click | Select single stroke |
| Ctrl/Shift+Click | Toggle individual stroke |
| Ctrl+A | Select all |
| Escape | Cancel box selection |

### Navigation
| Action | Result |
|--------|--------|
| Alt+Drag | Pan canvas |
| Middle-Click Drag | Pan canvas |
| Scroll | Pan vertically/horizontally |
| Ctrl+Scroll | Zoom in/out |
