import { parseCoordinateCsv } from "./parser.js";

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

self.addEventListener("message", async (event) => {
  const { id, operation, buffer, name } = event.data;
  try {
    const sourceHash = toHex(await crypto.subtle.digest("SHA-256", buffer));
    const text = new TextDecoder().decode(buffer);
    const result =
      operation === "csv"
        ? { sourceHash, parsed: parseCoordinateCsv(text, name) }
        : { sourceHash, text };
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
