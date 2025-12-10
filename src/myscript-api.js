/**
 * MyScript iink Cloud API Integration
 * Converts stroke data to text using MyScript's handwriting recognition
 * 
 * Setup:
 * 1. Create account at https://developer.myscript.com/
 * 2. Create an application to get Application Key and HMAC Key
 * 3. Enter keys in the UI settings
 */

export class MyScriptAPI {
  constructor(applicationKey, hmacKey) {
    // Trim any whitespace from keys
    this.applicationKey = (applicationKey || '').trim();
    this.hmacKey = (hmacKey || '').trim();
    // Batch endpoint for offline/batch recognition
    this.baseUrl = 'https://cloud.myscript.com/api/v4.0/iink/batch';
    
    // Ncode coordinate scale - adjust based on your paper
    // Ncode units * 2.371 = mm, we'll convert to a reasonable DPI
    this.ncodeToMm = 2.371;
    this.targetDPI = 96; // Standard screen DPI
    this.mmToPixels = this.targetDPI / 25.4; // mm to pixels at target DPI
  }
  
  /**
   * Set API credentials
   */
  setCredentials(applicationKey, hmacKey) {
    // Trim any whitespace from keys
    this.applicationKey = (applicationKey || '').trim();
    this.hmacKey = (hmacKey || '').trim();
    
    console.log('Credentials set:', {
      appKeyLength: this.applicationKey.length,
      hmacKeyLength: this.hmacKey.length,
      appKeyFormat: this.applicationKey.includes('-') ? 'UUID' : 'other'
    });
  }
  
