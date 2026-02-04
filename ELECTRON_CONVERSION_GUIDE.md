# Electron Conversion Guide for Smartpen-LogSeq-Bridge

**Document Version:** 1.0
**Date:** January 29, 2026
**Based on:** LogSeq Project Visualizer Electron implementation (Phase 9)

## Executive Summary

This guide provides step-by-step instructions for converting the Smartpen-LogSeq-Bridge from a web application to an Electron desktop application, based on lessons learned from the LogSeq Project Visualizer Electron conversion.

**Why Convert to Electron:**
1. ✅ **Eliminates CORS issues** - Direct localhost LogSeq API access
2. ✅ **Simplifies Web Bluetooth** - No HTTPS requirement for local development
3. ✅ **Professional distribution** - Single `.exe` installer for team
4. ✅ **No Node.js required** - Team members just run installer
5. ✅ **Better performance** - Direct hardware access, no browser overhead

**Estimated Time:** 4-6 hours for basic implementation

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step-by-Step Implementation](#step-by-step-implementation)
3. [Special Considerations for This App](#special-considerations-for-this-app)
4. [Testing Strategy](#testing-strategy)
5. [Distribution](#distribution)
6. [Known Issues & Solutions](#known-issues--solutions)
7. [Future Enhancements](#future-enhancements)

---

## Prerequisites

### What You Have
- ✅ Existing Vite + Svelte 4 application
- ✅ Working LogSeq API integration
- ✅ Web Bluetooth implementation (Chrome/Edge only currently)
- ✅ Working build process

### What You'll Need
- Node.js 18+ (you already have this)
- ~2GB disk space for dependencies
- ~200MB for final installer
- 4-6 hours development time

---

## Step-by-Step Implementation

### Phase 1: Install Dependencies (30 minutes)

#### 1.1 Install Electron packages

```bash
cd smartpen-logseq-bridge
npm install --save-dev electron electron-builder vite-plugin-electron
```

**Packages:**
- `electron` (~40.1.0) - Electron framework
- `electron-builder` (~26.4.0) - Creates installers
- `vite-plugin-electron` (~0.29.0) - Vite integration

**Expected result:** ~336 packages added, `node_modules` increases by ~100MB

---

#### 1.2 Install icon generation tools

```bash
npm install --save-dev sharp icon-gen
```

**Purpose:** Create proper multi-size Windows icons

---

### Phase 2: Create Electron Main Process (1 hour)

#### 2.1 Create electron directory

```bash
mkdir electron
```

#### 2.2 Create main.cjs file

Create `electron/main.cjs`:

```javascript
// electron/main.cjs
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      nodeIntegration: false,  // Security
      contextIsolation: true,  // Security
      enableRemoteModule: false, // Security
      webSecurity: true,
      // Enable Web Bluetooth API
      enableBlinkFeatures: 'WebBluetooth'
    },
    backgroundColor: '#1a1a1a',
    show: false
  });

  // Development: Load from Vite dev server
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  }
  // Production: Load built files
  else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  createMenu();
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) mainWindow.reload();
          }
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            if (mainWindow) mainWindow.webContents.toggleDevTools();
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Toggle Fullscreen', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Pen',
      submenu: [
        {
          label: 'Connect to Smartpen',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            // Trigger connection via IPC or web event
            mainWindow.webContents.send('trigger-pen-connect');
          }
        },
        {
          label: 'Fetch Offline Data',
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            mainWindow.webContents.send('trigger-pen-fetch');
          }
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Smartpen-LogSeq Bridge',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About',
              message: 'Smartpen-LogSeq Bridge',
              detail: `Version: ${app.getVersion()}\n\nA desktop application for connecting NeoSmartpen (Lamy Safari) devices to LogSeq.\n\nDeveloped by Josh Gannon`,
              buttons: ['OK']
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// App lifecycle
app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
```

**Key differences from Project Visualizer:**
- ✅ **Web Bluetooth enabled**: `enableBlinkFeatures: 'WebBluetooth'`
- ✅ **Larger default window**: 1600x1000 (for canvas work)
- ✅ **Custom menu items**: Pen menu for common operations
- ✅ **Port 3000**: Matches your Vite dev server

---

### Phase 3: Update Configuration Files (30 minutes)

#### 3.1 Update vite.config.js

**Current config location:** `vite.config.js` (root)

Add Electron plugin:

```javascript
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import electron from 'vite-plugin-electron';
import path from 'path';

export default defineConfig({
  plugins: [
    svelte(),
    electron({
      entry: 'electron/main.cjs'
    })
  ],
  base: './', // CHANGE: Always use relative paths for Electron
  resolve: {
    alias: {
      // Your existing polyfills stay
      buffer: 'buffer',
      stream: 'stream-browserify',
      zlib: 'browserify-zlib',
      util: 'util'
    }
  },
  define: {
    'process.env': {},
    global: 'globalThis'
  },
  server: {
    port: 3000,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: undefined // Single bundle for Electron
      }
    }
  }
});
```

**Key changes:**
- Add `electron` plugin
- Change `base` to `'./'`
- Add `manualChunks: undefined` for single bundle

---

#### 3.2 Update package.json

Add Electron configuration:

```json
{
  "name": "smartpen-logseq-bridge",
  "version": "1.0.0",
  "description": "Desktop application for connecting NeoSmartpen to LogSeq",
  "type": "module",
  "main": "electron/main.cjs",
  "author": "Josh Gannon",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "electron:dev": "vite & electron .",
    "electron:build": "vite build && set CSC_IDENTITY_AUTO_DISCOVERY=false&& electron-builder --win",
    "electron:build:win": "vite build && set CSC_IDENTITY_AUTO_DISCOVERY=false&& electron-builder --win"
  },
  "dependencies": {
    "svelte-dnd-action": "^0.9.69",
    "web_pen_sdk": "^0.7.8"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^3.1.1",
    "browserify-zlib": "^0.2.0",
    "buffer": "^6.0.3",
    "electron": "^40.1.0",
    "electron-builder": "^26.4.0",
    "icon-gen": "^5.0.0",
    "pako": "^2.1.0",
    "process": "^0.11.10",
    "sharp": "^0.34.5",
    "stream-browserify": "^3.0.0",
    "svelte": "^4.2.18",
    "util": "^0.12.5",
    "vite": "^5.4.0",
    "vite-plugin-electron": "^0.29.0"
  },
  "build": {
    "appId": "com.jpi.smartpen-logseq-bridge",
    "productName": "Smartpen LogSeq Bridge",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "electron/**/*",
      "public/**/*"
    ],
    "win": {
      "target": "nsis",
      "icon": "public/icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true
    }
  }
}
```

**New scripts:**
- `electron:dev` - Development mode with Electron
- `electron:build:win` - Build Windows installer

**Note:** `CSC_IDENTITY_AUTO_DISCOVERY=false` disables code signing (which causes errors without a certificate)

---

#### 3.3 Update .gitignore

Add to `.gitignore`:

```gitignore
# Electron build artifacts
release/
dist-electron/
*.exe
*.dmg
*.AppImage
*.deb
*.rpm
*.blockmap
```

---

### Phase 4: Create App Icons (1 hour)

#### 4.1 Create icon generation script

Create `scripts/create-icons.cjs`:

```javascript
// scripts/create-icons.cjs
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const iconSizes = [16, 24, 32, 48, 64, 128, 256, 512];

// SVG design - customize this for your branding
const createSVG = (size) => `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#2563eb;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#1e40af;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${size/6.4}" fill="url(#grad)"/>
  <!-- Pen icon -->
  <path d="M${size*0.3},${size*0.7} L${size*0.7},${size*0.3} L${size*0.75},${size*0.35} L${size*0.35},${size*0.75} Z"
        fill="white" opacity="0.9"/>
  ${size >= 256 ? `<circle cx="${size*0.25}" cy="${size*0.75}" r="${size*0.08}" fill="white" opacity="0.7"/>` : ''}
</svg>
`;

const publicPath = path.join(__dirname, '../public');

console.log('Creating app icons...');

Promise.all(
  iconSizes.map(size => {
    const svg = createSVG(size);
    const filename = size === 512 ? 'icon.png' : `${size}.png`;
    const filepath = path.join(publicPath, filename);

    return sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toFile(filepath)
      .then(() => console.log(`✓ Created ${size}x${size} PNG`));
  })
).then(() => {
  console.log('\nCreating Windows ICO...');
  const icongen = require('icon-gen');

  return icongen(publicPath, publicPath, {
    type: 'png',
    report: false,
    ico: {
      name: 'icon',
      sizes: [16, 24, 32, 48, 64, 128, 256]
    }
  });
}).then(() => {
  console.log('✓ Created icon.ico');

  // Clean up intermediate files
  iconSizes.forEach(size => {
    if (size !== 512) {
      const filepath = path.join(publicPath, `${size}.png`);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    }
  });

  console.log('✓ Cleaned up temporary files');
  console.log('\n✅ Icons ready!');
  console.log('   - icon.png (512x512)');
  console.log('   - icon.ico (multi-size)\n');
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
```

#### 4.2 Generate icons

```bash
mkdir scripts
node scripts/create-icons.cjs
```

**Expected output:**
- `public/icon.png` (512x512, ~16KB)
- `public/icon.ico` (multi-size, ~350KB)

**Note:** Customize the SVG design to match your branding (pen icon, colors, etc.)

---

### Phase 5: Test Development Mode (30 minutes)

#### 5.1 Run Electron in development

```bash
npm run electron:dev
```

**Expected behavior:**
- Vite dev server starts on port 3000
- Electron window opens
- App loads your Svelte UI
- Web Bluetooth should work (test pen connection)
- Hot reload works for code changes

**Troubleshooting:**
- Port conflict? Change port in `vite.config.js` and `electron/main.cjs`
- White screen? Check browser console (Ctrl+Shift+I)
- Web Bluetooth not working? Verify `enableBlinkFeatures` in main.cjs

---

### Phase 6: Build Production App (30 minutes)

#### 6.1 Build installer

```bash
npm run electron:build:win
```

**Build process:**
1. Vite builds Svelte app → `dist/`
2. Electron Builder packages everything
3. Creates installer in `release/`

**Output:**
```
release/
├── Smartpen LogSeq Bridge Setup 1.0.0.exe  (~100-120MB)
└── win-unpacked/                            (portable version)
```

**Build time:** ~30-45 seconds

---

### Phase 7: Test Installation (30 minutes)

#### 7.1 Install on your machine

1. Navigate to `release/`
2. Run `Smartpen LogSeq Bridge Setup 1.0.0.exe`
3. Install to default location
4. Launch from desktop shortcut

#### 7.2 Verify functionality

Test all features:
- [ ] Pen connection via Bluetooth
- [ ] Offline data fetch
- [ ] Real-time stroke capture
- [ ] Canvas rendering and zoom
- [ ] Stroke selection and manipulation
- [ ] MyScript transcription
- [ ] LogSeq save/load
- [ ] Settings persistence

---

## Special Considerations for This App

### Web Bluetooth API

**Challenge:** Web Bluetooth requires Chrome/Edge and typically needs HTTPS.

**Electron Solution:**
- ✅ Electron provides Chromium runtime (no browser compatibility issues)
- ✅ `enableBlinkFeatures: 'WebBluetooth'` enables the API
- ✅ No HTTPS requirement in Electron
- ✅ Direct hardware access without browser restrictions

**Testing:**
```javascript
// In your pen connection code - should work unchanged
if (!navigator.bluetooth) {
  console.error('Web Bluetooth not available');
}
```

---

### Canvas Rendering Performance

**Current:** Canvas rendering works well in browser

**Electron:** Same performance, but:
- ✅ Better hardware acceleration
- ✅ No browser DevTools overhead (unless opened)
- ✅ More consistent frame rates

**No changes needed** - canvas code works identically

---

### LocalStorage Persistence

**Current:** Settings persist to browser localStorage

**Electron:** Uses different storage location:
- Windows: `C:\Users\[Name]\AppData\Roaming\smartpen-logseq-bridge\`
- Includes localStorage and IndexedDB

**No code changes needed** - localStorage API works identically

---

### LogSeq API Access

**Challenge:** CORS issues when accessing `http://localhost:12315` from HTTPS

**Electron Solution:**
- ✅ Runs entirely locally (no CORS restrictions)
- ✅ Direct localhost access without browser security
- ✅ Your existing `logseq-api.js` works unchanged

**No code changes needed**

---

### File Paths and Assets

**Change required:** Update asset paths to be relative

**Vite config already updated:**
```javascript
base: './', // Relative paths for Electron
```

**Verify in HTML:**
```html
<!-- Good (relative) -->
<link rel="icon" href="./favicon.ico">

<!-- Bad (absolute) -->
<link rel="icon" href="/favicon.ico">
```

Most Vite apps handle this automatically.

---

## Testing Strategy

### Development Testing

1. **Basic Launch**
   ```bash
   npm run electron:dev
   ```
   - [ ] Window opens at 1600x1000
   - [ ] UI renders correctly
   - [ ] Dev tools accessible

2. **Pen Integration**
   - [ ] Web Bluetooth pairing dialog appears
   - [ ] Pen connects successfully
   - [ ] Real-time strokes appear on canvas
   - [ ] Offline fetch works

3. **LogSeq Integration**
   - [ ] Connection settings persist
   - [ ] Can save pages to LogSeq
   - [ ] Can load pages from LogSeq
   - [ ] Database scanner works

4. **Canvas Operations**
   - [ ] Pan and zoom smooth
   - [ ] Selection tools work
   - [ ] Stroke duplication works
   - [ ] Page positioning persists

5. **MyScript Integration**
   - [ ] Transcription API calls work
   - [ ] Results display correctly
   - [ ] Cache persists

---

### Production Build Testing

1. **Build Process**
   ```bash
   npm run electron:build:win
   ```
   - [ ] Build completes without errors
   - [ ] Installer created (~100-120MB)
   - [ ] No missing dependencies

2. **Installation**
   - [ ] Installer runs on Windows 10/11
   - [ ] Can choose install location
   - [ ] Desktop shortcut created
   - [ ] Start menu entry created

3. **Functionality**
   - [ ] All features from dev testing
   - [ ] Settings persist across restarts
   - [ ] No console errors
   - [ ] Performance is good

4. **Clean Machine Test**
   - [ ] Install on machine without Node.js
   - [ ] App runs successfully
   - [ ] All features work

---

## Distribution

### Option 1: GitHub Releases (Recommended)

1. **Create release:**
   - Go to: `https://github.com/[your-username]/smartpen-logseq-bridge/releases`
   - Click "Draft a new release"
   - Tag: `v1.0.0`
   - Upload: `Smartpen LogSeq Bridge Setup 1.0.0.exe`
   - Publish

2. **Team access:**
   - Share release link
   - Team downloads installer
   - Run to install

**Pros:**
- Version tracking
- Download statistics
- Professional distribution
- Foundation for auto-updates (future)

---

### Option 2: Company Server

```
\\company-server\Software\Smartpen Bridge\
├── v1.0.0\
│   └── Smartpen LogSeq Bridge Setup 1.0.0.exe
└── README.txt
```

**Pros:**
- Internal control
- Fast access
- No external accounts needed

**Cons:**
- Manual version management
- Can't use auto-updater later

---

## Known Issues & Solutions

### Issue 1: Windows SmartScreen Warning

**Symptom:** "Windows protected your PC" warning

**Cause:** App is not code-signed ($300-400/year certificate)

**Solution:**
1. Click "More info"
2. Click "Run anyway"
3. This is normal for unsigned apps

**Future:** Consider code signing certificate for professional deployment

---

### Issue 2: Pen Connection Issues

**Symptom:** Can't pair with pen

**Possible causes:**
1. Bluetooth not enabled on PC
2. Pen not in pairing mode
3. Pen already paired to another device

**Solutions:**
1. Enable Bluetooth in Windows settings
2. Press pen button for 3+ seconds (pairing mode)
3. Forget pen in Windows Bluetooth settings, then re-pair

---

### Issue 3: Icon Not Showing

**Symptom:** Taskbar/Explorer shows default icon

**Cause:** Windows icon cache

**Solution:**
```powershell
# Run as Administrator
Stop-Process -Name explorer -Force
Remove-Item "$env:LOCALAPPDATA\IconCache.db" -Force
Remove-Item "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache*" -Force
Start-Process explorer.exe
```

Or just restart your computer.

---

### Issue 4: LogSeq Connection Fails

**Symptom:** "Failed to connect to LogSeq"

**Solutions:**
1. Ensure LogSeq is running
2. Enable HTTP API in LogSeq settings
3. Check port (default: 12315)
4. Try without authorization token first
5. Check Windows Firewall settings

---

## Future Enhancements

### Phase 10: Auto-Updater (Optional)

Add automatic updates:

```bash
npm install electron-updater
```

Update `electron/main.cjs`:
```javascript
const { autoUpdater } = require('electron-updater');

app.on('ready', () => {
  createWindow();
  autoUpdater.checkForUpdatesAndNotify();
});
```

**Requires:** GitHub Releases for update hosting

**Benefits:**
- Automatic background updates
- Seamless user experience
- Professional update flow

**Time:** +2 hours implementation

---

### Mac/Linux Support

Current guide is Windows-only. For Mac/Linux:

**Mac:**
- Build on Mac: `electron-builder --mac`
- Creates `.dmg` installer
- Requires Mac hardware

**Linux:**
- Build: `electron-builder --linux`
- Creates `.AppImage` or `.deb`
- Can build from Windows with Docker

**Time:** +4 hours per platform

---

### Custom Icon Design

Current icons are placeholder. Consider:
- Hiring designer on Fiverr ($10-50)
- Creating in Figma/Inkscape
- Using company branding

**Requirements:**
- 512x512 PNG
- Simple, recognizable design
- Good contrast at small sizes

---

## Documentation Updates

After implementation, update these files:

1. **README.md**
   - Add desktop app quick start
   - Update installation instructions
   - Add screenshots of desktop app

2. **CLAUDE.MD**
   - Add Electron section
   - Update development commands
   - Note desktop-specific features

3. **Create ELECTRON_INSTALL.md**
   - Installation guide for team
   - Troubleshooting section
   - Feature overview

---

## Verification Checklist

Before distributing to team:

**Development:**
- [ ] `npm run electron:dev` works
- [ ] Hot reload functional
- [ ] All features work in dev mode

**Build:**
- [ ] `npm run electron:build:win` succeeds
- [ ] Installer created in `release/`
- [ ] File size reasonable (~100-120MB)

**Installation:**
- [ ] Installer runs on Windows 10/11
- [ ] App installs successfully
- [ ] Desktop shortcut works
- [ ] Start menu entry works

**Functionality:**
- [ ] Pen connection works
- [ ] Canvas rendering works
- [ ] LogSeq integration works
- [ ] MyScript API works
- [ ] Settings persist
- [ ] All keyboard shortcuts work

**Documentation:**
- [ ] README updated
- [ ] Installation guide created
- [ ] Team notified

---

## Key Differences from Project Visualizer

This app has unique requirements compared to the Project Visualizer:

| Feature | Project Visualizer | Smartpen Bridge |
|---------|-------------------|-----------------|
| **Window Size** | 1400x900 | 1600x1000 (larger canvas) |
| **Web Bluetooth** | Not needed | Required (enabled) |
| **Custom Menu** | Basic | Pen-specific items |
| **Canvas Performance** | Not critical | Critical (1000+ strokes) |
| **Dev Port** | 5173 | 3000 |
| **Polyfills** | None | Node.js shims needed |

**Main difference:** Web Bluetooth enablement in `webPreferences`

---

## Support Resources

- **Electron Docs:** https://www.electronjs.org/docs
- **Web Bluetooth in Electron:** https://www.electronjs.org/docs/latest/api/web-contents#contentsenableblinkfeaturesfeatures
- **electron-builder:** https://www.electron.build/
- **Vite Plugin:** https://github.com/electron-vite/vite-plugin-electron

---

## Questions Before Starting?

Consider:

1. **Icon design:** Use placeholder or create custom first?
2. **Distribution:** GitHub Releases or company server?
3. **Testing:** Do you have a test machine without Node.js?
4. **Timeline:** When do you want to deploy to team?

---

## Quick Start Commands

```bash
# 1. Install dependencies
npm install --save-dev electron electron-builder vite-plugin-electron sharp icon-gen

# 2. Create directories
mkdir electron
mkdir scripts

# 3. Create files (copy from this guide)
# - electron/main.cjs
# - scripts/create-icons.cjs

# 4. Update files (see guide sections)
# - vite.config.js
# - package.json
# - .gitignore

# 5. Generate icons
node scripts/create-icons.cjs

# 6. Test development
npm run electron:dev

# 7. Build production
npm run electron:build:win

# 8. Test installer
cd release
# Run the .exe file
```

---

**Good luck with your Electron conversion!** 🚀

Based on the LogSeq Project Visualizer experience, this should be a smooth process. The main advantage for your app is that Web Bluetooth will work much more reliably in Electron than in a browser environment.
