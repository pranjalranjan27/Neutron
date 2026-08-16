import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: './',
  server: {
    host: '0.0.0.0',
    port: 3000,
    open: true,
    watch: {
      ignored: [
        '**/vcpkg/**',
        '**/build/**',
        '**/build_msvc/**',
        '**/build_vcpkg/**',
      ],
    },
    fs: {
      // Only allow serving files from the project root and src
      allow: ['.'],
      deny: ['vcpkg', 'build', 'build_msvc', 'build_vcpkg'],
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
    },
  },
});
