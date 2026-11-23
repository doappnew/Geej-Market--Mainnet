import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { __APP_BUILD__: JSON.stringify(`v${new Date().toISOString().slice(0, 16).replace('T', ' ')}`) },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000', '/uploads': 'http://localhost:3000' } },
  build: { sourcemap: false, chunkSizeWarningLimit: 700 },
});
