const CDN = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/";
const MODEL = "Xenova/t5-small";
let summarizer;

self.onmessage = async ({ data: { text } }) => {
  try {
    if (!summarizer) {
      const { env, pipeline } = await import(`${CDN}transformers.min.js`);
      env.allowLocalModels = false;
      env.backends.onnx.wasm.wasmPaths = CDN;
      env.backends.onnx.wasm.numThreads = 1;
      summarizer = await pipeline("summarization", MODEL, {
        quantized: true,
        progress_callback: ({ status, file, progress }) => {
          if (status === "progress" || status === "initiate") self.postMessage({ type: "progress", file, progress });
        },
      });
    }
    self.postMessage({ type: "summarizing" });
    const [{ summary_text: summary }] = await summarizer(text, {
      max_new_tokens: 72,
      min_new_tokens: 12,
      num_beams: 2,
      truncation: true,
    });
    if (!summary?.trim()) throw new Error("No model summary was returned.");
    self.postMessage({ type: "complete", summary: summary.trim() });
  } catch (error) {
    self.postMessage({ type: "failed", message: String(error) });
  }
};
