import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// En dev, sert /api/a avec le même code que la fonction Vercel.
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      Object.assign(process.env, loadEnv('development', process.cwd(), ''));
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/a')) return next();
        const mod = await server.ssrLoadModule('/api/a.ts');
        return mod.default(req, res);
      });
    },
  };
}

export default defineConfig({ plugins: [react(), devApi()], server: { port: 5173 } });
