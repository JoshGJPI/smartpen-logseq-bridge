# Line Consolidation - Quick Testing Guide

**Purpose:** Quick walkthrough to verify the implementation works correctly

---

## Prerequisites

1. LogSeq running with HTTP API enabled (port 12315)
2. SmartPen-LogSeq Bridge app running
3. At least one page with transcription data in LogSeq

---

## Test 1: Open the Editor (2 minutes)

### Steps:
1. **Navigate** to LogSeq DB Tab
2. **Find** a book/page with transcription (green "synced" badge)
3. **Click** the "✏️ Edit Structure" button next to "Transcription:"

### Expected Result:
- Modal opens with title "Edit Transcription - B{book}/P{page}"
- Left pane shows list of transcription lines
- Right pane shows LogSeq preview
- Each line shows:
  - Checkbox for selection
  - Line number (#1, #2, etc.)
  - Y-bounds info (Y: 1234-1289)
  - Text content
  - Merge/Split buttons

### ✅ Pass Criteria:
- Modal opens without errors
- Lines display correctly
- Preview pane shows LogSeq-style blocks

---

## Test 2: Merge Lines (3 minutes)

### Steps:
1. **Select** 2 adjacent lines (click checkboxes)
2. **Click** the "Merge (2)" button in toolbar
3. **Observe** preview pane

### Expected Result:
- Two lines combine into one
- Merged line shows green badge "✓ 2"
- Y-bounds expand to cover both ranges
- Preview shows single block with combined text
- Preview shows `merged-lines:: 2` property

### ✅ Pass Criteria:
- Lines merge successfully
- Preview updates immediately
- No console errors

---

## Test 3: Save and Verify in LogSeq (3 minutes)

### Steps:
1. **Click** "💾 Save Changes" button
2. **Wait** for success alert
3. **Open** LogSeq
4. **Navigate** to the page (e.g., "Smartpen Data/B3017/P42")
5. **Find** the merged block
6. **Click** block to view properties

### Expected Result:
- Success alert shows stats (e.g., "1 updated, 2 skipped")
- In LogSeq, merged block exists as single block
- Block properties show:
  - `stroke-y-bounds:: 1234.0-1345.0`
  - `canonical-transcript:: {combined text}`
  - `merged-lines:: 2`

### ✅ Pass Criteria:
- Block saved successfully
- Properties present and correct
- No duplicate blocks created

---

## Test 4: Re-Transcription Persistence (5 minutes)

### Steps:
1. **In LogSeq**, edit the merged block:
   - Change "TODO" to "DONE"
   - Add tag "#important"
2. **In SmartPen app**, find same page
3. **Click** "Import Strokes" (if not already imported)
4. **Transcribe** the page again (this re-processes same strokes)
5. **Check** if merged block stays merged

### Expected Result:
- After re-transcription, merged block still exists
- User edits preserved:
  - "DONE" status intact
  - "#important" tag intact
- `merged-lines:: 2` property still present

### ✅ Pass Criteria:
- Block not split back into 2
- User edits completely preserved
- Console shows "skipped-merged" action

---

## Test 5: Smart Merge (2 minutes)

### Steps:
1. **Open** editor on a page with wrapped lines
2. **Look** for "💡 Smart Merge ({count})" button
3. **Click** it
4. **Observe** suggested merge

### Expected Result:
- Lines that look wrapped automatically merge
- Typical pattern: lines with same indent, no end punctuation, lowercase start
- Preview updates with merged line

### ✅ Pass Criteria:
- Smart merge detects at least one suggestion
- Merge executes correctly
- Preview shows result

---

## Test 6: Undo/Redo (2 minutes)

### Steps:
1. **Merge** several lines
2. **Press** `Ctrl+Z` (Windows/Linux) or `Cmd+Z` (Mac)
3. **Observe** undo
4. **Press** `Ctrl+Shift+Z` or `Cmd+Shift+Z`
5. **Observe** redo

### Expected Result:
- Undo reverses merge
- Lines return to original state
- Redo re-applies merge
- History works for multiple operations

### ✅ Pass Criteria:
- Undo/redo work correctly
- No state corruption
- Preview stays in sync

---

## Test 7: Edge Cases (5 minutes)

### Test 7A: Split Line
1. **Merge** two lines
2. **Click** "Split" button on merged line
3. **Observe** result

**Expected:** Line splits into two (Y-bounds divided)

### Test 7B: Edit Merged Line Text
1. **Merge** lines
2. **Click** into text field
3. **Edit** the text
4. **Save** and re-transcribe

**Expected:** Modified text preserved if canonical unchanged

### Test 7C: Select All
1. **Press** `Ctrl+A`
2. **Observe** all lines selected

**Expected:** All checkboxes checked

---

## Common Issues & Solutions

### Issue: "No transcription blocks found"
**Cause:** Page not transcribed or old format  
**Fix:** Transcribe page first using MyScript button

### Issue: Modal doesn't open
**Cause:** LogSeq API not responding  
**Fix:** Check LogSeq HTTP API is enabled and running

### Issue: Changes not saving
**Cause:** Network or API error  
**Fix:** Check console for errors, verify LogSeq connection

### Issue: Lines look weird after merge
**Cause:** Expected behavior - text combines with space  
**Fix:** Edit text manually in modal before saving

---

## Performance Benchmarks

| Lines | Load Time | Save Time |
|-------|-----------|-----------|
| 10    | < 1s      | < 2s      |
| 50    | 1-2s      | 3-5s      |
| 100   | 2-3s      | 8-12s     |

*Times include network round-trip to LogSeq*

---

## Success Checklist

- [ ] Modal opens without errors
- [ ] Lines display with correct metadata
- [ ] Merge combines lines correctly
- [ ] Preview shows accurate LogSeq representation
- [ ] Save creates merged blocks in LogSeq
- [ ] Merged blocks have `merged-lines` property
- [ ] Re-transcription preserves merged blocks
- [ ] User edits preserved after merge + re-transcription
- [ ] Smart merge detects wrapped lines
- [ ] Undo/redo work correctly
- [ ] No console errors during any operation

---

## If All Tests Pass...

**🎉 Implementation is working correctly!**

You can now:
1. Confidently merge wrapped lines
2. Trust that user edits will be preserved
3. Re-transcribe pages without losing merge structure
4. Use the feature in your daily note-taking workflow

---

## If Tests Fail...

1. **Check browser console** for JavaScript errors
2. **Check LogSeq logs** for API errors
3. **Verify** LogSeq HTTP API is running (http://localhost:12315/api)
4. **Review** STORAGE_ARCHITECTURE_v2.0.md for expected behavior
5. **Report** issue with console logs and steps to reproduce

---

**Testing Time:** ~20-25 minutes for full suite  
**Quick Smoke Test:** Tests 1-3 only (~10 minutes)

**Good luck! 🚀**
