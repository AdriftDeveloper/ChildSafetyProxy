import { startCluster } from './utils/cluster';
import { proxy } from './services/proxy';
import { loadModel } from './services/nsfw';
import app from './app';
import { PROXY_HOST, PROXY_PORT, SSL_CA_DIR } from './config/constants';
import type session from 'express-session';
import path from 'path';
import CA from './services/ca';
import { existsSync, mkdirSync } from 'fs';

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
  console.log('SSL_CA_DIR: ', SSL_CA_DIR);
  if (!existsSync(SSL_CA_DIR)) {
    console.log('Creating CA directory...');
    Promise.all([loadModel(), CA.create(SSL_CA_DIR)]).then(() => {
      proxy.listen({ port: PROXY_PORT, host: PROXY_HOST, sslCaDir: SSL_CA_DIR }, () => {

        console.log(`Proxy server listening on port ${PROXY_PORT}`);
      });
    });
  } else {
    loadModel().then(() => {
      proxy.listen({ port: PROXY_PORT, host: PROXY_HOST, sslCaDir: SSL_CA_DIR }, () => {

        console.log(`Proxy server listening on port ${PROXY_PORT}`);
      });
    })
  }
})();
