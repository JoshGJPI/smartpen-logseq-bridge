# v2.0 Integration Checklist

## ✅ What's Done

### Core Implementation
- [x] Added `normalizeTranscript()` to myscript-api.js
- [x] Added `canonical` field to parsed lines
- [x] Added `yBounds` calculation to lines
- [x] Created helper functions in logseq-api.js
- [x] Created transcript-updater.js module
- [x] Exported `makeRequest()` from logseq-api.js

### UI Integration
- [x] Updated ActionBar.svelte imports
- [x] Replaced `updatePageTranscription()` calls
- [x] Added new logging messages
- [x] Added error handling

### Documentation
- [x] Implementation summary
- [x] Integration guide
- [x] Testing instructions
- [x] Visual reference

## 🧪 Testing Checklist

### Before Testing
- [ ] LogSeq is running with HTTP API enabled
- [ ] MyScript credentials configured
- [ ] Have pen connected OR test strokes loaded

### Test 1: First Save
- [ ] Transcribe strokes
- [ ] Save to LogSeq
- [ ] Check console for "✅ Transcription saved: N new"
- [ ] Open LogSeq page
- [ ] Verify properties exist (stroke-y-bounds, canonical-transcript)
- [ ] Verify TODO/DONE markers correct

### Test 2: Edit Preservation ⭐ CRITICAL
- [ ] In LogSeq: Check off a TODO task
- [ ] In LogSeq: Add tags (#tag @person)
- [ ] In LogSeq: Fix a typo
- [ ] In app: Save again (don't add new strokes)
- [ ] Check console for "N preserved"
- [ ] In LogSeq: Verify DONE status kept
- [ ] In LogSeq: Verify tags kept
- [ ] In LogSeq: Verify typo fix kept

### Test 3: Incremental Update
- [ ] Add more handwriting on same page
- [ ] Capture new strokes
- [ ] Transcribe
- [ ] Save to LogSeq
- [ ] Check console for "X new, Y preserved"
- [ ] In LogSeq: Verify old blocks unchanged
- [ ] In LogSeq: Verify new blocks added

### Test 4: Error Handling
- [ ] Disconnect LogSeq
- [ ] Try to save
- [ ] Verify graceful error message
- [ ] Reconnect LogSeq
- [ ] Verify save works again

## 🐛 Known Limitations

- [ ] **Y-bounds approximation** - Uses word boxes, not perfect
- [ ] **No hierarchy support** - All blocks at top level for now
- [ ] **Sequential operations** - Can be slow for large pages
- [ ] **No conflict UI** - Overlaps merge to first block

## 📊 Success Metrics

### Console Logs
✅ Should see:
```
Saving transcription blocks to Smartpen Data/B3017/P42...
✅ Transcription saved: 5 new, 2 updated, 3 preserved
```

❌ Should NOT see:
```
Saving transcription to... (old message)
Saved transcription to... (old message)
```

### LogSeq Format
✅ Should see:
```
## Transcribed Content

stroke-y-bounds:: 1234.5-1289.3
canonical-transcript:: [ ] Task
- TODO Task
```

❌ Should NOT see:
```
## Transcribed Text
```
(Old code block format)

### User Edits
✅ After re-save:
- DONE stays DONE
- Tags stay
- Custom text stays

❌ After re-save:
- DONE becomes TODO
- Tags disappear
- Edits lost

## 🚀 Quick Test Script

```
1. Transcribe some strokes
2. Save to LogSeq
3. In LogSeq: Mark task as DONE
4. In app: Save again
5. In LogSeq: Check if still DONE ← PASS/FAIL?
```

## 📝 Notes

- First save after update will create all new blocks
- Subsequent saves will preserve edits
- Old code blocks won't be removed automatically
- Can have both formats on same page

## ✉️ What to Report

If testing fails:
1. ❌ Which test failed?
2. 🖥️ Console error message (exact text)
3. 📄 Book/Page numbers
4. 📸 Screenshot of LogSeq format
5. 🔄 First save or re-save?

## 🎉 Success Criteria

The integration is successful if:
1. ✅ Transcription creates property-based blocks
2. ✅ Re-transcribing preserves user edits
3. ✅ Console shows new v2.0 messages
4. ✅ No errors in console
5. ✅ LogSeq blocks have correct format

---

**Ready to test!** Start with Test 2 - it's the most important one.
