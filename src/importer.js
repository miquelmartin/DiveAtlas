import {
  addDiveSource,
  applyMappings,
  getRecord,
  hasSourceHash,
  openDatabase,
} from "./db.js";
import { parseCoordinateCsv, parseUddf } from "./parser.js";
import {
  mappingKey,
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

function normalizedDivePayload(dive, profile) {
  const {
    importedAt: _importedAt,
    sourceName: _sourceName,
    contentHash: _contentHash,
    ...stableDive
  } = dive;
  return { dive: stableDive, profile };
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
        const applied = await applyMappings(processed.parsed.mappings, mode, databasePromise);
        replaceApplied ||= mode === "replace";
        const issueCount = processed.parsed.issues.length + applied.conflicts.length;
        results.push({
          type: issueCount ? "warning" : "success",
          filename: file.name,
          message: `${applied.added} mapping(s) imported${
            issueCount ? `; ${issueCount} duplicate, conflict, or invalid row(s) reported` : ""
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
        const conflicts = [];
        const additions = [];
        const diveIds = [];
        for (const parsed of parsedDives) {
          parsed.dive.mappingKey = mappingKey(parsed.dive.location, parsed.dive.site);
          parsed.dive.contentHash = await sha256Text(
            stableStringify(normalizedDivePayload(parsed.dive, parsed.profile)),
          );
          diveIds.push(parsed.dive.id);
          const existing = await getRecord("dives", parsed.dive.id, databasePromise);
          if (existing) {
            if (existing.contentHash === parsed.dive.contentHash) duplicates += 1;
            else {
              conflicts.push(
                `Dive ${parsed.dive.number ?? parsed.dive.id} has the same identity but changed content; stored version retained`,
              );
            }
            continue;
          }
          additions.push(parsed);
          added += 1;
        }
        await addDiveSource(
          additions,
          processed.sourceHash,
          file.name,
          diveIds,
          conflicts.length === 0,
          databasePromise,
        );
        results.push({
          type: conflicts.length || duplicates ? "warning" : "success",
          filename: file.name,
          message: `${added} dive(s) imported${
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
