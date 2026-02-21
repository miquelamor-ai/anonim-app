// app.js

const uuidv4 = window.uuidv4; 

// Estat global bàsic
let documents = []; // DocumentModel[]
let entities = []; // PIIEntity[]
let currentViewMode = "original"; // 'original' | 'hidden'
let useNER = true;

// Workers
let ocrWorker = null;
let nerWorker = null;

// Elements DOM
const fileInput = document.getElementById("fileInput");
const rawTextInput = document.getElementById("rawTextInput");
const btnProcess = document.getElementById("btnProcess");
const btnToggleView = document.getElementById("btnToggleView");
const btnExport = document.getElementById("btnExport");
const textView = document.getElementById("textView");
const entitiesList = document.getElementById("entitiesList");
const statusLine = document.getElementById("statusLine");
const chkUseNER = document.getElementById("chkUseNER");

// Inicialització
init();

function init() {
  // Crea workers
  if (window.Worker) {
    ocrWorker = new Worker("ocrWorker.js");
    nerWorker = new Worker("nerWorker.js");
  }

  btnProcess.addEventListener("click", onProcessClick);
  btnToggleView.addEventListener("click", onToggleViewClick);
  btnExport.addEventListener("click", onExportClick);
  chkUseNER.addEventListener("change", () => {
    useNER = chkUseNER.checked;
  });

  // Interacció tap/click sobre el text
  textView.addEventListener("click", onTextClick);

  setStatus("Llista per carregar documents o text.");
}

function setStatus(msg) {
  statusLine.textContent = msg;
}

/* ---------------------------
   1. Ingesta i normalització
--------------------------- */

async function onProcessClick() {
  setStatus("📁 Carregant fitxers...");
  btnProcess.disabled = true;
  btnExport.disabled = true;
  documents = [];
  entities = [];

  const files = Array.from(fileInput.files || []);
  const raw = rawTextInput.value.trim();

  // Progrés: carregant fitxers
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    setStatus(`📄 Carregant ${file.name} (${i + 1}/${files.length})...`);
    const doc = await loadFile(file);
    if (doc) documents.push(doc);
  }

  if (raw.length > 0) {
    setStatus("✏️ Processant text manual...");
    documents.push(buildRawTextDocument(raw));
  }

  if (documents.length === 0) {
    setStatus("❌ No hi ha documents.");
    btnProcess.disabled = false;
    return;
  }

  setStatus("🔍 Detectant PII regex...");
  const regexEntities = detectByRegex(documents);

  setStatus("🧠 Detectant heurístiques...");
  const heuristicEntities = detectByHeuristic(documents);

  entities = [...regexEntities, ...heuristicEntities];

  if (useNER && nerWorker) {
    setStatus("🤖 Executant ML NER...");
    try {
      const nerEntities = await runNER(documents);
      entities.push(...nerEntities);
    } catch (e) {
      setStatus("⚠️ NER saltat (no disponible)");
    }
  }

  normalizeEntities();
  renderAll();

  const pendingCount = entities.filter((e) => e.status === "pending").length;
  setStatus(
    `✅ Detecció completa (${entities.length} entitats). ${pendingCount} pendents.`
  );

  btnProcess.disabled = false;
  btnExport.disabled = pendingCount > 0;
}

function buildRawTextDocument(text) {
  const docId = uuidv4();
  return {
    idDoc: docId,
    originalName: "text_manual",
    type: "rawText",
    blocks: [
      {
        blockId: uuidv4(),
        docId,
        type: "paragraph",
        text,
      },
    ],
  };
}

