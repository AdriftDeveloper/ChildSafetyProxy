import { Proxy } from "http-mitm-proxy";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as tf from "@tensorflow/tfjs-node";
import * as nsfw from "nsfwjs";
import CA from "./ca";

const proxy = new Proxy();
tf.enableProdMode();
const replacementImagePath = path.join(__dirname, "assets", "blocked.jpg");

let nsfwModel: nsfw.NSFWJS | null = null;
const supportedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp'];


// Helper to check NSFW content
async function checkNSFW(buffer: Buffer): Promise<boolean> {
  if (!nsfwModel) {
    throw new Error("NSFWJS model not loaded yet");
  }

  try {
    // Create tensor and resize properly
    const image = tf.node.decodeImage(buffer);
    const resized = tf.image.resizeBilinear(image, [224, 224]); // NSFW.js expects 224x224
    const predictions = await nsfwModel.classify(resized as tf.Tensor<tf.Rank.R3>);
    
    // Clean up tensors
    image.dispose();
    resized.dispose();

    return predictions.some(
      (p) =>
        (p.className === "Porn" || p.className === "Hentai") &&
        p.probability > 0.5
    );
  } catch (error) {
    console.error("Error checking NSFW content:", error);
    return false;
  }
}

proxy.onError((ctx, err, errorKind) => {
  const url = ctx?.clientToProxyRequest?.url || "";
  console.error(`Error ${errorKind}:`, err.message);
});

proxy.onRequestData((ctx, chunk, callback) => callback(null, chunk));

proxy.onResponse((ctx, callback) => callback(null));

proxy.onResponseData((ctx, chunk, callback) => callback(null, chunk));

proxy.use(Proxy.gunzip);

proxy.onRequest(async (ctx, callback) => {
  console.log("Handling request to:", ctx.clientToProxyRequest.url);

  const chunks = new Array<Buffer>();
  ctx.onResponseData((ctx, chunk, callback) => {
    chunks.push(chunk);
  });

  ctx.onResponseEnd(async (ctx, callback) => {
    let body: string | Buffer = Buffer.concat(chunks);
    if (!nsfwModel) {
      console.error("NSFWJS model not loaded yet.");
      ctx.proxyToClientResponse.writeHead(500, "NSFW model not available");
      ctx.proxyToClientResponse.end();
      return;
    }

    const headers = ctx.serverToProxyResponse.headers;
    const isImage = supportedImageTypes.some(type => headers["content-type"]?.toLowerCase().includes(type));

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
    } else {
      ctx.proxyToClientResponse.write(body);
    }
    callback();
  });
  callback();
});

// WebSocket handlers remain unchanged
proxy.onWebSocketConnection((ctx, callback) => {
  console.log("WEBSOCKET CONNECT:", ctx.clientToProxyWebSocket.upgradeReq.url);
  return callback();
});

proxy.onWebSocketSend((ctx, message, flags, callback) => {
  console.log("WEBSOCKET SEND:", ctx.clientToProxyWebSocket.upgradeReq.url, message);
  return callback(null, message, flags);
});

proxy.onWebSocketMessage((ctx, message, flags, callback) => {
  console.log("WEBSOCKET MESSAGE:", ctx.clientToProxyWebSocket.upgradeReq.url, message);
  return callback(null, message, flags);
});

proxy.onWebSocketFrame((ctx, type, fromServer, data, flags, callback) => {
  console.log("WEBSOCKET FRAME " + type + " received from " + (fromServer ? "server" : "client"),
    ctx.clientToProxyWebSocket.upgradeReq.url,
    data
  );
  return callback(null, data, flags);
});

proxy.onWebSocketError((ctx, err) => {
  console.log("WEBSOCKET ERROR:", ctx.clientToProxyWebSocket.upgradeReq.url, err);
});

proxy.onWebSocketClose((ctx, code, message, callback) => {
  console.log("WEBSOCKET CLOSED BY " + (ctx.closedByServer ? "SERVER" : "CLIENT"),
    ctx.clientToProxyWebSocket.upgradeReq.url,
    code,
    message
  );
  callback(null, code, message);
});

(async () => {
  const sslCaDir = path.join(__dirname, "/../.PredatorHunTers");
  const [loadModel] = await Promise.all([nsfw.load(), CA.create(sslCaDir)]);
  nsfwModel = loadModel;
  console.log("NSFWJS model loaded");
  proxy.listen({ port: 8081, host: "0.0.0.0", sslCaDir }, () => {
    console.log("Proxy server listening on port 8081");
  });
})();