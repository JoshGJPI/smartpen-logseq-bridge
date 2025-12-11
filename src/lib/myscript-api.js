/**
 * MyScript Cloud API Integration
 * Handles handwriting recognition via MyScript's REST API
 */

const MYSCRIPT_API_URL = 'https://cloud.myscript.com/api/v4.0/iink/batch';

/**
 * Generate HMAC-SHA512 signature for MyScript API
 */
async function generateSignature(appKey, hmacKey, message) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(appKey + hmacKey);
  const messageData = encoder.encode(message);
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert pen strokes to MyScript format
 */
function convertStrokesToMyScript(strokes) {
  if (!strokes || strokes.length === 0) {
    throw new Error('No strokes to convert');
  }

  // Calculate bounds
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  
  strokes.forEach(stroke => {
    if (!stroke.dotArray || stroke.dotArray.length === 0) return;
    stroke.dotArray.forEach(dot => {
      if (dot.x < minX) minX = dot.x;
      if (dot.x > maxX) maxX = dot.x;
      if (dot.y < minY) minY = dot.y;
      if (dot.y > maxY) maxY = dot.y;
    });
  });
  
  // Conversion factor: Ncode to pixels
  // 1 Ncode unit × 2.371 = 1mm
  // (ncodeValue × 2.371 × DPI) / 25.4 = pixels
  const DPI = 96;
  const NCODE_TO_MM = 2.371;
  const MM_TO_PIXELS = DPI / 25.4;
  const NCODE_TO_PIXELS = NCODE_TO_MM * MM_TO_PIXELS;
  
  const padding = 10; // pixels
  
  // Convert strokes - filter out empty strokes
  const msStrokes = strokes
    .filter(stroke => stroke.dotArray && stroke.dotArray.length > 0)
    .map(stroke => {
      const x = [];
      const y = [];
      const t = [];
      const p = [];
      
      stroke.dotArray.forEach(dot => {
        // Convert Ncode coordinates to pixels with padding
        const pixelX = (dot.x - minX) * NCODE_TO_PIXELS + padding;
        const pixelY = (dot.y - minY) * NCODE_TO_PIXELS + padding;
        
        x.push(pixelX);
        y.push(pixelY);
        t.push(dot.timestamp || Date.now());
        p.push((dot.f || 500) / 1000); // Normalize pressure 0-1
      });
      
      return { x, y, t, p };
    });
  
  // MyScript expects strokeGroups with strokes inside
  const strokeGroups = [{
    strokes: msStrokes
  }];
  
  const width = (maxX - minX) * NCODE_TO_PIXELS + padding * 2;
  const height = (maxY - minY) * NCODE_TO_PIXELS + padding * 2;
  
  return {
    strokeGroups,
    width: Math.ceil(width),
    height: Math.ceil(height)
  };
}

/**
 * Build MyScript API request
 */
function buildRequest(strokes, options = {}) {
  const { strokeGroups, width, height } = convertStrokesToMyScript(strokes);
  
  return {
    xDPI: 96,
    yDPI: 96,
    contentType: 'Text',
    configuration: {
      lang: options.lang || 'en_US',
      text: {
        guides: { enable: false },
        mimeTypes: ['text/plain', 'application/vnd.myscript.jiix']
      },
      export: {
        jiix: {
          'bounding-box': true,
          strokes: true,
          text: { chars: true, words: true }
        }
      }
    },
    strokeGroups,
    width,
    height
  };
}

/**
 * Parse MyScript response and extract structured data
 */