async function loadFile(file) {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  const docId = uuidv4();

  if (name.endsWith(".pdf")) {
    const blocks = await loadPdfBlocks(buf, docId);
    return {
      idDoc: docId,
      originalName: file.name,
      type: "pdf",
      blocks,
    };
  } else if (name.endsWith(".docx")) {
    const blocks = await loadDocxBlocks(buf, docId);
    return {
      idDoc: docId,
      originalName: file.name,
      type: "docx",
      blocks,
    };
  } else if (name.endsWith(".pptx")) {
    const blocks = await loadPptxBlocks(buf, docId);
    return {
      idDoc: docId,
      originalName: file.name,
      type: "pptx",
      blocks,
    };
  } else if (name.endsWith(".txt")) {
    const text = await file.text();
    const blocks = text
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map((line) => ({
        blockId: uuidv4(),
        docId,
        type: "paragraph",
        text: line,
      }));
    return {
      idDoc: docId,
      originalName: file.name,
      type: "txt",
      blocks,
    };
  } else if (name.endsWith(".csv")) {
    const text = await file.text();
    const parsed = Papa.parse(text, { header: true });
    const blocks = parsed.data.map((row) => ({
      blockId: uuidv4(),
      docId,
      type: "table",
      text: JSON.stringify(row),
    }));
    return {
      idDoc: docId,
      originalName: file.name,
      type: "csv",
      blocks,
    };
  } else if (name.match(/\.(jpg|jpeg|png)$/)) {
    const blocks = await loadImageBlocks(file, docId);
    return {
      idDoc: docId,
      originalName: file.name,
      type: "img",
      blocks,
    };
  }

  return null;
}

// PDF → text per pàgina (simplificat)
async function loadPdfBlocks(arrayBuffer, docId) {
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const blocks = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it) => it.str).join(" ");
    if (text.trim().length > 0) {
      blocks.push({
        blockId: uuidv4(),
        docId,
        type: "paragraph",
        text,
      });
    }
  }

  return blocks;
}

// DOCX amb mammoth
async function loadDocxBlocks(arrayBuffer, docId) {
  const result = await mammoth.convertToMarkdown({ arrayBuffer });
  const text = result.value;
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line) => ({
    blockId: uuidv4(),
    docId,
    type: line.startsWith("#") ? "heading" : "paragraph",
    text: line.replace(/^#+\s*/, ""),
  }));
}

// PPTX (simple): extreu text dels XML de slides
async function loadPptxBlocks(arrayBuffer, docId) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const blocks = [];
  const slideFiles = Object.keys(zip.files).filter((f) =>
    f.match(/^ppt\/slides\/slide\d+\.xml$/)
  );

  for (const f of slideFiles) {
    const xml = await zip.file(f).async("string");
    const matches = [...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)];
    matches.forEach((m) => {
      const text = m[1].trim();
      if (text.length > 0) {
        blocks.push({
          blockId: uuidv4(),
          docId,
          type: "paragraph",
          text,
        });
      }
    });
  }

  return blocks;
}

// Imatge → OCR via worker
async function loadImageBlocks(file, docId) {
  if (!ocrWorker) {
    return [
      {
        blockId: uuidv4(),
        docId,
        type: "imageText",
        text: "",
      },
    ];
  }

  const img = document.createElement("img");
  const url = URL.createObjectURL(file);
  img.src = url;
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const jobId = uuidv4();
  const text = await new Promise((resolve) => {
    ocrWorker.onmessage = (e) => {
      if (e.data.id !== jobId) return;
      if (e.data.success) resolve(e.data.text || "");
      else resolve("");
    };
    ocrWorker.postMessage({ id: jobId, imageData });
  });

  URL.revokeObjectURL(url);

  return [
    {
      blockId: uuidv4(),
      docId,
      type: "imageText",
      text,
    },
  ];
}

/* -------------------------
   2. Detecció PII (regex)
------------------------- */

function detectByRegex(docs) {
  const list = [];
  let idxToken = 1;

  for (const doc of docs) {
    for (const block of doc.blocks) {
      const text = block.text;
      for (const [type, regex] of Object.entries(PII_PATTERNS)) {
        regex.lastIndex = 0;
        let m;
        while ((m = regex.exec(text)) !== null) {
          const token = generateToken(type, idxToken++);
          list.push({
            id: uuidv4(),
            token,
            type,
            docId: doc.idDoc,
            blockId: block.blockId,
            start: m.index,
            length: m[0].length,
            textOriginal: m[0],
            confidence: 0.99,
            source: "regex",
            status: "approved",
          });
        }
      }
    }
  }
  return list;
}

/* ---------------------------------
   3. Detecció heurística (context)
--------------------------------- */

