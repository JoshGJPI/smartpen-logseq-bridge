/**
 * Transcription View - Display transcription results
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
  
  // Show lines with indentation analysis
  if (t.lines && t.lines.length > 0) {
    html += `
      <div style="margin-bottom: 15px;">
        <h3 style="margin: 0 0 10px 0; color: var(--accent);">Lines with Position Analysis (${t.lines.length})</h3>
        <div style="background: var(--bg-primary); padding: 15px; border-radius: 8px; font-family: monospace; font-size: 0.9rem;">
    `;
    
    t.lines.forEach((line, i) => {
      const indentMarker = line.indentLevel > 0 
        ? `<span style="color: var(--accent); font-weight: bold;">${'→'.repeat(line.indentLevel)}</span> `
        : '';
      
      // Only show indent info if it's significant (indent level > 0)
      // Small pixel differences are just handwriting variation
      const indentInfo = line.indentLevel > 0 
        ? `, <span style="color: var(--accent);">indent level ${line.indentLevel}</span>` 
        : '';
      
      const posInfo = `<span style="color: var(--text-secondary); font-size: 0.8rem;">[y:${line.y?.toFixed(1) || '?'}, x:${line.x?.toFixed(1) || '?'}${indentInfo}]</span>`;
      html += `<div style="padding: 5px 0; border-bottom: 1px solid var(--bg-tertiary);">
        <span style="color: var(--text-secondary);">${i + 1}.</span> ${indentMarker}${escapeHtml(line.text)}
        <br>${posInfo}
      </div>`;
    });
    
    html += `
        </div>
      </div>
    `;
  }
  
  // Show summary stats
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
  }
  
  // Show detected commands
  if (t.commands && t.commands.length > 0) {
    html += `
      <div style="margin-bottom: 15px;">
        <h3 style="margin: 0 0 10px 0; color: var(--accent);">Detected Commands</h3>
        <div style="display: flex; flex-direction: column; gap: 8px;">
    `;
    
    t.commands.forEach(cmd => {
      html += `
        <div style="background: var(--bg-tertiary); padding: 10px; border-radius: 6px; border-left: 3px solid var(--accent);">
          <div style="font-weight: 600;">${escapeHtml(cmd.command)}</div>
          <div style="color: var(--text-secondary);">${escapeHtml(cmd.value)}</div>
        </div>
      `;
    });
    
    html += `
        </div>
      </div>
    `;
  }
  
  // Show LogSeq preview
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
  
  // Show words with bounding boxes (collapsed by default)
  if (t.words && t.words.length > 0) {
    html += `
      <details style="margin-bottom: 15px;">
        <summary style="cursor: pointer; color: var(--accent); padding: 5px 0;">Word Details (${t.words.length} words)</summary>
        <div class="json-viewer" style="margin-top: 10px; max-height: 200px;">${JSON.stringify(t.words, null, 2)}</div>
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
