/**
 * Transcription View - Display transcription results
 * Shows line detection with baseline-based grouping and hierarchy
 */

import { elements } from './elements.js';
import { state } from './state.js';

export function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function updateTranscriptionView() {
  const lastTranscription = state.lastTranscription;
  
  if (!lastTranscription) {
    elements.transcriptionResult.innerHTML = `
      <p style="color: var(--text-secondary); text-align: center;">
        Select strokes and click "Transcribe Selected" to convert handwriting to text.
        <br><br>
        <a href="https://developer.myscript.com/" target="_blank" style="color: var(--accent);">Get MyScript API keys (free tier: 2,000 requests/month)</a>
      </p>
    `;
    return;
  }
  
  const t = lastTranscription;
  
  // Build formatted output - show text with preserved newlines
  let html = `
    <div style="margin-bottom: 15px;">
      <h3 style="margin: 0 0 10px 0; color: var(--accent);">Transcribed Text</h3>
      <div style="background: var(--bg-primary); padding: 15px; border-radius: 8px; font-size: 1.1rem; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(t.text) || '<em style="color: var(--text-secondary);">No text recognized</em>'}</div>
    </div>
  `;
  
  // Show lines with hierarchy and position analysis
  if (t.lines && t.lines.length > 0) {
    html += `
      <div style="margin-bottom: 15px;">
        <h3 style="margin: 0 0 10px 0; color: var(--accent);">Lines with Hierarchy (${t.lines.length})</h3>
        <div style="background: var(--bg-primary); padding: 15px; border-radius: 8px; font-family: monospace; font-size: 0.9rem;">
    `;
    
    t.lines.forEach((line, i) => {
      // Visual indent markers
      const indentMarker = line.indentLevel > 0 
        ? `<span style="color: var(--accent); font-weight: bold;">${'  '.repeat(line.indentLevel)}↳ </span>`
        : '';
      
      // Hierarchy info
      const parentInfo = line.parent !== null ? `parent:${line.parent}` : 'root';
      const childInfo = line.children && line.children.length > 0 
        ? `, children:[${line.children.join(',')}]` 
        : '';
      
      // Position info - now using baseline
      const posInfo = [
        `baseline:${line.baseline?.toFixed(1) || '?'}`,
        `x:${line.x?.toFixed(1) || '?'}`
      ];
      
      if (line.indentLevel > 0) {
        posInfo.push(`<span style="color: var(--accent);">L${line.indentLevel}</span>`);
      }
      
      html += `
        <div style="padding: 8px 0; border-bottom: 1px solid var(--bg-tertiary);">
          <div style="display: flex; align-items: baseline; gap: 8px;">
            <span style="color: var(--text-secondary); min-width: 24px;">${i}.</span>
            <span>${indentMarker}${escapeHtml(line.text)}</span>
          </div>
          <div style="color: var(--text-secondary); font-size: 0.75rem; margin-left: 32px; margin-top: 4px;">
            [${posInfo.join(', ')}] · <span style="opacity: 0.7;">${parentInfo}${childInfo}</span>
          </div>
        </div>
      `;
    });
    
    html += `
        </div>
      </div>
    `;
  }
  
  // Show summary stats including line metrics
  if (t.summary) {
    html += `
      <div style="margin-bottom: 15px; display: flex; gap: 15px; flex-wrap: wrap;">
        <div style="background: var(--bg-tertiary); padding: 10px 15px; border-radius: 6px;">
          <div style="font-size: 1.5rem; font-weight: bold; color: var(--accent);">${t.summary.totalLines}</div>
          <div style="font-size: 0.8rem; color: var(--text-secondary);">Lines</div>
        </div>
        <div style="background: var(--bg-tertiary); padding: 10px 15px; border-radius: 6px;">
          <div style="font-size: 1.5rem; font-weight: bold; color: var(--accent);">${t.summary.totalWords}</div>
          <div style="font-size: 0.8rem; color: var(--text-secondary);">Words</div>
        </div>
        <div style="background: var(--bg-tertiary); padding: 10px 15px; border-radius: 6px;">
          <div style="font-size: 1.5rem; font-weight: bold; color: ${t.summary.hasIndentation ? 'var(--accent)' : 'var(--text-secondary)'};">${t.summary.hasIndentation ? '✓' : '—'}</div>
          <div style="font-size: 0.8rem; color: var(--text-secondary);">Indentation</div>
        </div>
        <div style="background: var(--bg-tertiary); padding: 10px 15px; border-radius: 6px;">
          <div style="font-size: 1.5rem; font-weight: bold; color: ${t.summary.hasCommands ? 'var(--accent)' : 'var(--text-secondary)'};">${t.summary.hasCommands ? t.commands.length : '—'}</div>
          <div style="font-size: 0.8rem; color: var(--text-secondary);">Commands</div>
        </div>
      </div>
    `;
    
    // Show line metrics if available
    if (t.lineMetrics) {
      html += `
        <details style="margin-bottom: 15px;">
          <summary style="cursor: pointer; color: var(--text-secondary); padding: 5px 0;">Line Detection Metrics</summary>
          <div style="background: var(--bg-primary); padding: 15px; border-radius: 8px; margin-top: 10px; font-size: 0.85rem;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">
              <div>
                <div style="color: var(--text-secondary);">Median Word Height</div>
                <div style="font-weight: 600;">${t.lineMetrics.medianHeight?.toFixed(2) || '?'} px</div>
              </div>
              <div>
                <div style="color: var(--text-secondary);">Line Threshold</div>
                <div style="font-weight: 600;">${t.lineMetrics.lineThreshold?.toFixed(2) || '?'} px</div>
              </div>
              <div>
                <div style="color: var(--text-secondary);">Indent Unit</div>
                <div style="font-weight: 600;">${t.lineMetrics.indentUnit?.toFixed(2) || '?'} px</div>
              </div>
              <div>
                <div style="color: var(--text-secondary);">Baseline Variance</div>
                <div style="font-weight: 600;">±${t.lineMetrics.baselineVariance?.toFixed(2) || '?'} px</div>
              </div>
            </div>
          </div>
        </details>
      `;
    }
  }
  
  // Show detected commands
  if (t.commands && t.commands.length > 0) {
    html += `
      <div style="margin-bottom: 15px;">
        <h3 style="margin: 0 0 10px 0; color: var(--accent);">Detected Commands</h3>
        <div style="display: flex; flex-direction: column; gap: 8px;">
    `;
    
    t.commands.forEach(cmd => {
      // Show scope if command affects children
      const scopeInfo = cmd.lineIndex !== undefined 
        ? `<div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 4px;">Line ${cmd.lineIndex} + descendants</div>`
        : '';
      
      html += `
        <div style="background: var(--bg-tertiary); padding: 10px; border-radius: 6px; border-left: 3px solid var(--accent);">
          <div style="font-weight: 600;">${escapeHtml(cmd.command)}</div>
          <div style="color: var(--text-secondary);">${escapeHtml(cmd.value)}</div>
          ${scopeInfo}
        </div>
      `;
    });
    
    html += `
        </div>
      </div>
    `;
  }
  
  // Show LogSeq preview with hierarchy
  if (t.lines && t.lines.length > 0) {
    const logseqPreview = t.lines.map(line => {
      const indent = '\t'.repeat(line.indentLevel || 0);
      return `${indent}- ${line.text}`;
    }).join('\n');
    
    html += `
      <div style="margin-bottom: 15px;">
        <h3 style="margin: 0 0 10px 0; color: var(--accent);">LogSeq Preview</h3>
        <div style="background: var(--bg-primary); padding: 15px; border-radius: 8px; font-family: monospace; font-size: 0.9rem; white-space: pre-wrap;">${escapeHtml(logseqPreview)}</div>
      </div>
    `;
  }
  
  // Show hierarchy tree visualization
  if (t.lines && t.lines.length > 0 && t.lines.some(l => l.indentLevel > 0)) {
    html += buildHierarchyTree(t.lines);
  }
  
  // Show words with bounding boxes (collapsed by default)
  if (t.words && t.words.length > 0) {
    html += `
      <details style="margin-bottom: 15px;">
        <summary style="cursor: pointer; color: var(--accent); padding: 5px 0;">Word Details (${t.words.length} words)</summary>
        <div class="json-viewer" style="margin-top: 10px; max-height: 200px;">${JSON.stringify(t.words.map(w => ({
          text: w.text,
          baseline: w.baseline?.toFixed(2),
          bottom: w.bottom?.toFixed(2),
          bbox: w.boundingBox ? {
            x: w.boundingBox.x?.toFixed(2),
            y: w.boundingBox.y?.toFixed(2),
            w: w.boundingBox.width?.toFixed(2),
            h: w.boundingBox.height?.toFixed(2)
          } : null
        })), null, 2)}</div>
      </details>
    `;
  }
  
  // Show raw response (collapsed)
  html += `
    <details>
      <summary style="cursor: pointer; color: var(--text-secondary); padding: 5px 0;">Raw Response</summary>
      <div class="json-viewer" style="margin-top: 10px; max-height: 300px;">${JSON.stringify(t.raw, null, 2)}</div>
    </details>
  `;
  
  elements.transcriptionResult.innerHTML = html;
}

