import { Proxy } from 'http-mitm-proxy';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { checkNSFW, getCurrentModel } from './nsfw';

const replacementImagePath = path.join(__dirname, '../../assets', 'blocked.jpg');
const supportedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp'];


export const proxy = new Proxy();

proxy.use(Proxy.gunzip);

proxy.onRequest(async (ctx, callback) => {
  console.log("Handling request to:", ctx.clientToProxyRequest.url);

  const chunks = new Array<Buffer>();
  ctx.onResponseData((ctx, chunk, callback) => {
    chunks.push(chunk);
  });

  ctx.onResponseEnd(async (ctx, callback) => {
    let body: string | Buffer = Buffer.concat(chunks);
    if (!getCurrentModel()) {
      console.error("NSFWJS model not loaded yet.");
      ctx.proxyToClientResponse.writeHead(500, "NSFW model not available");
      ctx.proxyToClientResponse.end();
      return;
    }

    const headers = ctx.serverToProxyResponse.headers;
    const isImage = supportedImageTypes.some(type => headers["content-type"]?.toLowerCase().includes(type));
    // const isVideo = headers['content-type']?.includes('video') || headers['content-type']?.includes('application/octet-stream');
    const isVideo = false;

    if (isImage) {
      try {
        const isNSFW = await checkNSFW(body);
        if (isNSFW) {
          console.log("NSFW image detected, replacing with safe image");
          const safeImageStream = fs.createReadStream(replacementImagePath);
          safeImageStream.on("open", () => {
            // ctx.proxyToClientResponse.writeHead(200, {
            //   "Content-Type": "image/jpeg",
            //   "Content-Length": fs.statSync(replacementImagePath).size,
            // });
            safeImageStream.pipe(ctx.proxyToClientResponse);
          });
          safeImageStream.on("error", (err) => {
            console.error("Error reading replacement image:", err);
            ctx.proxyToClientResponse.writeHead(500, "Error serving replacement image");
            ctx.proxyToClientResponse.end();
          });
          return;
        } else {
          ctx.proxyToClientResponse.write(body);
        }
      } catch (error) {
        console.error("Error processing image:", error);
        ctx.proxyToClientResponse.write(body);
      }
    } else if(isVideo) {
      const extractFrame = spawn('ffmpeg', [
        '-i', 'pipe:0',
        '-vf', 'select=eq(n\\,1)',
        '-vsync', 'vfr',
        '-q:v', '2',
        '-f', 'image2pipe',
        '-vcodec', 'png',
        'pipe:1'
      ]);
  
      const buffers: Buffer[] = [];
      extractFrame.stdout.on('data', (chunk) => buffers.push(chunk));
      extractFrame.on('close', async () => {
        const frameBuffer = Buffer.concat(buffers);
        const isNSFW = await checkNSFW(frameBuffer);
        if (isNSFW) {
          console.log('NSFW frame detected, replacing with safe frame');
          fs.createReadStream(replacementImagePath).pipe(ctx.proxyToClientResponse);
        } else {
          console.log('Safe frame detected, restreaming video');
          ctx.proxyToClientResponse.write(frameBuffer);
          ctx.proxyToClientResponse.end();
        }
      });
  
      extractFrame.stderr.on('data', (err) => {
        console.error('FFmpeg error:', err.toString());
      });
  
      ctx.clientToProxyRequest.pipe(extractFrame.stdin);
    } else {
      ctx.proxyToClientResponse.write(body);
    }
    callback();
  });
  callback();
});

proxy.onError((ctx, err, errorKind) => {
  const url = ctx?.clientToProxyRequest?.url || "";
  console.error(`${errorKind} on ${url}:`, err);
});

proxy.onRequest(async (ctx, callback) => {
  const headers = ctx.clientToProxyRequest.headers;
  const isImage = headers['content-type']?.startsWith('image/');
  const isVideo = headers['content-type']?.includes('video') || headers['content-type']?.includes('application/octet-stream');

  if (isImage || isVideo) {
    ctx.use(Proxy.gunzip);

    if (isImage) {
      const buffers: Buffer[] = [];
      ctx.clientToProxyRequest.on('data', (chunk) => buffers.push(chunk));
      ctx.clientToProxyRequest.on('end', async () => {
        const imageBuffer = Buffer.concat(buffers);
        const isNSFW = await checkNSFW(imageBuffer);
        if (isNSFW) {
          console.log('NSFW image detected, replacing with safe image');
          fs.createReadStream(replacementImagePath).pipe(ctx.proxyToClientResponse);
        } else {
          ctx.proxyToClientResponse.write(imageBuffer);
          ctx.proxyToClientResponse.end();
        }
      });
      return;
    }

    const extractFrame = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-vf', 'select=eq(n\\,1)',
      '-vsync', 'vfr',
      '-q:v', '2',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      'pipe:1'
    ]);

    const buffers: Buffer[] = [];
    extractFrame.stdout.on('data', (chunk) => buffers.push(chunk));
    extractFrame.on('close', async () => {
      const frameBuffer = Buffer.concat(buffers);
      const isNSFW = await checkNSFW(frameBuffer);
      if (isNSFW) {
        console.log('NSFW frame detected, replacing with safe frame');
        fs.createReadStream(replacementImagePath).pipe(ctx.proxyToClientResponse);
      } else {
        console.log('Safe frame detected, restreaming video');
        ctx.proxyToClientResponse.write(frameBuffer);
        ctx.proxyToClientResponse.end();
      }
    });

    extractFrame.stderr.on('data', (err) => {
      console.error('FFmpeg error:', err.toString());
    });

    ctx.clientToProxyRequest.pipe(extractFrame.stdin);
    return;
  }

  callback();
});

proxy.onWebSocketConnection((ctx, callback) => {
  console.log('WEBSOCKET CONNECT:', ctx.clientToProxyWebSocket.upgradeReq.url);
  return callback();
});

proxy.onWebSocketSend((ctx, message, flags, callback) => {
  console.log('WEBSOCKET SEND:', ctx.clientToProxyWebSocket.upgradeReq.url, message);
  return callback(null, message, flags);
});

proxy.onWebSocketMessage((ctx, message, flags, callback) => {
  console.log('WEBSOCKET MESSAGE:', ctx.clientToProxyWebSocket.upgradeReq.url, message);
  return callback(null, message, flags);
});

proxy.onWebSocketFrame((ctx, type, fromServer, data, flags, callback) => {
  console.log('WEBSOCKET FRAME ' + type + ' received from ' + (fromServer ? 'server' : 'client'), ctx.clientToProxyWebSocket.upgradeReq.url, data);
  return callback(null, data, flags);
});

proxy.onWebSocketError((ctx, err) => {
  console.log('WEBSOCKET ERROR:', ctx.clientToProxyWebSocket.upgradeReq.url, err);
});

proxy.onWebSocketClose((ctx, code, message, callback) => {
  console.log('WEBSOCKET CLOSED BY ' + (ctx.closedByServer ? 'SERVER' : 'CLIENT'), ctx.clientToProxyWebSocket.upgradeReq.url, code, message);
  callback(null, code, message);
});