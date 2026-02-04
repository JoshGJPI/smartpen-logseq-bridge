import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import electron from 'vite-plugin-electron';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Custom plugin to handle .nproj files
function nprojPlugin() {
  return {
    name: 'nproj-loader',
    enforce: 'pre',
    resolveId(id) {
      if (id.endsWith('.nproj')) {
        return id;
      }
    },
    load(id) {
      if (id.endsWith('.nproj')) {
        try {
          const content = readFileSync(id, 'utf-8');
          return `export default ${JSON.stringify(content)}`;
        } catch (e) {
          return `export default ""`;
        }
      }
    },
    transform(code, id) {
      if (id.includes('node_modules') && code.includes('.nproj')) {
        return code.replace(
          /require\(["']([^"']*\.nproj)["']\)/g,
          '""'
        );
      }
    }
  };
}

export default defineConfig({
  base: './', // Relative paths for Electron compatibility
  plugins: [
    nprojPlugin(),
    svelte(),
    electron({
      entry: 'electron/main.cjs',
      vite: {
        build: {
          outDir: 'dist-electron'
        }
      }
    })
  ],
  server: {
    port: 3000,
    open: false // Electron will open the window
  },
  build: {
    outDir: 'dist',
    target: 'esnext',
    commonjsOptions: {
      transformMixedEsModules: true
    },
    rollupOptions: {
      output: {
        manualChunks: undefined // Single bundle for Electron
      }
    }
  },
  resolve: {
    alias: {
      // Node.js polyfills for browser
      stream: 'stream-browserify',
      buffer: 'buffer',
      util: 'util',
      process: 'process/browser',
      // Point zlib to our custom shim that uses pako
      zlib: resolve(__dirname, 'src/lib/zlib-shim.js'),
      // Svelte-style aliases
      '$lib': resolve(__dirname, 'src/lib'),
      '$stores': resolve(__dirname, 'src/stores'),
      '$components': resolve(__dirname, 'src/components'),
      '$utils': resolve(__dirname, 'src/utils')
    }
  },
  define: {
    global: 'globalThis',
    'process.env': {}
  },
  optimizeDeps: {
    include: ['web_pen_sdk', 'buffer', 'process', 'pako'],
    esbuildOptions: {
      define: {
        global: 'globalThis'
      },
      loader: {
        '.nproj': 'text'
      }
    }
  }
});
