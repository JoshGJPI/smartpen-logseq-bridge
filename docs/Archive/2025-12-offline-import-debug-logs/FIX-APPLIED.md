# Fix Applied: Sequential Offline Data Transfer

## Problem Identified
When requesting offline data from multiple books (B390 and B3017), both transfer processes were starting simultaneously, causing B390's transfer to fail/drop while only B3017 completed successfully.

**Root Cause:** The pen firmware can't handle concurrent offline data transfers. When both `RequestOfflineData()` calls executed close together, only one transfer would complete.

## Solution Implemented

### Sequential Transfer with Progress Tracking

The code now:

1. **Requests one book at a time** - Waits for each book's complete transfer before requesting the next
2. **Tracks expected stroke counts** - Monitors the `OFFLINE_DATA_RESPONSE` message to know how many strokes to expect
3. **Accumulates chunks** - Since data arrives in multiple `OFFLINE_DATA_SEND_SUCCESS` messages, we track progress
4. **Resolves when complete** - Only moves to the next book when all expected strokes have been received

### Key Changes

```javascript
// Before: Fire all requests at once
noteList.forEach(note => {
  controller.RequestOfflineData(...);
});

// After: Request sequentially and wait for completion
for (let i = 0; i < noteList.length; i++) {
  const note = noteList[i];
  
  // Create promise that resolves when THIS book's transfer completes
  const transferComplete = new Promise((resolve, reject) => {
    pendingOfflineTransfer = note.Note;
    offlineTransferResolver = resolve;
    setTimeout(() => reject(new Error('Timeout')), 30000);
  });
  
  controller.RequestOfflineData(...);
  await transferComplete; // Wait here!
  
  // Clean up and move to next book
  await new Promise(resolve => setTimeout(resolve, 200));
}
```

### Progress Tracking

```javascript
case 49: // OFFLINE_DATA_RESPONSE
  if (args?.stroke && pendingOfflineTransfer) {
    expectedStrokesForBook.set(pendingOfflineTransfer, args.stroke);
    receivedStrokesForBook.set(pendingOfflineTransfer, 0);
  }
  break;

// In handleOfflineDataReceived:
const currentCount = receivedStrokesForBook.get(detectedBook) || 0;
const newCount = currentCount + convertedStrokes.length;
receivedStrokesForBook.set(detectedBook, newCount);

if (newCount >= expectedStrokesForBook.get(detectedBook)) {
  offlineTransferResolver(); // Complete!
}
```

## What You'll See Now

### Console Output
```
===== OFFLINE NOTE LIST RECEIVED =====
📚 Note list: [{Book: 390}, {Book: 3017}]

📥 Requesting offline data sequentially (waiting for each to complete)...

📖 Requesting note 1/2: S3/O27/B390
📊 Book 390: Expecting 1222 strokes (365410 bytes)
🚀 OFFLINE_DATA_SEND_START received
📦 Raw data length: 150
📖 First stroke from book B390
📊 Book 390 progress: 150/1222 strokes (12%)
... [more chunks] ...
📊 Book 390 progress: 1222/1222 strokes (100%)
🎯 Transfer complete for book 390!
✅ Book 390 transfer completed

⏳ Waiting 200ms before next request...

📖 Requesting note 2/2: S3/O1012/B3017
📊 Book 3017: Expecting 954 strokes (308798 bytes)
🚀 OFFLINE_DATA_SEND_START received
📦 Raw data length: 7
📖 First stroke from book B3017
📊 Book 3017 progress: 7/954 strokes (1%)
... [more chunks] ...
📊 Book 3017 progress: 954/954 strokes (100%)
🎯 Transfer complete for book 3017!
✅ Book 3017 transfer completed

✅ All offline data transfers completed
```

### Expected Results
- ✅ B390 will now transfer completely before B3017 starts
- ✅ All strokes from both books will be imported
- ✅ Progress tracking shows completion percentage
- ✅ 30-second timeout per book prevents hanging

## Safety Features

1. **Timeout Protection**: Each book has a 30-second timeout - if transfer stalls, it will fail gracefully and move to the next book
2. **Error Recovery**: If one book fails, the system continues with remaining books
3. **Progress Monitoring**: Real-time feedback shows exactly how much data has been received
4. **Clean State**: 200ms delay between books ensures clean GATT state

## Testing Steps

1. **Clear existing strokes**: Click "Clear Canvas"
2. **Connect pen**: Click "Connect Pen"
3. **Fetch offline notes**: Click "Fetch Stored Notes"
4. **Watch console**: You should see:
   - Both books detected
   - B390 transfer completes 100%
   - 200ms wait
   - B3017 transfer completes 100%
5. **Check canvas**: Use page dropdown to see both B390 and B3017 pages

## Why Not Promise.all()?

`Promise.all()` would fire all requests simultaneously, which is exactly what we're trying to avoid. The pen firmware requires sequential processing - one book at a time.

```javascript
// ❌ This would fail the same way
await Promise.all(noteList.map(note => 
  controller.RequestOfflineData(...)
));

// ✅ This works
for (const note of noteList) {
  await singleTransfer(note);
}
```

## Connection Error Note

The initial connection error you saw:
```
not support service uuid NetworkError: GATT Server is disconnected
```

This is unrelated to the offline data issue. It's a timing issue where the GATT connection hadn't fully established. The retry succeeded, which is normal behavior for Bluetooth connections.

To reduce this, ensure:
- Pen is powered on and idle (not writing)
- No other devices connected to the pen
- Browser has Bluetooth permissions

---

**Status**: Fix applied and ready for testing
**Expected Outcome**: Both B390 and B3017 strokes will import successfully
