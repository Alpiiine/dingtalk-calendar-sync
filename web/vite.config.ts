import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// In production the server fills in the boot data with every page load (see ../src/ui.js).
// The dev server has to do it itself.
function devBoot(): Plugin {
  return {
    name: 'dtsync-dev-boot',
    apply: 'serve',
    async transformIndexHtml(html) {
      // @ts-expect-error plain JavaScript shared with the server
      const { bootData } = await import('../src/ui.js');
      const boot = JSON.stringify(bootData({ platform: process.env.DEMO_PLATFORM || 'cloudflare', version: 'dev' }));
      return html.replace('__DTSYNC_BOOT__', () => boot.replace(/</g, '\\u003c'));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile(), devBoot()],
  build: { target: 'es2022', modulePreload: false },
  // `npm run demo` in the repository root is the API the dev server talks to (DTSYNC_API if it
  // runs on another port).
  server: { proxy: { '/api': process.env.DTSYNC_API || 'http://localhost:8788' } },
});
