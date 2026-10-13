// Canonical JSON: sorted keys, no whitespace, strings/numbers/booleans/null/arrays/objects only.
// This is the single serialization used as input to proposal and payload hashing.
// BigInt is rejected on purpose: money crosses every boundary as an integer string.

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        throw new Error("canonicalJson: only finite integers are allowed as numbers");
      }
      return String(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported type ${typeof value}`);
  }
}
