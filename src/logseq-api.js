/**
 * LogSeq API Integration
 * Communicates with LogSeq via its HTTP API (localhost:12315)
 * 
 * Prerequisites:
 * 1. Enable HTTP API in LogSeq: Settings > Advanced > Developer mode > Enable HTTP APIs server
 * 2. Optionally set an authorization token
 */

export class LogSeqAPI {
  constructor(host = 'http://127.0.0.1:12315', token = '') {
    this.host = host.replace(/\/$/, ''); // Remove trailing slash
    this.token = token;
  }
  
  /**
   * Make an API request to LogSeq
   */
  async request(method, args = []) {
    const headers = {
      'Content-Type': 'application/json',
    };
    
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    
    try {
      const response = await fetch(`${this.host}/api`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ method, args })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch')) {
        throw new Error('Cannot connect to LogSeq. Is the HTTP API enabled?');
      }
      throw error;
    }
  }
  
  /**
   * Test connection to LogSeq
   */
  async testConnection() {
    try {
      // Try to get current graph info
      const result = await this.request('logseq.App.getCurrentGraph');
      console.log('LogSeq graph:', result);
      return result !== null;
    } catch (error) {
      console.error('LogSeq connection test failed:', error);
      throw error;
    }
  }
  
  /**
   * Get all pages in the current graph
   */
  async getAllPages() {
    return await this.request('logseq.Editor.getAllPages');
  }
  
  /**
   * Get or create a page by name
   */
  async getOrCreatePage(pageName) {
    // First try to get the page
    let page = await this.request('logseq.Editor.getPage', [pageName]);
    
    if (!page) {
      // Create it if it doesn't exist
      page = await this.request('logseq.Editor.createPage', [
        pageName,
        {},
        { redirect: false, createFirstBlock: true }
      ]);
    }
    
    return page;
  }
  
  /**
   * Insert a block into a page
   */
  async insertBlock(pageNameOrUuid, content, options = {}) {
    return await this.request('logseq.Editor.insertBlock', [
      pageNameOrUuid,
      content,
      {
        isPageBlock: true,
        ...options
      }
    ]);
  }
  
  /**
   * Append a block to the end of a page
   */
  async appendBlockInPage(pageName, content, properties = {}) {
    return await this.request('logseq.Editor.appendBlockInPage', [
      pageName,
      content,
      { properties }
    ]);
  }
  
  /**
   * Get today's journal page name
   */
  getTodayPageName() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    
    // LogSeq default date format - may vary based on user settings
    // Common formats: "YYYY-MM-DD", "MMM Do, YYYY", etc.
    // This uses the most common default
    return `${year}-${month}-${day}`;
  }
  
  /**
   * Send handwritten note data to LogSeq
   * @param {Object} data - Contains strokes, svg, pages, timestamp
   */
  async sendHandwrittenNote(data) {
    const { strokes, svg, pages, timestamp } = data;
    
    // Create a page for the handwritten notes
    const pageName = `Smartpen/${this.getTodayPageName()}`;
    
    try {
      // Ensure the page exists
      await this.getOrCreatePage(pageName);
      
      // Create main entry block
      const entryContent = `## Smartpen Import - ${new Date(timestamp).toLocaleTimeString()}`;
      const entryBlock = await this.appendBlockInPage(pageName, entryContent, {
        'imported-at': timestamp,
        'stroke-count': strokes.length,
        'pages': pages.join(', ')
      });
      
      if (!entryBlock) {
        throw new Error('Failed to create entry block');
      }
      
      // Add stroke summary as child blocks
      const summaryContent = `- **Strokes:** ${strokes.length}\n- **Pages:** ${pages.join(', ')}`;
      await this.request('logseq.Editor.insertBlock', [
        entryBlock.uuid,
        summaryContent,
        { sibling: false }
      ]);
      
      // Add SVG as an asset reference (you'd need to save the SVG file separately)
      // For now, we'll add it as a collapsible code block
      const svgBlock = `{{renderer :smartpen-svg}}\n\`\`\`svg\n${svg}\n\`\`\``;
      await this.request('logseq.Editor.insertBlock', [
        entryBlock.uuid,
        svgBlock,
        { sibling: false }
      ]);
      
      // Add raw data for debugging (collapsible)
      const dataBlock = `collapsed:: true\n**Raw Data:**\n\`\`\`json\n${JSON.stringify(strokes.slice(0, 3), null, 2)}\n// ... ${strokes.length - 3} more strokes\n\`\`\``;
      await this.request('logseq.Editor.insertBlock', [
        entryBlock.uuid,
        dataBlock,
        { sibling: false }
      ]);
      
      console.log('Note sent to LogSeq:', pageName);
      return { success: true, page: pageName };
      
    } catch (error) {
      console.error('Failed to send to LogSeq:', error);
      throw error;
    }
  }
  
  /**
   * Send handwritten note with shape-based routing
   * Boxes around text determine where content goes
   * @param {Object} data - Processed data with regions
   */
  async sendWithRegions(data) {
    const { regions, timestamp } = data;
    
    for (const region of regions) {
      if (region.type === 'boxed-content') {
        // Content in a box - route to specific page based on first line
        const targetPage = region.inferredPage || 'Smartpen/Inbox';
        
        await this.getOrCreatePage(targetPage);
        
        const content = `## Boxed Note (${new Date(timestamp).toLocaleTimeString()})\n${region.content || '[SVG content]'}`;
        await this.appendBlockInPage(targetPage, content, {
          'source': 'smartpen',
          'box-id': region.boxId,
          'imported-at': timestamp
        });
      } else {
        // Unboxed content goes to daily journal
        const journalPage = this.getTodayPageName();
        
        const content = `Smartpen note:\n${region.content || '[SVG content]'}`;
        await this.appendBlockInPage(journalPage, content, {
          'source': 'smartpen',
          'imported-at': timestamp
        });
      }
    }
    
    return { success: true, regionCount: regions.length };
  }
  
  /**
   * Create a custom page for smartpen settings/index
   */
  async setupSmartpenIndex() {
    const indexPage = 'Smartpen';
    
    await this.getOrCreatePage(indexPage);
    
    // Add configuration block
    const configContent = `## Smartpen Configuration
- Default import page:: [[Smartpen/Inbox]]
- Box detection enabled:: true
- Auto-transcribe:: false

## Recent Imports
{{query (page-property source "smartpen")}}`;
    
    await this.appendBlockInPage(indexPage, configContent);
    
    return { success: true, page: indexPage };
  }
}
