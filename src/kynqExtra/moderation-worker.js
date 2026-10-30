// Nudity check on the server, in its own thread (TensorFlow.js on the CPU blocks for a few hundred
// ms per image; the socket server must never wait on that). Same open-source NSFWJS MobileNetV2
// model the apps run, so a frame a phone flags is re-scored independently before anyone is
// restricted. Input: a base64 JPEG. Output: { Drawing, Hentai, Neutral, Porn, Sexy } probabilities.
import { parentPort } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tf from "@tensorflow/tfjs";
import jpeg from "jpeg-js";

const CLASSES = ["Drawing", "Hentai", "Neutral", "Porn", "Sexy"];
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../models/nsfw");

let model = null;
async function load() {
  if (model) return model;
  await tf.setBackend("cpu");
  const json = JSON.parse(fs.readFileSync(path.join(dir, "nsfw-mobilenet-v2.json"), "utf8"));
  const bin = fs.readFileSync(path.join(dir, "nsfw-mobilenet-v2.bin"));
  const weightData = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  model = await tf.loadLayersModel(tf.io.fromMemory({ modelTopology: json.modelTopology, weightSpecs: json.weightsManifest.flatMap((g) => g.weights), weightData }));
  return model;
}

async function score(base64) {
  const m = await load();
  const raw = jpeg.decode(Buffer.from(base64, "base64"), { useTArray: true, maxMemoryUsageInMB: 64 });
  const probs = tf.tidy(() => {
    const rgba = tf.tensor3d(raw.data, [raw.height, raw.width, 4], "int32");
    const rgb = rgba.slice([0, 0, 0], [-1, -1, 3]);
    const input = tf.image.resizeBilinear(rgb, [224, 224]).toFloat().div(255).expandDims(0);
    return m.predict(input);
  });
  const values = await probs.data();
  probs.dispose();
  return Object.fromEntries(CLASSES.map((c, i) => [c, Number(values[i].toFixed(4))]));
}

parentPort.on("message", async ({ id, base64, warm }) => {
  try {
    if (warm) { await load(); return parentPort.postMessage({ id, ok: true }); }
    parentPort.postMessage({ id, ok: true, scores: await score(base64) });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: err.message });
  }
});
