import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  appType: 'spa',
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  server: {
    port: 5173,
    // Ensure SPA fallback for deep links in dev (e.g. /project/7).
    // This prevents accidental serving of legacy HTML.
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url || '';
        const isApi = url.startsWith('/api') || url.startsWith('/auth');
        const isVite = url.startsWith('/@') || url.startsWith('/assets');
        const hasExtension = /\.[a-zA-Z0-9]+($|\?)/.test(url);
        if (!isApi && !isVite && !hasExtension) {
          req.url = '/';
        }
        next();
      });
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
