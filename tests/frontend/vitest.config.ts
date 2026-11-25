import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/frontend/*.spec.tsx', 'tests/worker/*.spec.ts'],
    setupFiles: ['tests/frontend/setup.ts'],
    restoreMocks: true,
  },
});
