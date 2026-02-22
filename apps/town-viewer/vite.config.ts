import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/sse': { target: 'http://127.0.0.1:19820', changeOrigin: true },
      '/peers': { target: 'http://127.0.0.1:19820', changeOrigin: true },
      '/status': { target: 'http://127.0.0.1:19820', changeOrigin: true },
      '/social': { target: 'http://127.0.0.1:19820', changeOrigin: true },
      '/move': { target: 'http://127.0.0.1:19820', changeOrigin: true },
      '/evolution': { target: 'http://127.0.0.1:19820', changeOrigin: true },
      '/dna': { target: 'http://127.0.0.1:19820', changeOrigin: true },
    },
  },
});
