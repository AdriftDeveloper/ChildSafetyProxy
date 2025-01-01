import * as tf from '@tensorflow/tfjs-node';
import * as nsfw from 'nsfwjs';

let nsfwModel: nsfw.NSFWJS | null = null;

export const getCurrentModel = () => nsfwModel;

export async function loadModel() {
  nsfwModel = await nsfw.load();
  console.log('NSFWJS model loaded');
}

export async function checkNSFW(buffer: Buffer): Promise<boolean> {
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
        p.probability > 0.80
    );
  } catch (error) {
    console.error("Error checking NSFW content:", error);
    return false;
  }
}