import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerRoutes } from './routes';

export function buildServer() {
  const app = Fastify({ logger: false });

  app.register(cors, {
    origin: ['http://localhost:3000', 'http://localhost:5173'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

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