  /**
   * Test API credentials with a minimal request
   * @returns {Promise<Object>} Test result
   */
  async testCredentials() {
    if (!this.hasCredentials()) {
      return { success: false, error: 'Credentials not configured' };
    }
    
    // Minimal test payload matching BatchInput schema
    const testBody = JSON.stringify({
      contentType: 'Text',
      strokeGroups: [{
        strokes: [{
          x: [10, 20, 30, 40, 50],
          y: [10, 10, 10, 10, 10]
        }]
      }],
      xDPI: 96,
      yDPI: 96,
      width: 100,
      height: 50
    });
    
    const hmac = await this.generateHMAC(testBody);
    
    console.log('=== MyScript Credential Test ===' );
    console.log('Endpoint:', this.baseUrl);
    console.log('Application Key:', this.applicationKey);
    console.log('HMAC Key:', this.hmacKey);
    console.log('Combined Key (appKey+hmacKey) length:', (this.applicationKey + this.hmacKey).length);
    console.log('HMAC Signature:', hmac);
    console.log('Request Body:', testBody);
    
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/plain, application/json',
          'applicationKey': this.applicationKey,
          'hmac': hmac
        },
        body: testBody
      });
      
      const responseText = await response.text();
      console.log('Response status:', response.status);
      console.log('Response body:', responseText);
      
      if (response.ok) {
        return { success: true, status: response.status, response: responseText };
      } else {
        return { 
          success: false, 
          status: response.status, 
          error: responseText
        };
      }
    } catch (error) {
      console.error('Fetch error:', error);
      return { 
        success: false, 
        error: error.message,
        isCorsError: error.message.includes('fetch') || error.message.includes('network')
      };
    }
  }
  
  /**
   * Check if credentials are configured
   */
  hasCredentials() {
    return !!(this.applicationKey && this.hmacKey);
  }
  
  /**
   * Convert our stroke format to MyScript format
   * @param {Array} strokes - Array of stroke objects with dotArray
   * @returns {Object} MyScript-compatible stroke data
   */
  convertStrokesToMyScript(strokes) {
    // Find bounds to normalize coordinates
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    strokes.forEach(stroke => {
      (stroke.dotArray || []).forEach(dot => {
        minX = Math.min(minX, dot.x);
        minY = Math.min(minY, dot.y);
        maxX = Math.max(maxX, dot.x);
        maxY = Math.max(maxY, dot.y);
      });
    });
    
    // Convert strokes to MyScript format
    const msStrokes = strokes.map(stroke => {
      const dots = stroke.dotArray || [];
      if (dots.length === 0) return null;
      
      // Convert coordinates: Ncode → mm → pixels
      // Offset to start near origin (with padding)
      const padding = 10; // pixels
      
      return {
        x: dots.map(d => ((d.x - minX) * this.ncodeToMm * this.mmToPixels) + padding),
        y: dots.map(d => ((d.y - minY) * this.ncodeToMm * this.mmToPixels) + padding),
        // Include timestamp if available (helps with recognition)
        t: dots.map(d => d.timestamp || 0),
        // Pressure (normalized 0-1)
        p: dots.map(d => Math.min(1, (d.f || 500) / 1000))
      };
    }).filter(s => s !== null);
    
    return {
      strokes: msStrokes,
      bounds: {
        minX, minY, maxX, maxY,
        width: (maxX - minX) * this.ncodeToMm,
        height: (maxY - minY) * this.ncodeToMm
      }
    };
  }
  
  /**
   * Generate HMAC signature for MyScript API
   * Per docs: Key = applicationKey + hmacKey, Message = payload
   * @param {string} payload - Request body (the payload)
   * @returns {Promise<string>} HMAC signature as hex string
   */
  async generateHMAC(payload) {
    const encoder = new TextEncoder();
    // Per MyScript docs: the signing key is applicationKey + hmacKey concatenated
    const userKey = this.applicationKey + this.hmacKey;
    const keyData = encoder.encode(userKey);
    const messageData = encoder.encode(payload);
    
    try {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-512' },
        false,
        ['sign']
      );
      
      const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
      
      // Convert to hex string
      const hexSignature = Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      console.log('HMAC generated:', {
        userKeyLength: userKey.length,
        payloadLength: payload.length,
        signatureLength: hexSignature.length
      });
      
      return hexSignature;
    } catch (error) {
      console.error('HMAC generation failed:', error);
      throw new Error(`Failed to generate HMAC signature: ${error.message}`);
    }
  }
  
  /**
   * Recognize handwriting from strokes
   * @param {Array} strokes - Array of stroke objects
   * @param {Object} options - Recognition options
   * @returns {Promise<Object>} Recognition result with text and structure
   */
  async recognize(strokes, options = {}) {
    if (!this.hasCredentials()) {
      throw new Error('MyScript credentials not configured. Please enter Application Key and HMAC Key.');
    }
    
    if (!strokes || strokes.length === 0) {
      throw new Error('No strokes to recognize');
    }
    
    const { strokes: msStrokes, bounds } = this.convertStrokesToMyScript(strokes);
    
    // Calculate content dimensions in pixels
    const contentWidth = Math.ceil(bounds.width * this.mmToPixels) + 40;
    const contentHeight = Math.ceil(bounds.height * this.mmToPixels) + 40;
    
    // Build request body
    const requestBody = {
      xDPI: this.targetDPI,
      yDPI: this.targetDPI,
      contentType: options.contentType || 'Text', // Text, Math, Diagram, Raw Content
      configuration: {
        lang: options.language || 'en_US',
        text: {
          guides: {
            enable: false // We'll handle line detection ourselves
          },
          mimeTypes: ['text/plain', 'application/vnd.myscript.jiix'],
          margin: {
            top: 10,
            left: 10,
            right: 10,
            bottom: 10
          }
        },
        export: {
          jiix: {
            'bounding-box': true, // Get bounding boxes for spatial analysis
            strokes: true,        // Include stroke associations
            text: {
              chars: true,        // Character-level detail
              words: true         // Word-level detail
            }
          }
        }
      },
      strokeGroups: [{
        strokes: msStrokes
      }],
      width: contentWidth,
      height: contentHeight
    };
    
    const bodyString = JSON.stringify(requestBody);
    
    // Generate HMAC signature
    const hmacSignature = await this.generateHMAC(bodyString);
    
    console.log('MyScript request:', {
      strokeCount: msStrokes.length,
      contentSize: `${contentWidth}x${contentHeight}`,
      bodyLength: bodyString.length
    });
    
    // Make API request
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Per docs: Must contain application/json + desired response format
        'Accept': 'application/json, application/vnd.myscript.jiix, text/plain',
        'applicationKey': this.applicationKey,
        'hmac': hmacSignature,
        'myscript-client-name': 'smartpen-logseq-bridge',
        'myscript-client-version': '0.1.0'
      },
      body: bodyString
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('MyScript API error:', response.status, errorText);
      throw new Error(`MyScript API error: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    
    // Parse and enhance the result
    return this.parseResult(result, strokes, bounds);
  }
  
  /**
   * Parse MyScript result and add spatial analysis
   * TRUSTS MyScript's line detection (\n in label), then calculates indentation from X positions
   * @param {Object} result - Raw MyScript response
   * @param {Array} originalStrokes - Original stroke data
   * @param {Object} bounds - Original coordinate bounds
   * @returns {Object} Enhanced result with line/indent analysis
   */
  parseResult(result, originalStrokes, bounds) {
    const parsed = {
      raw: result,
      text: '',
      words: [],
      chars: [],
      lines: [],
      commands: [],
      lineMetrics: null
    };
    
    // Extract plain text - MyScript already detected lines with \n!
    if (result.label) {
      parsed.text = result.label;
    }
    
    // Parse character data if available
    if (result.chars) {
      parsed.chars = result.chars
        .filter(char => char.label && char.label.trim() !== '' && char.label !== '\n')
        .map(char => ({
          label: char.label,
          boundingBox: char['bounding-box'],
          wordIndex: char.word,
          hasDescender: this.isDescenderChar(char.label)
        }));
    }
    
    // Parse words with bounding boxes
    if (result.words) {
      parsed.words = result.words
        .filter(word => word.label && word.label !== '\n' && word.label.trim() !== '')
        .map((word, wordIndex) => {
          const bbox = word['bounding-box'];
          if (!bbox) return null;
          
          return {
            text: word.label,
            boundingBox: bbox,
            candidates: word.candidates,
            firstChar: word['first-char'],
            lastChar: word['last-char'],
            baseline: bbox.y + bbox.height, // Simple baseline for now
            bottom: bbox.y + bbox.height,
            ncodePosition: {
              x: (bbox.x / this.mmToPixels / this.ncodeToMm) + bounds.minX,
              y: (bbox.y / this.mmToPixels / this.ncodeToMm) + bounds.minY
            }
          };
        })
        .filter(w => w !== null);
    }
    
    // KEY CHANGE: Use MyScript's line breaks, not our own grouping
    parsed.lines = this.buildLinesFromLabel(parsed.text, parsed.words);
    
    // Calculate line metrics from the detected lines
    parsed.lineMetrics = this.calculateLineMetricsFromLines(parsed.lines);
    
    // Detect indentation levels based on X position
    parsed.lines = this.detectIndentation(parsed.lines, parsed.lineMetrics);
    
    // Build line hierarchy (parent/child relationships)
    parsed.lines = this.buildLineHierarchy(parsed.lines);
    
    // Look for command patterns [command: value]
    parsed.commands = this.extractCommands(parsed.text, parsed.lines);
    
    // Add summary
    parsed.summary = {
      totalLines: parsed.lines.length,
      totalWords: parsed.words.length,
      hasIndentation: parsed.lines.some(l => l.indentLevel > 0),
      hasCommands: parsed.commands.length > 0,
      lineMetrics: parsed.lineMetrics
    };
    
    return parsed;
  }
  
  /**
   * Build lines from MyScript's label (which has \n for line breaks)
   * Then match words to lines for position data
   * This TRUSTS MyScript's line detection instead of re-calculating
   */
  buildLinesFromLabel(labelText, words) {
    if (!labelText) return [];
    
    // Split by newlines - this is MyScript's line detection
    const lineTexts = labelText.split('\n').filter(line => line.trim() !== '');
    
    // Create a copy of words to track which have been assigned
    const availableWords = [...words];
    
    const lines = lineTexts.map((lineText, lineIndex) => {
      // Find words that belong to this line by matching text
      const lineWords = this.matchWordsToLine(lineText, availableWords);
      
      // Remove matched words from available pool
      lineWords.forEach(w => {
        const idx = availableWords.indexOf(w);
        if (idx !== -1) availableWords.splice(idx, 1);
      });
      
      // Sort words by X position (left to right)
      lineWords.sort((a, b) => a.boundingBox.x - b.boundingBox.x);
      
      // Calculate line position from its words
      const minX = lineWords.length > 0 
        ? Math.min(...lineWords.map(w => w.boundingBox.x))
        : 0;
      const avgBaseline = lineWords.length > 0
        ? lineWords.reduce((sum, w) => sum + w.baseline, 0) / lineWords.length
        : lineIndex * 10; // Fallback if no position data
      
      return {
        text: lineText,
        words: lineWords,
        x: minX,
        baseline: avgBaseline,
        top: lineWords.length > 0 ? Math.min(...lineWords.map(w => w.boundingBox.y)) : 0,
        bottom: lineWords.length > 0 ? Math.max(...lineWords.map(w => w.bottom)) : 0,
        indentLevel: 0,
        parent: null,
        children: [],
        lineIndex: lineIndex
      };
    });
    
    console.log('Lines built from MyScript label:', {
      lineCount: lines.length,
      wordsMatched: words.length - availableWords.length,
      wordsUnmatched: availableWords.length
    });
    
    // Log any unmatched words for debugging
    if (availableWords.length > 0) {
      console.warn('Unmatched words:', availableWords.map(w => w.text));
    }
    
    return lines;
  }
  
  /**
   * Match words to a line by finding words whose text appears in the line
   * Uses a greedy approach to match words in order
   */
  matchWordsToLine(lineText, availableWords) {
    const matchedWords = [];
    
    // Normalize line text for matching
    const normalizedLine = lineText.toLowerCase();
    
    // Split line into expected words for better matching
    const expectedWords = lineText.split(/\s+/).filter(w => w.trim());
    
    // Try to match each word in order of appearance in lineText
    for (const word of availableWords) {
      const normalizedWord = word.text.toLowerCase();
      
      // Check if this word appears in the line text
      if (normalizedLine.includes(normalizedWord)) {
        matchedWords.push(word);
      }
    }
    
    // Debug: Log if word count differs significantly from expected
    if (Math.abs(matchedWords.length - expectedWords.length) > 2) {
      console.warn('Word count mismatch for line:', {
        lineText: lineText.substring(0, 50),
        expected: expectedWords.length,
        matched: matchedWords.length,
        matchedWords: matchedWords.map(w => ({ text: w.text, x: w.boundingBox?.x?.toFixed(1) }))
      });
    }
    
    // If we got too many matches (word appears in multiple lines), 
    // use position clustering to pick the right ones
    if (matchedWords.length > expectedWords.length * 1.5) {
      // Too many matches - fall back to position-based clustering
      return this.clusterWordsByPosition(matchedWords, lineText);
    }
    
    return matchedWords;
  }
  
  /**
   * When text matching gives too many results, cluster by Y position
   * to find words that are actually on the same line
   */
  clusterWordsByPosition(words, lineText) {
    if (words.length === 0) return [];
    
    // Expected word count from line text
    const expectedCount = lineText.split(/\s+/).filter(w => w.trim()).length;
    
    // Sort by Y position (baseline)
    const sorted = [...words].sort((a, b) => a.baseline - b.baseline);
    
    // Find clusters of words at similar Y positions
    const clusters = [];
    let currentCluster = [sorted[0]];
    
    for (let i = 1; i < sorted.length; i++) {
      const yDiff = Math.abs(sorted[i].baseline - sorted[i-1].baseline);
      const threshold = sorted[i].boundingBox.height * 0.5;
      
      if (yDiff < threshold) {
        currentCluster.push(sorted[i]);
      } else {
        clusters.push(currentCluster);
        currentCluster = [sorted[i]];
      }
    }
    clusters.push(currentCluster);
    
    // Find the cluster closest to expected word count
    let bestCluster = clusters[0];
    let bestDiff = Math.abs(clusters[0].length - expectedCount);
    
    for (const cluster of clusters) {
      const diff = Math.abs(cluster.length - expectedCount);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestCluster = cluster;
      }
    }
    
    return bestCluster;
  }
  
  /**
   * Characters that have descenders (drop below baseline)
   */
  isDescenderChar(char) {
    return 'gjpqy'.includes(char.toLowerCase());
  }
  
  /**
   * Calculate the baseline Y position for a word
   * Accounts for descender letters that drop below the baseline
   * @param {Object} word - Word object from MyScript
   * @param {Array} chars - All character data
   * @param {number} wordIndex - Index of this word
   * @returns {number} Estimated baseline Y position
   */
  calculateWordBaseline(word, chars, wordIndex) {
    const bbox = word['bounding-box'];
    if (!bbox) return 0;
    
    const wordBottom = bbox.y + bbox.height;
    
    // If we have character data, find non-descender characters in this word
    const wordChars = chars.filter(c => c.wordIndex === wordIndex && c.boundingBox);
    
    if (wordChars.length > 0) {
      // Find bottoms of non-descender characters
      const nonDescenderBottoms = wordChars
        .filter(c => !c.hasDescender)
        .map(c => c.boundingBox.y + c.boundingBox.height);
      
      if (nonDescenderBottoms.length > 0) {
        // Use the median bottom of non-descender chars as baseline
        nonDescenderBottoms.sort((a, b) => a - b);
        const median = nonDescenderBottoms[Math.floor(nonDescenderBottoms.length / 2)];
        return median;
      }
    }
    
    // Fallback: Check if word contains descender letters
    const hasDescender = word.label && /[gjpqy]/i.test(word.label);
    if (hasDescender) {
      // Estimate: descenders typically add ~20% to word height
      // So baseline is roughly at 80% of the word bottom
      return bbox.y + (bbox.height * 0.8);
    }
    
    // No descenders: bottom of word IS the baseline
    return wordBottom;
  }
  
  /**
   * Calculate line metrics from detected lines
   * Uses X positions of lines to determine indent unit
   * @param {Array} lines - Lines with position data
   * @returns {Object} Line metrics
   */
  calculateLineMetricsFromLines(lines) {
    if (lines.length === 0) {
      return {
        medianHeight: 10,
        lineThreshold: 6,
        indentUnit: 15,
        baselineVariance: 3
      };
    }
    
    // Get word heights from all lines
    const allWords = lines.flatMap(l => l.words || []);
    const heights = allWords
      .filter(w => w.boundingBox)
      .map(w => w.boundingBox.height)
      .sort((a, b) => a - b);
    
    const medianHeight = heights.length > 0 
      ? heights[Math.floor(heights.length / 2)] 
      : 10;
    
    // Calculate indent unit from X position differences
    // Find the smallest non-trivial X difference between lines
    const xPositions = lines
      .map(l => l.x)
      .filter(x => x > 0)
      .sort((a, b) => a - b);
    
    let indentUnit = medianHeight * 2; // Default
    
    if (xPositions.length > 1) {
      // Find X differences
      const xDiffs = [];
      const baseX = Math.min(...xPositions);
      
      for (const x of xPositions) {
        const diff = x - baseX;
        if (diff > medianHeight * 0.5) { // Significant difference
          xDiffs.push(diff);
        }
      }
      
      if (xDiffs.length > 0) {
        // Use the smallest significant difference as indent unit
        xDiffs.sort((a, b) => a - b);
        indentUnit = xDiffs[0];
      }
    }
    
    // Ensure reasonable indent unit (not too small or too large)
    indentUnit = Math.max(indentUnit, medianHeight);
    indentUnit = Math.min(indentUnit, medianHeight * 5);
    
    console.log('Line metrics calculated from lines:', {
      medianHeight: medianHeight.toFixed(2),
      indentUnit: indentUnit.toFixed(2),
      lineCount: lines.length,
      wordCount: allWords.length
    });
    
    return {
      medianHeight,
      lineThreshold: medianHeight * 0.6,
      indentUnit,
      baselineVariance: medianHeight * 0.25
    };
  }
  
  /**
   * Detect indentation levels based on X position
   * Uses dynamic indent unit calculated from word metrics
   */
  detectIndentation(lines, metrics) {
    if (lines.length === 0) return lines;
    
    const { indentUnit } = metrics;
    
    // Find the leftmost X position (base indent = 0)
    const baseX = Math.min(...lines.map(l => l.x));
    
    return lines.map((line, index) => {
      const indentPixels = line.x - baseX;
      const indentLevel = Math.round(indentPixels / indentUnit);
      
      return {
        ...line,
        lineIndex: index,
        indentLevel: Math.max(0, indentLevel), // Never negative
        indentPixels: indentPixels
      };
    });
  }
  
  /**
   * Build hierarchical parent/child relationships between lines
   * Based on indentation levels - crucial for command scope
   * @param {Array} lines - Lines with indent levels
   * @returns {Array} Lines with parent/children references
   */
  buildLineHierarchy(lines) {
    if (lines.length === 0) return lines;
    
    // Process lines in order to build hierarchy
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      line.children = [];
      line.parent = null;
      
      if (i === 0) continue; // First line has no parent
      
      // Look backwards for potential parent (lower indent level)
      for (let j = i - 1; j >= 0; j--) {
        if (lines[j].indentLevel < line.indentLevel) {
          // Found parent
          line.parent = j; // Store index reference
          lines[j].children.push(i);
          break;
        } else if (lines[j].indentLevel === line.indentLevel) {
          // Sibling - share the same parent
          line.parent = lines[j].parent;
          if (line.parent !== null) {
            lines[line.parent].children.push(i);
          }
          break;
        }
        // If indent is higher, keep looking back
      }
    }
    
    return lines;
  }
  
  /**
   * Get all descendant line indices for a given line
   * Useful for commands that affect "this line and all children"
   * @param {Array} lines - All lines
   * @param {number} lineIndex - Starting line index
   * @returns {Array} Array of line indices (including the starting line)
   */
  getDescendants(lines, lineIndex) {
    const descendants = [lineIndex];
    const line = lines[lineIndex];
    
    if (line && line.children) {
      for (const childIndex of line.children) {
        descendants.push(...this.getDescendants(lines, childIndex));
      }
    }
    
    return descendants;
  }
  
  /**
   * Extract command patterns like [page: 2025-12-09-JG]
   */
  extractCommands(text, lines) {
    const commands = [];
    const commandPattern = /\[(\w+):\s*([^\]]+)\]/g;
    
    let match;
    while ((match = commandPattern.exec(text)) !== null) {
      commands.push({
        full: match[0],
        command: match[1].toLowerCase(),
        value: match[2].trim(),
        position: match.index
      });
    }
    
    // Also check each line for commands
    lines.forEach((line, lineIndex) => {
      const lineMatch = line.text.match(/\[(\w+):\s*([^\]]+)\]/);
      if (lineMatch) {
        // Find if this command already exists
        const existing = commands.find(c => c.full === lineMatch[0]);
        if (existing) {
          existing.lineIndex = lineIndex;
          existing.line = line;
        }
      }
    });
    
    return commands;
  }
  
  /**
   * Recognize with retry logic
   */
  async recognizeWithRetry(strokes, options = {}, maxRetries = 2) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.recognize(strokes, options);
      } catch (error) {
        lastError = error;
        console.warn(`Recognition attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt < maxRetries) {
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }
    
    throw lastError;
  }
}
