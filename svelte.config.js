import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  // Consult https://svelte.dev/docs#compile-time-svelte-preprocess
  // for more information about preprocessors
  preprocess: vitePreprocess(),
  
  compilerOptions: {
    // Enable dev mode warnings
    dev: process.env.NODE_ENV !== 'production'
  }
};
