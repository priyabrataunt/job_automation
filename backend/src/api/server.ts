import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { registerRoutes } from './routes';

export function buildServer() {
  const app = Fastify({ logger: false });

  app.register(cors, {
    origin: (origin, cb) => {
      const allowed =
        !origin ||
        origin.startsWith('chrome-extension://') ||
        origin === 'http://localhost:3000' ||
        origin === 'http://localhost:5173';
      cb(null, allowed);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max

  app.register(registerRoutes);

  return app;
}

export async function startServer(port: number = 8000): Promise<void> {
  const app = buildServer();

  try {
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`[Server] Listening on http://localhost:${port}`);
  } catch (err) {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  }
}
