import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// base './' so the build works from any GitHub Pages sub-path (https://user.github.io/repo/).
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@engine': path.resolve(__dirname, '../server/src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: { port: 5173, fs: { allow: ['..'] } },
});