/**
 * Build a visual tree representation of line hierarchy
 */
function buildHierarchyTree(lines) {
  // Find root lines (no parent)
  const roots = lines.filter(l => l.parent === null);
  
  function renderNode(lineIndex, depth = 0) {
    const line = lines[lineIndex];
    if (!line) return '';
    
    const prefix = depth === 0 ? '' : '│  '.repeat(depth - 1) + '├─ ';
    const truncatedText = line.text.length > 40 
      ? line.text.substring(0, 40) + '...' 
      : line.text;
    
    let html = `<div style="white-space: pre;">${prefix}<span style="color: var(--accent);">[${lineIndex}]</span> ${escapeHtml(truncatedText)}</div>`;
    
    if (line.children && line.children.length > 0) {
      line.children.forEach(childIdx => {
        html += renderNode(childIdx, depth + 1);
      });
    }
    
    return html;
  }
  
  let treeHtml = `
    <details style="margin-bottom: 15px;">
      <summary style="cursor: pointer; color: var(--accent); padding: 5px 0;">Hierarchy Tree</summary>
      <div style="background: var(--bg-primary); padding: 15px; border-radius: 8px; margin-top: 10px; font-family: monospace; font-size: 0.85rem;">
  `;
  
  roots.forEach(root => {
    treeHtml += renderNode(root.lineIndex);
  });
  
  treeHtml += `
      </div>
    </details>
  `;
  
  return treeHtml;
}
