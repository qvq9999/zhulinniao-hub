import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // host 显式 127.0.0.1：WebView2 解析 localhost 可能走 IPv4，而 vite 默认只绑 IPv6 会黑屏
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  build: { target: 'chrome105', outDir: 'dist' },
});
