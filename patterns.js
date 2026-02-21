// patterns.js

// Regexs base per PII estructurades
const PII_PATTERNS = {
  IBAN: /\bES\d{2}\s?(?:\d{4}\s?){4}\d{0,4}\b/gi,
  NIF: /\b\d{8}[A-HJ-NP-TV-Z]\b/gi,
  NIE: /\b[XYZ]\d{7}[A-HJ-NP-TV-Z]\b/gi,
  CIF: /\b[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]\b/gi,
  PHONE: /\b(?:\+34\s?)?(?:6|7|8|9)\d{8}\b/g,
  EMAIL: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  CARD: /\b(?:\d[ -]*?){13,19}\b/g,
};

const CONTEXT_KEYWORDS = [
  "nom",
  "cognom",
  "titular",
  "adreça",
  "domicili",
  "compte",
  "número de compte",
  "nº compte",
  "expedient",
  "dni",
  "nif",
  "nie",
];

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Simple token generator per tipus
function generateToken(type, index) {
  return `${type}_${String(index).padStart(4, "0")}`;
}
