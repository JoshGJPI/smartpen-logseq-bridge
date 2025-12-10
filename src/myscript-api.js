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
    this.applicationKey = applicationKey;
    this.hmacKey = hmacKey;
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
    this.applicationKey = applicationKey;
    this.hmacKey = hmacKey;
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
   * @param {string} data - Data to sign
   * @returns {Promise<string>} HMAC signature
   */
  async generateHMAC(data) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(this.hmacKey);
    const messageData = encoder.encode(data);
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign']
    );
    
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    
    // Convert to hex string
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
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
        'Accept': 'application/json,application/vnd.myscript.jiix',
        'applicationKey': this.applicationKey,
        'hmac': hmacSignature
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
      lines: [],
      commands: [] // Detected [command: value] patterns
    };
    
    // Extract plain text
    if (result.label) {
      parsed.text = result.label;
    }
    
    // Parse JIIX format if available (has bounding boxes)
    if (result.jiix) {
      const jiix = typeof result.jiix === 'string' ? JSON.parse(result.jiix) : result.jiix;
      parsed.jiix = jiix;
      
      // Extract words with positions
      if (jiix.words) {
        parsed.words = jiix.words.map(word => ({
          text: word.label,
          boundingBox: word['bounding-box'],
          candidates: word.candidates,
          // Convert back to Ncode coordinates for comparison
          ncodePosition: word['bounding-box'] ? {
            x: (word['bounding-box'].x / this.mmToPixels / this.ncodeToMm) + bounds.minX,
            y: (word['bounding-box'].y / this.mmToPixels / this.ncodeToMm) + bounds.minY
          } : null
        }));
      }
      
      // Group words into lines based on Y position
      parsed.lines = this.groupIntoLines(parsed.words, bounds);
      
      // Detect indentation levels
      parsed.lines = this.detectIndentation(parsed.lines);
      
      // Look for command patterns [command: value]
      parsed.commands = this.extractCommands(parsed.text, parsed.lines);
    }
    
    return parsed;
  }
  
  /**
   * Group words into lines based on vertical position
   */
  groupIntoLines(words, bounds) {
    if (words.length === 0) return [];
    
    // Sort by Y position
    const sortedWords = [...words].sort((a, b) => {
      const ay = a.boundingBox?.y || 0;
      const by = b.boundingBox?.y || 0;
      return ay - by;
    });
    
    const lines = [];
    let currentLine = { words: [], y: 0, minX: Infinity };
    const lineThreshold = 15; // pixels - adjust based on line height
    
    sortedWords.forEach(word => {
      const wordY = word.boundingBox?.y || 0;
      const wordX = word.boundingBox?.x || 0;
      
      if (currentLine.words.length === 0) {
        currentLine.y = wordY;
        currentLine.minX = wordX;
        currentLine.words.push(word);
      } else if (Math.abs(wordY - currentLine.y) < lineThreshold) {
        // Same line
        currentLine.minX = Math.min(currentLine.minX, wordX);
        currentLine.words.push(word);
      } else {
        // New line
        lines.push(this.finalizeLine(currentLine));
        currentLine = { words: [word], y: wordY, minX: wordX };
      }
    });
    
    if (currentLine.words.length > 0) {
      lines.push(this.finalizeLine(currentLine));
    }
    
    return lines;
  }
  
  /**
   * Finalize a line object
   */
  finalizeLine(line) {
    // Sort words by X position within line
    line.words.sort((a, b) => {
      const ax = a.boundingBox?.x || 0;
      const bx = b.boundingBox?.x || 0;
      return ax - bx;
    });
    
    return {
      text: line.words.map(w => w.text).join(' '),
      words: line.words,
      y: line.y,
      x: line.minX,
      indentLevel: 0 // Will be calculated later
    };
  }
  
  /**
   * Detect indentation levels based on X position
   */
  detectIndentation(lines) {
    if (lines.length === 0) return lines;
    
    // Find the leftmost position (base indent)
    const baseX = Math.min(...lines.map(l => l.x));
    const indentUnit = 20; // pixels - approximate indent width
    
    return lines.map(line => ({
      ...line,
      indentLevel: Math.round((line.x - baseX) / indentUnit)
    }));
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
