/**
 * The decision model behind the judgement gates. Jev is the default, but the gates only
 * see this interface, so another model (or recorded answers) can stand in.
 *
 * "Noul" is Jev System One's name for a yes/no question. Its answer is one probability of
 * "yes", which is also its confidence, so there is no separate confidence field.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { JevConfig } from "../config.ts";
import { CredentialError } from "../errors.ts";

/** One yes/no question as Jev receives it: the instructions, and optionally what "yes" and "no" mean. */
export interface NoulSpec {
  instructions: string;
  criteria?: { true: string; false: string };
}

/** One request: the text to judge (`state`) and the questions to answer about it, by id. */
export interface NoulRequest {
  state: unknown;
  questions: Record<string, NoulSpec>;
}

/** Jev's answer to one request. */
export interface NoulResult {
  /** Probability of "yes" (0–1) per question id. */
  answers: Record<string, number>;
  inputTokens: number;
  model: string;
}

/** What every gate asks its questions through. Tests use `FakeModel` or `RecordedModel`, never the real API. */
export interface DecisionModel {
  readonly name: string;
  evaluate(req: NoulRequest): Promise<NoulResult>;
}

/** Calls TypeSafe's System One endpoint over HTTP. Retries 429/529 with backoff. */
export class JevHttpModel implements DecisionModel {
  readonly name = "jev";
  private readonly apiKey: string;
  private readonly config: JevConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, config: JevConfig, fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async evaluate(req: NoulRequest): Promise<NoulResult> {
    const body = JSON.stringify({
      model: this.config.model,
      state: req.state,
      questions: Object.fromEntries(
        Object.entries(req.questions).map(([id, q]) => [id, { type: "noul", ...q }]),
      ),
    });
    const delays = [1000, 3000];
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(this.config.endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      if ((res.status === 429 || res.status === 529) && attempt < delays.length) {
        await sleep(delays[attempt] ?? 1000);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        // g1 criterion 17: name the key, never its value (the body can echo it).
        throw new CredentialError(`Jev refused TYPESAFE_API_KEY (HTTP ${res.status}). The key may be expired or revoked.`);
      }
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        throw new Error(`Jev request failed: HTTP ${res.status}: ${detail}`);
      }
      const json = (await res.json()) as {
        model?: string;
        answers?: Record<string, { noul?: number }>;
        usage?: { input_tokens?: number };
      };
      const answers: Record<string, number> = {};
      for (const id of Object.keys(req.questions)) {
        const p = json.answers?.[id]?.noul;
        if (typeof p !== "number") throw new Error(`Jev response has no noul answer for "${id}".`);
        answers[id] = p;
      }
      return { answers, inputTokens: json.usage?.input_tokens ?? 0, model: json.model ?? this.config.model };
    }
  }
}

interface RecordingFile {
  version: 1;
  entries: Record<string, NoulResult>;
}

/** Stable key for a request: same state and questions give the same key. */
export function requestKey(req: NoulRequest): string {
  return createHash("sha256").update(stableStringify(req)).digest("hex").slice(0, 16);
}

function readRecording(path: string): RecordingFile {
  if (!existsSync(path)) return { version: 1, entries: {} };
  return JSON.parse(readFileSync(path, "utf8")) as RecordingFile;
}

/** Answers from a recording file. For tests, CI without a key, and repeatable calibration. */
export class RecordedModel implements DecisionModel {
  readonly name = "recorded";
  private readonly file: RecordingFile;
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    this.file = readRecording(path);
  }

  async evaluate(req: NoulRequest): Promise<NoulResult> {
    const key = requestKey(req);
    const hit = this.file.entries[key];
    if (!hit) throw new Error(`No recorded answer for request ${key} in ${this.path}. Run once with --record to capture it.`);
    return hit;
  }
}

/** Wraps a live model and saves every answer, so later runs can use RecordedModel. */
export class RecordingModel implements DecisionModel {
  readonly name: string;
  private readonly inner: DecisionModel;
  private readonly path: string;
  private readonly file: RecordingFile;

  constructor(inner: DecisionModel, path: string) {
    this.inner = inner;
    this.path = path;
    this.name = `${inner.name}+record`;
    this.file = readRecording(path);
  }

  async evaluate(req: NoulRequest): Promise<NoulResult> {
    const result = await this.inner.evaluate(req);
    this.file.entries[requestKey(req)] = result;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(this.file, null, 2)}\n`);
    return result;
  }
}

/** JSON with the object keys sorted and undefined values left out, so equal requests give equal text. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