function detectByHeuristic(docs) {
  const list = [];
  let idxToken = 1000; // index separat per no solapar amb regex

  for (const doc of docs) {
    for (const block of doc.blocks) {
      const text = block.text;
      const lower = text.toLowerCase();

      CONTEXT_KEYWORDS.forEach((kw) => {
        let pos = 0;
        while ((pos = lower.indexOf(kw, pos)) !== -1) {
          // Mirem una mica més endavant després de la paraula clau
          const windowText = text.slice(pos + kw.length, pos + kw.length + 50);
          const matchWord = windowText.match(/\b[A-ZÀ-Ÿ][^\s,.;]*/);
          if (matchWord) {
            const startGlobal = pos + kw.length + windowText.indexOf(matchWord[0]);
            const token = generateToken("PERSON", idxToken++);
            list.push({
              id: uuidv4(),
              token,
              type: "PERSON",
              docId: doc.idDoc,
              blockId: block.blockId,
              start: startGlobal,
              length: matchWord[0].length,
              textOriginal: matchWord[0],
              confidence: 0.6,
              source: "heuristic",
              status: "pending",
            });
          }
          pos += kw.length;
        }
      });
    }
  }
  return list;
}

/* ----------------------------
   4. Capa NER (ML) via worker
---------------------------- */

async function runNER(docs) {
  if (!nerWorker) return [];

  // Concatenem text per doc
  const text = docs
    .map((d) => d.blocks.map((b) => b.text).join("\n"))
    .join("\n---\n");

  const jobId = uuidv4();
  const nerEntitiesRaw = await new Promise((resolve) => {
    nerWorker.onmessage = (e) => {
      if (e.data.id !== jobId) return;
      if (e.data.success) resolve(e.data.entities || []);
      else resolve([]);
    };
    nerWorker.postMessage({ id: jobId, text });
  });

  // Convertir les entitats del worker (global text) a PIIEntity per bloc
  // NOTA: dependrà de com codifiqui les posicions el model.
  // Ara mateix suposem que no tenim res i retornem [].
  return []; // S’ha de completar quan es tingui model real.
}

/* -------------------------------
   5. Normalització d'entitats
------------------------------- */

function normalizeEntities() {
  // TODO: eliminar duplicats (mateix rang de text amb tipus idèntic)
  // per simplicitat aquí no fem res avançat, però el desenvolupador pot:
  // - Agrupar per docId+blockId+start+length
  // - Escollir la entitat de més confiança
}

/* -------------------------------
   6. Render (modes i llista)
------------------------------- */

function renderAll() {
  renderText();
  renderEntitiesList();
}

function renderText() {
  let html = "";
  for (const doc of documents) {
    html += `<h3>${escapeHtml(doc.originalName)} (${doc.type})</h3>`;
    for (const block of doc.blocks) {
      const ents = entities.filter((e) => e.blockId === block.blockId);
      html += `<p data-block-id="${block.blockId}">`;
      html += renderBlock(block, ents, currentViewMode);
      html += `</p>`;
    }
  }
  textView.innerHTML = html;
}

function renderBlock(block, entsOfBlock, modeView) {
  const text = block.text;
  if (!entsOfBlock.length) return escapeHtml(text);

  let html = "";
  let idx = 0;
  const sorted = [...entsOfBlock].sort((a, b) => a.start - b.start);

  sorted.forEach((e) => {
    if (e.start > idx) {
      html += escapeHtml(text.slice(idx, e.start));
    }
    const fragment = text.slice(e.start, e.start + e.length);
    let shown = fragment;
    if (modeView === "hidden") {
      shown = `****${e.token}****`;
    }
    html += `<span class="pii pii-${e.status} pii-${e.type.toLowerCase()}"
                 data-entity-id="${e.id}">
               ${escapeHtml(shown)}
             </span>`;
    idx = e.start + e.length;
  });

  if (idx < text.length) {
    html += escapeHtml(text.slice(idx));
  }

  return html;
}

