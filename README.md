# NeoSmartpen → LogSeq Bridge

A bridge application for syncing handwritten notes from NeoSmartpen (Lamy Safari) to LogSeq, featuring handwriting recognition via MyScript.

## Features

### Core Features
- **Bluetooth Connection**: Connect to your Lamy smartpen via Web Bluetooth API
- **Real-time Preview**: See strokes as you write on the canvas
- **Offline Sync**: Download stored notes from the pen's memory
- **Shape Detection**: Automatically detect rectangles/boxes drawn around content
- **SVG Export**: Export drawings as scalable vector graphics
- **JSON Export**: Export stroke data for analysis or backup

### Handwriting Recognition (MyScript)
- **Text Transcription**: Convert handwritten strokes to text using MyScript Cloud API
- **Line Detection**: Intelligent line grouping that trusts MyScript's recognition
- **Indentation Analysis**: Automatic detection of hierarchical structure
- **Hierarchy Building**: Parent/child relationships based on indentation
- **LogSeq Preview**: See how transcribed notes will appear in LogSeq

### LogSeq Integration
- **HTTP API Connection**: Send notes directly to LogSeq
- **Block Structure**: Preserves indentation as nested blocks
- **Command Detection**: Recognize inline commands like `[page: Meeting Notes]`

## Prerequisites

1. **Chrome or Edge browser** (Firefox doesn't support Web Bluetooth)
2. **Node.js 18+** installed
3. **NeoSmartpen** with Bluetooth capability (Lamy Safari / NWP-F80 tested)
4. **Ncode paper** for the pen to track positions
5. **LogSeq desktop app** with HTTP API enabled (optional)
6. **MyScript Developer Account** for handwriting recognition (free tier: 2,000 requests/month)

## Setup

### 1. Install Dependencies

```bash
cd smartpen-logseq-bridge
npm install
```

### 2. Start the Development Server

```bash
npm run dev
```

This opens the app at `http://localhost:3000`

### 3. Configure MyScript API

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

### Real-time Writing
Once connected, write on Ncode paper and see strokes appear on the canvas in real-time.

### Offline Sync
1. Click **Fetch Stored Notes** to retrieve notes stored in the pen's memory
2. Notes will be downloaded and rendered on the canvas
3. Stroke count and transcribe button will update automatically

### Handwriting Transcription
1. Load strokes (real-time or offline)
2. Optionally select specific strokes (Ctrl+click, Shift+click for range)
3. Click **Transcribe** (transcribes all strokes if none selected)
4. View results in the **Transcription** tab:
   - Raw transcribed text
   - Lines with hierarchy analysis
   - LogSeq-formatted preview
   - Detected commands

### Shape Detection
The app automatically detects hand-drawn rectangles. These can be used to:
- Mark regions of text for specific routing
- Create visual boundaries around related content
- Identify command/action areas on your notes

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
├── index.html              # Main UI
├── src/
│   ├── main.js             # Application entry point
│   ├── state.js            # Global state management
│   ├── elements.js         # DOM element references
│   ├── ui-updates.js       # UI update functions
│   ├── pen-handlers.js     # Pen SDK callbacks
│   ├── button-handlers.js  # Click event handlers
│   ├── transcription-view.js # Transcription display
│   ├── settings.js         # LocalStorage persistence
│   ├── myscript-api.js     # MyScript API client
│   ├── stroke-analyzer.js  # Shape detection
│   ├── canvas-renderer.js  # Stroke rendering
│   ├── logseq-api.js       # LogSeq API client
│   └── logger.js           # Console logging
├── docs/
│   ├── line-detection-algorithm.md  # How line/indent detection works
│   └── svelte-migration-spec.md     # Future Svelte 4 migration plan
├── package.json
├── vite.config.js
└── README.md
```

## Documentation

- **[Line Detection Algorithm](docs/line-detection-algorithm.md)**: Explains how the app determines line boundaries and calculates indentation from MyScript recognition results.

- **[Svelte Migration Spec](docs/svelte-migration-spec.md)**: Detailed plan for migrating to Svelte 4, including component architecture, stores, and implementation phases.

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

### "Words on wrong lines"
- This can happen with common short words ("the", "and", "1")
- The app trusts MyScript's line detection, which is generally accurate
- Future versions will add interactive line adjustment

## Roadmap

### Completed ✅
- [x] Pen connection and real-time capture
- [x] Offline note sync
- [x] Handwriting transcription (MyScript)
- [x] Line detection with hierarchy
- [x] Indentation analysis
- [x] LogSeq preview formatting

### In Progress 🔄
- [ ] Command detection and processing (`[page:]`, `[project:]`, etc.)
- [ ] Interactive line guides for manual adjustment

### Planned 📋
- [ ] Svelte 4 migration (see [migration spec](docs/svelte-migration-spec.md))
- [ ] Box selection for stroke groups
- [ ] Direct LogSeq block insertion
- [ ] Custom Ncode paper templates
- [ ] Multi-page document handling

## Tech Stack

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
