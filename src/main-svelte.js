/**
 * NeoSmartpen → LogSeq Bridge
 * Svelte App Entry Point
 */

// Load polyfills first (required by web_pen_sdk)
import '$lib/polyfills.js';

import App from './App.svelte';

const app = new App({
  target: document.getElementById('app'),
});

export default app;
