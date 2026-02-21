// nerWorker.js

// tf.js dins worker
self.importScripts(
  "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js"
);

let modelLoaded = false;
let model = null;

// Carrega model NER a l'inici
async function loadModel() {
  if (modelLoaded) return;
  model = await tf.loadGraphModel("./models/ner-model/model.json");
  modelLoaded = true;
}

self.onmessage = async (e) => {
  const { id, text } = e.data;
  try {
    await loadModel();

    // TODO: tokenització adequada (per simplicitat, split per espai)
    const tokens = text.split(/\s+/);

    // Aquesta part dependrà del model concret.
    // A continuació només es mostra una crida genèrica i un postprocess “dummy”.
    // El desenvolupador haurà d’adaptar-ho al model real.

    // Exemple pseudo-codi:
    // const inputTensor = preprocessTokens(tokens);
    // const output = model.execute({ input_ids: inputTensor });
    // const labels = postprocessOutput(output);

    // Per ara, retornarem cap entitat (o un exemple molt simple).
    const entities = []; // Omplir amb { start, length, type, text, confidence }

    self.postMessage({ id, success: true, entities });
  } catch (err) {
    self.postMessage({ id, success: false, error: err.message });
  }
};
