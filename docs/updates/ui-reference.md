# TranscriptionView UI Reference

## New Per-Page Transcription Interface

### Action Bar
```
┌─────────────────────────────────────────────────────────┐
│ 3 Pages Transcribed              [Deselect All]         │
│                                                          │
│ ┌────────────────────────────────────────────────────┐  │
│ │  ⬇  Send 2 Pages to Journal                        │  │
│ └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Page Card (Collapsed)
```
┌─────────────────────────────────────────────────────────┐
│ [✓] B1  P1                      45 strokes  ▼  ✕       │
│                                                          │
│  8 lines   24 words   145 chars   ✓ indented            │
└─────────────────────────────────────────────────────────┘
  ^     ^      ^                       ^         ^    ^
  |     |      |                       |         |    |
checkbox badge page#              stats bar  expand delete
```

### Page Card (Expanded)
```
┌─────────────────────────────────────────────────────────┐
│ [✓] B1  P1                      45 strokes  ▲  ✕       │
│                                                          │
│  8 lines   24 words   145 chars   ✓ indented            │
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ TRANSCRIBED TEXT                                    │ │
│ │ ┌─────────────────────────────────────────────────┐ │ │
│ │ │ Project Meeting Notes                           │ │ │
│ │ │   Discussed budget for Q1                       │ │ │
│ │ │   Need to hire 2 more engineers                 │ │ │
│ │ └─────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ LOGSEQ PREVIEW                                      │ │
│ │ ┌─────────────────────────────────────────────────┐ │ │
│ │ │ - Project Meeting Notes                         │ │ │
│ │ │   - Discussed budget for Q1                     │ │ │
│ │ │   - Need to hire 2 more engineers               │ │ │
│ │ └─────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Multiple Pages Example
```
┌─────────────────────────────────────────────────────────┐
│ 3 Pages Transcribed              [Select All]           │
│                                                          │
│ ┌────────────────────────────────────────────────────┐  │
│ │  ⬇  Send 2 Pages to Journal                        │  │
│ └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐ ✓ Selected
│ [✓] B1  P1                      45 strokes  ▼  ✕       │
│  8 lines   24 words   145 chars   ✓ indented            │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐ ✓ Selected
│ [✓] B1  P2                      38 strokes  ▼  ✕       │
│  6 lines   18 words   98 chars                          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐ Not selected
│ [ ] B2  P1                      52 strokes  ▼  ✕       │
│  10 lines   31 words   189 chars   ✓ indented   2 cmds │
└─────────────────────────────────────────────────────────┘
```

## UI Elements

### Checkboxes
- **Checked (green)**: Page selected for import
- **Unchecked**: Page not selected
- Click checkbox or label to toggle

### Book/Page Badges
- **Book Badge (red)**: "B1", "B2", etc.
- **Page Number**: "P1", "P2", etc.
- Always shows current page identity

### Statistics Bar
Shows at-a-glance info:
- **Lines**: Number of text lines detected
- **Words**: Total word count
- **Chars**: Character count
- **Indented**: Shows ✓ if indentation detected
- **Commands**: Count of detected commands (if any)

### Action Buttons
- **Expand (▼/▲)**: Toggle details view
- **Delete (✕)**: Remove this transcription
- **Select All/Deselect All**: Bulk checkbox operations

### Visual Indicators
- **Green Border**: Selected page (checkbox checked)
- **Normal Border**: Unselected page
- **Rotated Arrow**: Expanded state indicator

## State Management

### Selection States
```
No pages transcribed
  └─> Empty state: "Select strokes and click Transcribe..."

Pages transcribed, none selected
  └─> Send button: "Select Pages to Send" (disabled)

Pages transcribed, some selected (e.g., 2 of 3)
  └─> Send button: "Send 2 Pages to Journal" (enabled)
  └─> "Select All" button shown

Pages transcribed, all selected
  └─> Send button: "Send 3 Pages to Journal" (enabled)
  └─> "Deselect All" button shown
```

### Expansion States
```
Page card collapsed (default)
  └─> Shows: header + stats only
  └─> Arrow: ▼ (pointing down)
  └─> Click arrow to expand

Page card expanded
  └─> Shows: header + stats + details
  └─> Arrow: ▲ (pointing up)
  └─> Details include: text + LogSeq preview + commands
  └─> Click arrow to collapse
```

## Color Coding

### Success/Selected (Green)
- Send button background
- Selected page border
- Checkbox accent color
- Success log messages

### Accent (Red/Pink)
- Book badge background
- Stat value numbers
- Action links
- Primary UI accents

### Secondary (Gray)
- Stroke counts
- Stat labels
- Unselected state
- Background elements

### Error (Red)
- Delete button hover
- Error log messages
- Validation warnings

## Interaction Flow

### Basic Workflow
```
1. Transcribe button clicked
   └─> System processes each page
   └─> Results appear in Transcription tab
   └─> All pages auto-selected

2. Review pages
   └─> Expand to see details
   └─> Uncheck pages you don't want

3. Send to LogSeq
   └─> Only selected pages are sent
   └─> Progress shown in activity log
   └─> Success/error per page
```

### Advanced Operations
```
Delete page transcription
  └─> Removes from list
  └─> Removes from selection
  └─> Can re-transcribe later

Select All / Deselect All
  └─> Toggles all checkboxes at once
  └─> Button text changes based on state

Expand/Collapse
  └─> State tracked per page
  └─> Independent of selection
  └─> Smooth animation
```

## Responsive Behavior

### Normal Screen (>1400px)
- Full statistics bar visible
- Comfortable spacing
- All labels shown

### Medium Screen (1000-1400px)
- Statistics bar may wrap
- Slightly reduced padding
- Labels abbreviated

### Small Screen (<1000px)
- Stack layout
- Reduced font sizes
- Priority: checkboxes + send button

## Accessibility

- **Keyboard Navigation**: Tab through checkboxes
- **Click Targets**: Large touch-friendly buttons
- **Visual Feedback**: Hover states on all interactive elements
- **Screen Readers**: Semantic HTML with labels
- **Color Contrast**: WCAG AA compliant

## Empty States

### No Transcriptions
```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│     Select strokes and click "Transcribe" to           │
│     convert handwriting to text.                        │
│                                                          │
│     Get MyScript API keys (free: 2,000 requests/month)  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Transcribing (Loading)
```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│                      ⟳ (spinner)                         │
│                                                          │
│              Transcribing handwriting...                 │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Tips

1. **Auto-Selection**: Newly transcribed pages are automatically selected
2. **Quick Review**: Expand only pages you're unsure about
3. **Bulk Operations**: Use Select All to quickly prepare for import
4. **Clean Up**: Delete failed or unwanted transcriptions
5. **Re-transcribe**: Delete and transcribe again if needed
