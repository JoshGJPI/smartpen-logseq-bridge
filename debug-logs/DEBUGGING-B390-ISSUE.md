# Debugging B390 Offline Note Import Issue

## Problem Summary
Strokes from book B3017 are importing successfully, but strokes from book B390 appear in the initial alert but don't get imported into the app.

## Changes Made

I've added comprehensive debug logging to `src/lib/pen-sdk.js` to track:

1. **Note List Reception** - What notes the pen reports as available
2. **Data Request** - Confirmation that both books are being requested
3. **Data Reception** - What data actually arrives from the pen
4. **Processing** - How the data is converted and which books are detected

## Testing Instructions

### 1. Open Browser Console
1. Open the app in Chrome/Edge
2. Press F12 to open DevTools
3. Go to the Console tab
4. Keep it open while testing

### 2. Fetch Offline Notes
1. Connect your pen
2. Click "Fetch Stored Notes"
3. Look for the alert showing available notes
4. Confirm the download

### 3. Analyze Console Output

The console will now show detailed logs. Here's what to look for:

#### Stage 1: Note List Reception
```
===== OFFLINE NOTE LIST RECEIVED =====
Note list: [array of notes]
Requesting offline data for each note...
Requesting note 1/2: {Section: 3, Owner: 0, Book: 3017, ...}
Requesting note 2/2: {Section: 3, Owner: 0, Book: 390, ...}
===== END OFFLINE NOTE LIST PROCESSING =====
```

**✓ What to check:**
- Are BOTH books (3017 and 390) listed?
- Are BOTH being requested?

#### Stage 2: Data Transfer Messages
```
OFFLINE_DATA_SEND_START received
OFFLINE_DATA_SEND_STATUS: 50%
OFFLINE_DATA_SEND_STATUS: 100%
OFFLINE_DATA_SEND_SUCCESS received - calling handleOfflineDataReceived
```

**✓ What to check:**
- Do you see this sequence TWICE (once for each book)?
- Or only once?
- Are there any OFFLINE_DATA_SEND_FAILURE messages?

#### Stage 3: Data Reception and Processing
```
===== OFFLINE DATA RECEIVED =====
Raw data type: array
Raw data length: 150
Raw data sample: [first 2 strokes]
First stroke from book 3017: {...}
First stroke from book 390: {...}
Book statistics: {3017: 75, 390: 75}
Total converted strokes: 150
===== END OFFLINE DATA PROCESSING =====
```

**✓ What to check:**
- Does the book statistics show BOTH books?
- What are the stroke counts for each book?
- Are there any warnings about strokes without Dots arrays?

## Possible Findings

### Scenario A: B390 Not Requested
If you only see ONE "Requesting note" entry:
- **Issue**: The note list might not contain B390
- **Next step**: Check if B390 was actually written offline

### Scenario B: B390 Request Sent, No Data Received
If you see B390 requested but only ONE OFFLINE_DATA_SEND_SUCCESS:
- **Issue**: Pen communication problem
- **Next step**: Try disconnecting/reconnecting pen

### Scenario C: B390 Data Received but Wrong Format
If you see warnings like "Stroke X has no Dots array":
- **Issue**: Data structure problem with B390 strokes
- **Next step**: Check raw data sample in console

### Scenario D: B390 Data Processed but Not Visible
If book statistics shows both books:
- **Issue**: Display/filtering problem, not import problem
- **Next step**: Check page selector dropdown for B390 pages

## What to Send Me

Please capture and send:
1. Screenshot of the full console output from "OFFLINE NOTE LIST" through "END OFFLINE DATA PROCESSING"
2. The book statistics object
3. Any error messages or warnings in red

## Temporary Workaround

If you need immediate access to B390 data:
1. Try writing B390 strokes in real-time instead of offline
2. Or clear B3017 from pen memory and sync B390 alone

## Additional Context

The offline data sync happens in multiple stages:
1. Pen → App: "Here are the notes I have" (handled by `handleOfflineNoteList`)
2. App → Pen: "Send me all of them" (controller.RequestOfflineData)
3. Pen → App: Each book's data arrives separately (handled by `handleOfflineDataReceived`)

The logging will show us exactly where the B390 data is getting lost in this pipeline.
