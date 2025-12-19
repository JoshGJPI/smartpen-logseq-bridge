/**
 * NeoSmartpen → LogSeq Bridge
 * Svelte App Entry Point
 * Force rebuild timestamp: 2024-12-19
 */

// Load polyfills first (required by web_pen_sdk)
import '$lib/polyfills.js';

import App from './App.svelte';

const app = new App({
  target: document.getElementById('app'),
});

export default app;
