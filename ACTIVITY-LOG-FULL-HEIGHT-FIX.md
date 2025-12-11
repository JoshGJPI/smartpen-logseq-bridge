# Activity Log Full Height Fix

## Problem
Activity Log was not filling the full height of the left panel, showing a lot of empty space below the log messages.

## Root Cause
1. ActivityLog had `max-height: 150px` which limited its expansion
2. `.log-content` wrapper wasn't set up as a flex container to pass height down

## Solution

### 1. ActivityLog.svelte
Changed:
```css
/* BEFORE */
.log-messages {
  max-height: 150px;
}

/* AFTER */
.log-messages {
  min-height: 200px;
}
```

**Result**: Removed height ceiling, added minimum height for better UX.

### 2. LeftPanel.svelte
Changed:
```css
/* BEFORE */
.log-content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-top: 5px;
}

/* AFTER */
.log-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  min-height: 0;
}
```

**Result**: Made it a flex container to properly pass height to ActivityLog component.

## Files Modified
- ✅ `src/components/layout/ActivityLog.svelte`
- ✅ `src/components/layout/LeftPanel.svelte`

## Test

```bash
npm run build && npm run dev
```

### Expected Behavior:
1. Open app
2. Click "Activity Log" tab
3. Log should fill entire panel height
4. No large empty space below messages
5. Scrollbar appears when messages overflow

## Visual Result

### Before:
```
┌──────────────────┐
│ Activity Log Tab │
├──────────────────┤
│ ● Message 1      │
│ ● Message 2      │
│ ● Message 3      │
│                  │ ← Lots of empty space
│                  │
│                  │
│                  │
│                  │
└──────────────────┘
```

### After:
```
┌──────────────────┐
│ Activity Log Tab │
├──────────────────┤
│ ● Message 1      │
│ ● Message 2      │
│ ● Message 3      │
│ ● Message 4      │
│ ● Message 5      │
│ ● Message 6      │
│ ...              │
│ ...              │
│ (scrollable)     │
└──────────────────┘
```

## Benefits
✅ Full height utilization  
✅ Less scrolling needed  
✅ Better space efficiency  
✅ Cleaner visual appearance  

---

That's it! The activity log now uses the full available height.
