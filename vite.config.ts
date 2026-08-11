import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'www',
    emptyOutDir: false, // Ensure we don't accidentally wipe icons
    rollupOptions: {
      input: {
        main: './index.html'
      }
    }
  }
});
