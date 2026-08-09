import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// Firebase's Google sign-in opens a popup on accounts.google.com and then calls
// window.close() on it from this page. That call is blocked — and the
// signInWithPopup promise never settles — unless this origin opts into keeping
// the opener relationship across a cross-origin popup. Chrome's default
// (unsafe-none) severs it, which shows up in the console as
// "Cross-Origin-Opener-Policy policy would block the window.close call".
// The same header is set on the SPA in nginx.conf so production matches.
const authPopupHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
}

// https://vitejs.dev/config/
/**
 * Dev-only: routes by hostname, the way nginx does in production.
 *
 * There is one Vite server for both entries, so something has to decide which
 * entry document a request gets. Doing it by *path* (/console) would give the
 * console a second address that exists in dev and not in production — a URL
 * that works on a developer's machine and 404s on the server is worse than no
 * shortcut at all. Matching on the host instead means dev and production agree:
 * the console is reachable at app.admin.<host> and nowhere else.
 *
 * Browsers resolve any *.localhost name to the loopback address without a hosts
 * entry, so http://app.admin.localhost:5173 works out of the box.
 */
const adminHostRouting = {
  name: 'admin-host-routing',
  apply: 'serve',
  configureServer(server: {
    middlewares: {
      use: (
        fn: (
          req: { url?: string; headers: Record<string, string | string[] | undefined> },
          res: { statusCode: number; end: (body?: string) => void },
          next: () => void
        ) => void
      ) => void;
    };
  }) {
    server.middlewares.use((req, res, next) => {
      const host = String(req.headers.host ?? '').split(':')[0];
      const isAdminHost = host.startsWith('app.admin.');
      const path = req.url?.split('?')[0] ?? '';

      // Each host refuses the other's entry document, exactly as the two nginx
      // server blocks do. Without this, Vite's static multi-page serving would
      // hand out /admin.html on the storefront host — a way into the console
      // that exists in dev and not in production.
      const forbidden = isAdminHost ? '/index.html' : '/admin.html';
      if (path === forbidden) {
        res.statusCode = 404;
        return res.end('Not found');
      }

      if (!isAdminHost) return next();

      // Vite's own machinery (/@vite/client, /@fs, HMR) and the source modules
      // themselves pass through untouched; only navigation requests become the
      // SPA entry document.
      const isInternal =
        path.startsWith('/@') || path.startsWith('/node_modules/') || path.startsWith('/src/');
      if (path === '/' || (!isInternal && !path.includes('.'))) req.url = '/admin.html';
      next();
    });
  },
} as const;

export default defineConfig({
  plugins: [react(), adminHostRouting],
  server: {
    headers: authPopupHeaders,
    // Vite refuses requests for hosts it does not know about; the console's
    // dev hostname has to be declared or every request to it is rejected.
    allowedHosts: ['localhost', '.localhost'],
  },
  preview: { headers: authPopupHeaders },

  // Two entries, one build. The admin console is a separate SPA served from a
  // separate host (app.admin.<domain>) — nginx hands admin.html to that host
  // and index.html to the storefront, and never the other way round. They share
  // this package because they share types, the Firebase setup and the design
  // tokens; they do not share a bundle, so no shopper ever downloads the
  // console's code and no console page can be reached from the storefront
  // origin. Rollup still de-duplicates what they genuinely have in common into
  // shared chunks.
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
})
