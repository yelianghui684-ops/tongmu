import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseC2S, type S2C } from '@tongmu/shared';
import { RoomManager, type Conn, type Session } from './rooms.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dev 下是 server/src/../../client/dist；打包后 dist/index.js 同样相对仓库根
const clientDist = path.resolve(__dirname, '../../client/dist');

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

app.get('/healthz', async () => ({ ok: true }));

if (existsSync(clientDist)) {
  await app.register(fastifyStatic, { root: clientDist });
  // SPA 回退：/room/XXXX 刷新时也返回 index.html
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.method === 'GET' && !req.url.startsWith('/ws')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not found' });
  });
}

const rooms = new RoomManager();
const sweeper = setInterval(() => rooms.sweep(), 30_000);
sweeper.unref();

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws: WebSocket) => {
  const conn: Conn = {
    send(msg: S2C) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };
  let session: Session | null = null;

  ws.on('message', (raw) => {
    const msg = parseC2S(raw.toString());
    if (!msg) {
      conn.send({ t: 'error', code: 'bad_request', message: '消息格式错误' });
      return;
    }
    try {
      session = rooms.handleMessage(conn, session, msg);
    } catch (err) {
      app.log.error({ err }, 'handleMessage failed');
    }
  });

  ws.on('close', () => rooms.handleDisconnect(session));
  ws.on('error', () => ws.close());
});

app.server.on('upgrade', (req, socket, head) => {
  if (req.url?.split('?')[0] === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

await app.listen({ port: PORT, host: HOST });
app.log.info(`同幕服务器已启动: http://localhost:${PORT}`);
