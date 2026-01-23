# Incremental Update - Testing Checklist

**Date**: January 23, 2026  
**Implementation**: v4.1 Stroke → Block Persistence

---

## Quick Verification Steps

### ✅ Test 1: Basic Transcription with Persistence (5 minutes)

1. **Write some strokes** on your Lamy Safari pen
2. **Connect pen** and download offline data
3. **Save strokes** to LogSeq
4. **Transcribe** the strokes
5. **Save transcription** to LogSeq
6. **Close the app** completely
7. **Reopen the app**
8. **Check Console** for: `Loaded X strokes for B###/P#, Y with blockUuid`
   - ✅ Y should equal X (all strokes should have blockUuid)

**Expected Result**: Console shows strokes loaded with blockUuid restored

---

### ✅ Test 2: Incremental Addition (10 minutes)

1. **Load existing page** from Test 1 (with transcribed strokes)
2. **Write NEW strokes** on the same page
3. **Connect and download** the new strokes
4. **Look at UI** - Transcribe button should show something like `Transcribe (3/10)`
   - Where 3 = new untranscribed strokes, 10 = total strokes
5. **Transcribe** - only new strokes should be sent to MyScript
6. **Check Console** for: `Matching X strokes to Y blocks`
7. **Save** the transcription
8. **Check LogSeq** - verify existing blocks are untouched, new blocks added

**Expected Result**: 
- Old transcription blocks preserved
- New blocks created only for new strokes
- No duplicate content

---

### ✅ Test 3: Merge Blocks with Persistence (8 minutes)

1. **Load existing transcription** (from Test 1 or 2)
2. **Open transcription editor** (click "Edit" button)
3. **Select 2 adjacent lines**
4. **Merge them** using the Merge button
5. **Save changes**
6. **Check Console** for: `Reassigned X strokes from [UUID] to [UUID]`
7. **Close app** completely
8. **Reopen app**
9. **Load strokes** from that page
10. **Verify**: Strokes from deleted block now point to surviving block

**Expected Result**: 
- Stroke associations updated correctly
- Associations persist across sessions

---

### ✅ Test 4: Transcription Status UI (2 minutes)

1. **Load a page** with some transcribed and some untranscribed strokes
2. **Check UI** near Transcribe button:
   - Should show: `X/Y transcribed` indicator with green checkmark
   - Transcribe button should show: `Transcribe (N/M)` where N = untranscribed, M = total
3. **Transcribe remaining strokes**
4. **Verify**: Button changes to `Transcribed ✓` with green background

**Expected Result**: UI clearly shows transcription status

---

## Debug Logging to Watch For

### During Load
```
Loaded 450 strokes for B3017/P1, 450 with blockUuid
```

### During Transcription
```
Matching 450 strokes to 15 blocks
Assigning 450 strokes to blocks
Persisting 450 strokes with updated blockUuids
```

### During Merge
```
Reassigned 25 strokes from 64a3f2b1-... to abc-123...
Persisting 450 strokes with updated blockUuids
```

---

## Common Issues to Check

### Issue: Strokes don't have blockUuid after transcription
**Check**: 
1. Console for "Persisting X strokes with updated blockUuids"
2. LogSeq storage - open page and check Raw Stroke Data JSON
3. Look for `"blockUuid": "..."` in stroke data

### Issue: Incremental transcription creates duplicate blocks
**Check**:
1. Y-bounds on blocks (should be unique ranges)
2. Console for stroke matching output
3. Verify strokes have correct blockUuid before transcribing

### Issue: Merge doesn't persist across sessions
**Check**:
1. Console for "Persisting X strokes" after merge
2. LogSeq storage - verify blockUuids updated in stroke data
3. Settings - ensure LogSeq connection is configured

---

## Performance Checks

### Large Datasets (500+ strokes)
- Load time should be < 2 seconds
- Transcription should complete without timeouts
- Save operation should use chunked storage (200 strokes/chunk)

### Memory Usage
- Check browser DevTools memory tab
- Should not leak memory across multiple load/save cycles

---

## Edge Cases to Test (Optional)

### Edge Case 1: Empty Page
- Load page with no strokes
- Should show 0/0 transcribed
- Transcribe button should be disabled

### Edge Case 2: All Strokes Transcribed
- Load page where all strokes have blockUuid
- Should show "Transcribed ✓" button
- Status should show "X/X transcribed"

### Edge Case 3: Mixed Selection
- Select some transcribed and some untranscribed strokes
- Transcribe button should show correct count
- Should only transcribe the untranscribed ones

---

## Success Criteria

✅ **Phase 1-2: Data Persistence**
- [ ] blockUuid stored in LogSeq stroke data
- [ ] blockUuid restored when loading strokes
- [ ] All functions in strokes.js work as expected

✅ **Phase 3-5: Transcription Flow**
- [ ] Strokes matched to blocks after transcription
- [ ] blockUuid persisted to LogSeq after transcription
- [ ] Incremental updates don't delete existing blocks

✅ **Phase 6: Editor Persistence**
- [ ] Merges update stroke associations
- [ ] Changes persist across app restarts
- [ ] Console shows reassignment logs

✅ **Phase 7: UI Feedback**
- [ ] Status indicator shows transcription count
- [ ] Transcribe button shows untranscribed count
- [ ] Visual feedback when all transcribed

---

## If Something Breaks

### Quick Fixes
1. **Check Console**: Most issues will log errors
2. **Clear LocalStorage**: Sometimes cached settings cause issues
3. **Refresh Browser**: Hard refresh (Ctrl+Shift+R) to clear cache
4. **Check LogSeq**: Verify API connection is working

### Rollback Plan
If implementation causes major issues:
1. Git checkout previous commit
2. User can continue using old format
3. No data loss (old format still works)

---

## Next Steps After Testing

1. Document any issues found
2. Run through all test scenarios at least once
3. Test with real handwriting samples (not just simulator)
4. Verify LogSeq storage looks correct
5. Consider bumping version to 0.3.0

---

*Testing guide created: January 23, 2026*  
*Estimated testing time: 30-45 minutes*