function renderEntitiesList() {
  entitiesList.innerHTML = "";
  entities.forEach((e) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <strong>${e.token}</strong> [${e.type}] (${e.status})<br/>
      <em>${escapeHtml(e.textOriginal)}</em><br/>
      doc=${e.docId.slice(0, 8)}... bloc=${e.blockId.slice(0, 8)}...
      <br/>
      <button data-action="approve" data-id="${e.id}">Aprova</button>
      <button data-action="reject" data-id="${e.id}">Rebutja</button>
    `;
    entitiesList.appendChild(li);
  });

  entitiesList.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      const id = ev.target.dataset.id;
      const action = ev.target.dataset.action;
      const ent = entities.find((x) => x.id === id);
      if (!ent) return;
      if (action === "approve") ent.status = "approved";
      if (action === "reject") ent.status = "rejected";
      renderAll();
      updateExportButtonState();
    });
  });

  updateExportButtonState();
}

function updateExportButtonState() {
  const hasPending = entities.some((e) => e.status === "pending");
  btnExport.disabled = hasPending;
}

/* -------------------------------
   7. Interacció tap/click text
------------------------------- */

function onTextClick(event) {
  const target = event.target;
  if (!target.classList.contains("pii")) {
    // Aquí es podria implementar selecció manual de text
    return;
  }
  const entityId = target.dataset.entityId;
  toggleEntityStatus(entityId);
  renderAll();
}

function toggleEntityStatus(entityId) {
  const e = entities.find((x) => x.id === entityId);
  if (!e) return;
  if (e.status === "approved") e.status = "rejected";
  else if (e.status === "rejected") e.status = "approved";
  else if (e.status === "pending") e.status = "approved";
}

/* -------------------------------
   8. Canvi mode vista
------------------------------- */

function onToggleViewClick() {
  currentViewMode = currentViewMode === "original" ? "hidden" : "original";
  btnToggleView.textContent =
    currentViewMode === "original" ? "Mode: Original" : "Mode: Ocult";
  renderAll();
}

/* -------------------------------
   9. Export MD + JSON
------------------------------- */

function onExportClick() {
  const hasPending = entities.some((e) => e.status === "pending");
  if (hasPending) {
    alert(
      "Encara hi ha entitats PII en estat pendent. Revisa-les abans d'exportar."
    );
    return;
  }

  // 1) Aplicar tokens al model intern
  applyTokensToBlocks();

  // 2) Doble pass: comprovar que ja no queden patrons PII estructurats
  const mdContent = generateMarkdown(documents);
  const leftoverPII = checkResidualPII(mdContent);
  if (leftoverPII.length > 0) {
    alert(
      "S'han detectat possibles dades sensibles després de l'anonimització. Revisa el text."
    );
    console.warn("Residual PII:", leftoverPII);
    return;
  }

  // 3) Export MD
  downloadBlob(
    new Blob([mdContent], { type: "text/markdown" }),
    "document_anonimitzat.md"
  );

  // 4) Export JSON mapping
  const mapping = buildMapping();
  downloadBlob(
    new Blob([JSON.stringify(mapping, null, 2)], {
      type: "application/json",
    }),
    "mapping_pii.json"
  );

  setStatus("Export completat.");
}

function applyTokensToBlocks() {
  const entitiesApproved = entities.filter((e) => e.status === "approved");
  const entsByBlock = {};
  entitiesApproved.forEach((e) => {
    if (!entsByBlock[e.blockId]) entsByBlock[e.blockId] = [];
    entsByBlock[e.blockId].push(e);
  });

  for (const doc of documents) {
    for (const block of doc.blocks) {
      const ents = entsByBlock[block.blockId];
      if (!ents || !ents.length) continue;
      let text = block.text;
      const sorted = [...ents].sort((a, b) => b.start - a.start);
      sorted.forEach((e) => {
        text =
          text.slice(0, e.start) +
          e.token +
          text.slice(e.start + e.length);
      });
      block.text = text;
    }
  }
}

function generateMarkdown(docs) {
  let md = "";
  for (const doc of docs) {
    md += `# Document: ${doc.originalName}\n\n`;
    for (const block of doc.blocks) {
      if (block.type === "heading") {
        md += `## ${block.text}\n\n`;
      } else {
        md += `${block.text}\n\n`;
      }
    }
  }
  return md;
}

function buildMapping() {
  const entsApproved = entities.filter((e) => e.status === "approved");
  return {
    generatedAt: new Date().toISOString(),
    documents: documents.map((d) => ({
      docId: d.idDoc,
      originalName: d.originalName,
      type: d.type,
    })),
    entities: entsApproved.map((e) => ({
      token: e.token,
      type: e.type,
      original: e.textOriginal,
      docId: e.docId,
      blockId: e.blockId,
    })),
  };
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Comprova si queden patrons IBAN/NIF/email/etc. després
function checkResidualPII(text) {
  const leftovers = [];
  for (const [type, regex] of Object.entries(PII_PATTERNS)) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
      leftovers.push({ type, match: m[0], index: m.index });
    }
  }
  return leftovers;
}
