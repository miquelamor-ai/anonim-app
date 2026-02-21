// ocrWorker.js

// Carrega Tesseract dins del worker
self.importScripts(
  "https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js"
);

self.onmessage = async (e) => {
  const { id, imageData } = e.data;
  try {
    const { data } = await Tesseract.recognize(imageData, "spa+cat+eng");
    self.postMessage({ id, success: true, text: data.text });
  } catch (err) {
    self.postMessage({ id, success: false, error: err.message });
  }
};
