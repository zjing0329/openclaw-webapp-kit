const [raw, ...requiredValues] = process.argv.slice(2);

if (raw === undefined) {
  throw new Error("Usage: node merge-json-array.mjs <json-array> [required-value ...]");
}

const existing = JSON.parse(raw);
if (!Array.isArray(existing) || existing.some((value) => typeof value !== "string")) {
  throw new Error("Expected a JSON array of strings");
}

console.log(JSON.stringify([...new Set([...existing, ...requiredValues])]));