function parseMyScriptResponse(response) {
  console.log('MyScript response:', response);
  
  // MyScript returns the text with \n line breaks - TRUST THIS!
  const text = response.label || '';
  const words = response.words || [];
  
  console.log('Text:', text);
  console.log('Words count:', words.length);
  
  // Split by MyScript's line breaks
  const labelLines = text.split('\n').filter(l => l.trim());
  console.log('Label lines:', labelLines);
  
  // Build lines with word data
  const lines = [];
  
  // Try to match words to lines based on Y position (baseline)
  labelLines.forEach((lineText, lineIdx) => {
    // Find words that match this line's text
    const lineWords = [];
    const lineTextWords = lineText.split(/\s+/).filter(w => w.length > 0);
    
    // Try to find matching words in the words array
    let searchStart = 0;
    for (const textWord of lineTextWords) {
      for (let i = searchStart; i < words.length; i++) {
        const word = words[i];
        if (word && word.label && word.label.toLowerCase() === textWord.toLowerCase()) {
          lineWords.push(word);
          searchStart = i + 1;
          break;
        }
      }
    }
    
    // Calculate line position
    let lineX = 0;
    let lineY = lineIdx * 20;
    
    if (lineWords.length > 0) {
      // Use actual word positions
      const leftmostWord = lineWords.reduce((left, word) => 
        !left || word['bounding-box'].x < left['bounding-box'].x ? word : left
      , null);
      
      lineX = leftmostWord['bounding-box'].x;
      lineY = leftmostWord['bounding-box'].y;
    } else if (words.length > 0) {
      // Estimate position based on line index
      lineX = Math.min(...words.map(w => w['bounding-box'].x));
      lineY = lineIdx * 20;
    }
    
    lines.push({
      text: lineText,
      words: lineWords,
      x: lineX,
      baseline: lineY
    });
  });
  
  console.log('Parsed lines:', lines);
  
  // Calculate indentation
  if (lines.length > 0) {
    // Get all unique X positions and sort them
    const xPositions = [...new Set(lines.map(l => l.x))].sort((a, b) => a - b);
    const baseX = xPositions[0];
    
    // Calculate indent unit from word heights
    const wordHeights = words
      .filter(w => w['bounding-box'])
      .map(w => w['bounding-box'].height);
    const medianHeight = wordHeights.length > 0 
      ? wordHeights.sort((a, b) => a - b)[Math.floor(wordHeights.length / 2)]
      : 20;
    const indentUnit = medianHeight * 0.75; // More sensitive to smaller indents
    
    console.log('Base X:', baseX, 'Indent unit:', indentUnit);
    console.log('X positions:', xPositions);
    
    // Cluster X positions into indent levels
    // Group positions that are within indentUnit/2 of each other
    const indentLevels = [];
    xPositions.forEach(x => {
      const indentPixels = x - baseX;
      const level = Math.round(indentPixels / indentUnit);
      
      // Find or create indent level
      let existingLevel = indentLevels.find(l => Math.abs(l.level - level) < 0.5);
      if (!existingLevel) {
        existingLevel = { level, xPositions: [] };
        indentLevels.push(existingLevel);
      }
      existingLevel.xPositions.push(x);
    });
    
    // Sort by level and calculate average X for each level
    indentLevels.sort((a, b) => a.level - b.level);
    const levelMap = new Map();
    indentLevels.forEach((levelData, idx) => {
      levelData.xPositions.forEach(x => {
        levelMap.set(x, idx);
      });
    });
    
    console.log('Indent levels:', indentLevels);
    console.log('Level map:', levelMap);
    
    lines.forEach(line => {
      line.indentLevel = levelMap.get(line.x) || 0;
      console.log(`Line "${line.text}" - X: ${line.x}, Level: ${line.indentLevel}`);
    });
    
    // Build hierarchy
    const stack = [{ indent: -1, index: -1 }];
    lines.forEach((line, index) => {
      line.parent = null;
      line.children = [];
      
      // Pop until we find a parent with lower indent
      while (stack.length > 1 && stack[stack.length - 1].indent >= line.indentLevel) {
        stack.pop();
      }
      
      const parent = stack[stack.length - 1];
      if (parent.index >= 0) {
        line.parent = parent.index;
        lines[parent.index].children.push(index);
      }
      
      stack.push({ indent: line.indentLevel, index });
    });
  }
  
  // Detect commands like [page: Title] or [sketch]
  const commands = [];
  const commandPattern = /\[(\w+)(?::\s*([^\]]+))?\]/g;
  
  lines.forEach((line, lineIndex) => {
    let match;
    while ((match = commandPattern.exec(line.text)) !== null) {
      const command = match[1].toLowerCase();
      const value = match[2] ? match[2].trim() : null;
      
      // Find all descendant lines
      const affectedLines = [lineIndex];
      const findChildren = (idx) => {
        lines[idx].children.forEach(childIdx => {
          affectedLines.push(childIdx);
          findChildren(childIdx);
        });
      };
      findChildren(lineIndex);
      
      commands.push({
        command,
        value,
        lineIndex,
        affectedLines
      });
    }
  });
  
  console.log('Final lines:', lines);
  console.log('Commands:', commands);
  
  return {
    text,
    lines,
    words,
    commands,
    raw: response
  };
}

/**
 * Test MyScript credentials
 */
export async function testMyScriptCredentials(appKey, hmacKey) {
  try {
    // Create a minimal test request
    const testRequest = {
      xDPI: 96,
      yDPI: 96,
      contentType: 'Text',
      configuration: {
        lang: 'en_US',
        text: { mimeTypes: ['text/plain'] }
      },
      strokeGroups: [{
        x: [10, 20, 30],
        y: [10, 10, 10],
        t: [0, 100, 200],
        p: [0.5, 0.5, 0.5]
      }],
      width: 100,
      height: 100
    };
    
    const message = JSON.stringify(testRequest);
    const signature = await generateSignature(appKey, hmacKey, message);
    
    const response = await fetch(MYSCRIPT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, application/vnd.myscript.jiix',
        'applicationKey': appKey,
        'hmac': signature
      },
      body: message
    });
    
    if (response.ok) {
      return { success: true };
    } else {
      const errorText = await response.text();
      return { 
        success: false, 
        error: `HTTP ${response.status}: ${errorText}`,
        status: response.status 
      };
    }
  } catch (error) {
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Transcribe strokes to text
 */
export async function transcribeStrokes(strokes, appKey, hmacKey, options = {}) {
  try {
    if (!strokes || strokes.length === 0) {
      throw new Error('No strokes to transcribe');
    }
    
    if (!appKey || !hmacKey) {
      throw new Error('MyScript API credentials not configured');
    }
    
    // Build request
    const requestBody = buildRequest(strokes, options);
    const message = JSON.stringify(requestBody);
    
    // Generate signature
    const signature = await generateSignature(appKey, hmacKey, message);
    
    // Make API call
    const response = await fetch(MYSCRIPT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, application/vnd.myscript.jiix',
        'applicationKey': appKey,
        'hmac': signature
      },
      body: message
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MyScript API error (${response.status}): ${errorText}`);
    }
    
    const data = await response.json();
    
    // Parse and return structured result
    return parseMyScriptResponse(data);
    
  } catch (error) {
    console.error('MyScript transcription error:', error);
    throw error;
  }
}
