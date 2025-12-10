# NeoSmartpen → LogSeq Bridge

A lightweight bridge application for syncing handwritten notes from NeoSmartpen (Lamy Safari) to LogSeq.

## Features

- **Bluetooth Connection**: Connect to your Lamy smartpen via Web Bluetooth API
- **Real-time Preview**: See strokes as you write on the canvas
- **Offline Sync**: Download stored notes from the pen's memory
- **Shape Detection**: Automatically detect rectangles/boxes drawn around content
- **Data Exploration**: View raw JSON structure of stroke data
- **SVG Export**: Export drawings as scalable vector graphics
- **LogSeq Integration**: Send notes directly to LogSeq via HTTP API

## Prerequisites

1. **Chrome or Edge browser** (Firefox doesn't support Web Bluetooth)
2. **Node.js 18+** installed
3. **NeoSmartpen** with Bluetooth capability (Lamy Safari / NWP-F80 tested)
4. **Ncode paper** for the pen to track positions
5. **LogSeq desktop app** with HTTP API enabled

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

### 3. Enable LogSeq HTTP API

1. Open LogSeq
2. Go to **Settings** > **Advanced**
3. Enable **Developer mode**
4. Enable **HTTP APIs server** (default port: 12315)
5. Optionally set an authorization token

### 4. Connect Your Pen

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
3. Explore the data in the **Data Explorer** panel

### Shape Detection
The app automatically detects hand-drawn rectangles. These can be used to:
- Mark regions of text for specific routing in LogSeq
- Create visual boundaries around related content
- Identify command/action areas on your notes

### Export to LogSeq
1. Click **Test Connection** to verify LogSeq is accessible
2. Click **Send to LogSeq** to create a note with:
   - SVG rendering of your handwriting
   - Stroke metadata
   - Page references

## Data Structure

The pen provides rich stroke data:

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
    {
      x: number,      // Ncode X coordinate
      y: number,      // Ncode Y coordinate
      f: number,      // Pressure (0-1)
      timestamp: number
    }
  ]
}
```

Convert Ncode coordinates to millimeters: multiply by `2.371`

## Architecture

```
┌──────────────┐     BLE      ┌─────────────────┐     HTTP      ┌──────────────┐
│  NeoSmartpen │ ───────────► │  Bridge App     │ ────────────► │   LogSeq     │
│  (Lamy F80)  │              │  (This App)     │               │   HTTP API   │
└──────────────┘              └─────────────────┘               └──────────────┘
```

## Files

```
smartpen-logseq-bridge/
├── index.html           # Main UI
├── src/
│   ├── main.js          # Application entry, pen callbacks
│   ├── canvas-renderer.js # Stroke rendering and SVG export
│   ├── stroke-analyzer.js # Shape detection algorithms
│   └── logseq-api.js    # LogSeq HTTP API client
├── package.json
├── vite.config.js
└── README.md
```

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

### "No strokes appear"
- Make sure you're using Ncode paper
- Check the pen tip is working (LED should blink while writing)
- Try fetching offline data to test the connection

## Future Enhancements

- [ ] Handwriting transcription (OCR)
- [ ] Custom Ncode paper templates
- [ ] Box-based routing (content in boxes goes to specific pages)
- [ ] Audio recording sync (some models support this)
- [ ] Multi-pen support

## License

MIT

## Credits

- [NeoSmartpen Web SDK](https://github.com/NeoSmartpen/WEB-SDK2.0)
- [LogSeq](https://logseq.com/)
