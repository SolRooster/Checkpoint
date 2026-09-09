import { defineConfig } from 'vite';
import { buildCatalog } from './shared/catalog.js';

// Mirrors the Worker's /catalog route so `npm run dev` works with no cloud setup.
function catalogDevServer() {
  let cached = null;
  return {
    name: 'checkpoint-catalog-dev',
    configureServer(server) {
      server.middlewares.use('/api/catalog', async (_req, res) => {
        try {
          if (!cached) {
            console.log('[checkpoint] building Game Pass catalog\u2026');
            cached = await buildCatalog();
            console.log(`[checkpoint] catalog ready \u2014 ${cached.count} games`);
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(cached));
        } catch (err) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    },
  };
}

export default defineConfig({
  base: '/Checkpoint/',
  plugins: [catalogDevServer()],
});
