import { defineConfig } from 'vite';
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
  plugins: [nprojPlugin()],
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    target: 'esnext',
    commonjsOptions: {
      transformMixedEsModules: true
    }
  },
  resolve: {
    alias: {
      stream: 'stream-browserify',
      buffer: 'buffer',
      util: 'util',
      process: 'process/browser',
      // Point zlib to our custom shim that uses pako
      zlib: resolve(__dirname, 'src/zlib-shim.js')
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
