import {
  applyMappings,
  hasSourceHash,
  importDiveSource,
  openDatabase,
} from "./db.js";
import { parseCoordinateCsv, parseUddf } from "./parser.js";
import { enrichMappingCountry } from "./country.js";
import {
  mappingKey,
  normalizedDivePayload,
  sha256Text,
  stableStringify,
} from "./utils.js";

export class ImportWorkerClient {
  constructor() {
    this.sequence = 0;
    this.pending = new Map();
    this.worker =
      typeof Worker === "undefined"
        ? null
        : new Worker(new URL("./import-worker.js", import.meta.url), { type: "module" });
    this.worker?.addEventListener("message", (event) => {
      const request = this.pending.get(event.data.id);
      if (!request) return;
      this.pending.delete(event.data.id);
      event.data.ok ? request.resolve(event.data.result) : request.reject(new Error(event.data.error));
    });
  }

  async process(file, operation) {
    const buffer = await file.arrayBuffer();
    if (!this.worker) {
      const text = new TextDecoder().decode(buffer);
      const sourceHash = await sha256Text(text);
      return operation === "csv"
        ? { sourceHash, parsed: parseCoordinateCsv(text, file.name) }
        : { sourceHash, text };
    }
    const id = ++this.sequence;
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.worker.postMessage({ id, operation, buffer, name: file.name }, [buffer]);
    return promise;
  }
}

export async function importSources(
  files,
  {
    mappingMode = "merge",
    databasePromise = openDatabase(),
    workerClient = new ImportWorkerClient(),
    onProgress = () => {},
    isCancelled = () => false,
    yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0)),
  } = {},
) {
  const results = [];
  let replaceApplied = false;
  let processedCount = 0;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (isCancelled()) break;
    onProgress(index, file.name);
    try {
      const csv = file.name.toLowerCase().endsWith(".csv");
      const processed = await workerClient.process(file, csv ? "csv" : "uddf");
      if (csv) {
        const mode = mappingMode === "replace" && !replaceApplied ? "replace" : "merge";
        const mappings = processed.parsed.mappings.map(enrichMappingCountry);
        const applied = await applyMappings(mappings, mode, databasePromise);
        replaceApplied ||= mode === "replace";
        const issueCount = processed.parsed.issues.length + applied.conflicts.length;
        results.push({
          type: issueCount ? "warning" : "success",
          filename: file.name,
          message: `${applied.added} mapping(s) added${
            applied.updated ? `; ${applied.updated} existing mapping(s) updated` : ""
          }${
            issueCount ? `; ${issueCount} duplicate, replaced, or invalid row(s) reported` : ""
          }`,
          issues: [
            ...processed.parsed.issues.map((issue) => `Line ${issue.line}: ${issue.message}`),
            ...applied.conflicts.map((issue) => issue.message),
          ],
        });
      } else {
        if (await hasSourceHash(processed.sourceHash, databasePromise)) {
          results.push({
            type: "warning",
            filename: file.name,
            message: "Exact source already imported; skipped",
            issues: [],
          });
          processedCount += 1;
          await yieldToMain();
          continue;
        }
        const parsedDives = parseUddf(processed.text, file.name);
        let added = 0;
        let duplicates = 0;
        let enriched = 0;
        const conflicts = [];
        const sourceCandidates = new Map();
        const blockedSourceIds = new Set();
        for (const parsed of parsedDives) {
          parsed.dive.mappingKey = mappingKey(parsed.dive.location, parsed.dive.site);
          parsed.dive.contentHash = await sha256Text(
            stableStringify(normalizedDivePayload(parsed.dive, parsed.profile)),
          );
          if (blockedSourceIds.has(parsed.dive.id)) continue;
          const prior = sourceCandidates.get(parsed.dive.id);
          if (prior) {
            if (prior.dive.contentHash === parsed.dive.contentHash) {
              duplicates += 1;
            } else {
              sourceCandidates.delete(parsed.dive.id);
              blockedSourceIds.add(parsed.dive.id);
              conflicts.push(
                `Source contains multiple dives with identity ${parsed.dive.id} but different content; all colliding entries were skipped`,
              );
            }
            continue;
          }
          sourceCandidates.set(parsed.dive.id, parsed);
        }
        const stored = await importDiveSource(
          [...sourceCandidates.values()],
          processed.sourceHash,
          file.name,
          conflicts.length > 0,
          databasePromise,
        );
        added += stored.added;
        duplicates += stored.duplicates;
        enriched += stored.enriched;
        conflicts.push(...stored.conflicts);
        results.push({
          type: conflicts.length || duplicates ? "warning" : "success",
          filename: file.name,
          message: `${added} dive(s) imported${
            enriched ? `; ${enriched} stored dive(s) enriched` : ""
          }${
            duplicates ? `; ${duplicates} normalized duplicate(s) skipped` : ""
          }${conflicts.length ? `; ${conflicts.length} conflict(s)` : ""}`,
          issues: conflicts,
        });
      }
    } catch (error) {
      results.push({
        type: "error",
        filename: file.name,
        message: error instanceof Error ? error.message : String(error),
        issues: [],
      });
    }
    processedCount += 1;
    await yieldToMain();
  }
  const cancelled = processedCount < files.length && isCancelled();
  onProgress(processedCount, "", { cancelled });
  return { results, processedCount, totalCount: files.length, cancelled };
}
