import { startCluster } from './utils/cluster';
import { proxy } from './services/proxy';
import { loadModel } from './services/nsfw';
import app from './app';
import { PROXY_PORT, EXPRESS_PORT } from './config/constants';
import type session from 'express-session';

declare module 'express-session' {
  interface SessionData {
    user?: {
      username: string;
    };
  }
}

// Type the request to include session
declare global {
  namespace Express {
    interface Request {
      session: session.Session & Partial<session.SessionData>;
    }
  }
}
(async () => {
await loadModel();
})();

startCluster(() => {
  (async () => {
    proxy.listen({ port: PROXY_PORT }, () => {
      console.log(`Proxy server listening on port ${PROXY_PORT}`);
    });

    // app.listen(EXPRESS_PORT, () => {
    //   console.log('Login server listening on port 3000');
    // });
  })();
});