import { IContext, Proxy } from 'http-mitm-proxy';
import { spawn, spawnSync } from 'child_process';
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
      processVideoStream(ctx, body);
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
    const buffers: Buffer[] = [];
    ctx.clientToProxyRequest.on('data', (chunk) => buffers.push(chunk));

    if (isImage) {
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
    } else if (isVideo) {
      ctx.clientToProxyRequest.on('end', async () => {
        const videoBuffer = Buffer.concat(buffers);
        processVideoStream(ctx, videoBuffer);
      });
      return;
    } else {
      ctx.clientToProxyRequest.on('end', async () => {
        console.log('JORDAN', Buffer.concat(buffers).toString());
      })
    }
    return;
  }

  callback();
});

proxy.onWebSocketConnection((ctx, callback) => {
  console.log('WEBSOCKET CONNECT:', ctx.clientToProxyWebSocket.upgradeReq.url);
  return callback();
});

proxy.onWebSocketSend((ctx, message, flags, callback) => {
  console.log('WEBSOCKET SEND:', ctx.clientToProxyWebSocket.upgradeReq.url, message.toString());
  return callback(null, message, flags);
});

proxy.onWebSocketMessage((ctx, message, flags, callback) => {
  console.log('WEBSOCKET MESSAGE:', ctx.clientToProxyWebSocket.upgradeReq.url, message.toString());
  return callback(null, message, flags);
});

proxy.onWebSocketFrame((ctx, type, fromServer, data, flags, callback) => {
  console.log('WEBSOCKET FRAME ' + type + ' received from ' + (fromServer ? 'server' : 'client'), ctx.clientToProxyWebSocket.upgradeReq.url, data.toString());
  try {
    console.log('atob toString', atob(data.toString()));
  } catch (error) {
    // console.log('error', error);
  }

  return callback(null, data, flags);
});

proxy.onWebSocketError((ctx, err) => {
  console.log('WEBSOCKET ERROR:', ctx.clientToProxyWebSocket.upgradeReq.url, err);
});

proxy.onWebSocketClose((ctx, code, message, callback) => {
  console.log('WEBSOCKET CLOSED BY ' + (ctx.closedByServer ? 'SERVER' : 'CLIENT'), ctx.clientToProxyWebSocket.upgradeReq.url, code, message);
  callback(null, code, message);
});


async function getVideoMetadata(videoBuffer: Buffer) {
  return new Promise<any>((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-i', 'pipe:0',
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams'
    ]);

    let output = '';
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.on('close', () => {
      try {
        const metadata = JSON.parse(output);
        resolve(metadata);
      } catch (error) {
        console.error('Error parsing video metadata:', error);
        resolve(null);
      }
    });

    ffprobe.stdin.write(videoBuffer);
    ffprobe.stdin.end();
  });
}

function buildFFmpegOutputArgs(metadata: any): string[] {
  if (!metadata || !metadata.streams) {
    // Fallback to default settings if metadata isn't available
    return [
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-framerate', '30',
      '-i', 'pipe:0',
      '-i', 'pipe:1',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov',
      '-map', '0:v:0',
      '-map', '1:a:0?'
    ];
  }

  const videoStream = metadata.streams.find((s: any) => s.codec_type === 'video');
  const args = [
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-framerate', videoStream?.r_frame_rate || '30',
    '-i', 'pipe:0',
    '-i', 'pipe:1'
  ];

  // Copy original video codec settings
  if (videoStream) {
    // Video codec
    args.push('-c:v', videoStream.codec_name || 'libx264');

    // Pixel format
    if (videoStream.pix_fmt) {
      args.push('-pix_fmt', videoStream.pix_fmt);
    }

    // Bitrate
    if (videoStream.bit_rate) {
      args.push('-b:v', videoStream.bit_rate);
    }

    // Profile
    if (videoStream.profile) {
      args.push('-profile:v', videoStream.profile);
    }

    // Level
    if (videoStream.level) {
      args.push('-level', videoStream.level.toString());
    }

    // GOP size
    if (videoStream.gop_size) {
      args.push('-g', videoStream.gop_size.toString());
    }
  }

  // Output format and mapping
  args.push(
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov',
    '-map', '0:v:0',
    '-map', '1:a:0?'
  );

  return args;
}

async function processVideoStream(ctx: IContext, videoBuffer: Buffer) {
  try {
    // Step 1: Extract frames from the video
    const ffmpegExtractFrames = spawn('ffmpeg', [
      '-i', 'pipe:0', // Input from stdin
      '-vf', 'fps=30', // Extract frames at 30 FPS
      '-f', 'image2pipe', // Output as image stream
      '-vcodec', 'mjpeg', // Use MJPEG codec for frames
      '-q:v', '2', // Quality of extracted frames
      'pipe:1' // Output to stdout
    ]);

    // Step 2: Reconstruct the video with replaced frames
    const ffmpegReconstructVideo = spawn('ffmpeg', [
      '-f', 'image2pipe', // Input as image stream
      '-vcodec', 'mjpeg', // Input codec
      '-i', 'pipe:0', // Input from stdin
      '-c:v', 'copy', // Copy the original video codec
      '-f', 'mp4', // Output format
      '-movflags', 'frag_keyframe+empty_moov', // Enable streaming
      'pipe:1' // Output to stdout
    ]);

    // Pipe the reconstructed video to the client
    ffmpegReconstructVideo.stdout.pipe(ctx.proxyToClientResponse);

    // Error handling
    ffmpegReconstructVideo.stderr.on('data', (data: Buffer) => {
      console.error('FFmpeg reconstruction error:', data.toString());
    });

    // Frame processing
    let frameBuffer: Buffer[] = [];
    const replacementFrame = fs.readFileSync(replacementImagePath);

    ffmpegExtractFrames.stdout.on('data', async (chunk: Buffer) => {
      frameBuffer.push(chunk);

      if (isCompleteJPEG(Buffer.concat(frameBuffer))) {
        const completeFrame = Buffer.concat(frameBuffer);
        frameBuffer = []; // Reset for the next frame

        try {
          const isNSFW = await checkNSFW(completeFrame);
          if (isNSFW) {
            // console.log("NSFW frame detected, replacing with safe image");
            ffmpegReconstructVideo.stdin.write(replacementFrame);
          } else {
            console.log("Everything ok with the frame");
            ffmpegReconstructVideo.stdin.write(completeFrame);
          }
        } catch (error) {
          console.error('Error processing frame:', error);
          ffmpegReconstructVideo.stdin.write(completeFrame);
        }
      }
    });

    // Handle end of frame extraction
    ffmpegExtractFrames.stdout.on('end', () => {
      if (frameBuffer.length > 0) {
        const finalFrame = Buffer.concat(frameBuffer);
        ffmpegReconstructVideo.stdin.write(finalFrame);
      }
      ffmpegReconstructVideo.stdin.end();
    });

    // Start processing
    ffmpegExtractFrames.stdin.write(videoBuffer);
    ffmpegExtractFrames.stdin.end();

  } catch (error) {
    console.error('Error processing video stream:', error);
    ctx.proxyToClientResponse.writeHead(500, 'Error processing video stream');
    ctx.proxyToClientResponse.end();
  }
}

// Helper function to check if buffer contains a complete JPEG image
function isCompleteJPEG(buffer: Buffer): boolean {
  if (buffer.length < 2) return false;
  
  // Check for JPEG SOI marker
  if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) return false;
  
  // Check for JPEG EOI marker
  return buffer[buffer.length - 2] === 0xFF && buffer[buffer.length - 1] === 0xD9;
}