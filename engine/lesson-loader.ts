import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, parseAllDocuments } from "yaml";
import { lessonManifest } from "../lessons/manifest";
import type { Lesson, LessonStep, StepType } from "./lesson-types";

/**
 * Server-side lesson loader.
 *
 * Reads the YAML definitions in /lessons, validates them, sorts them and hands
 * plain data to the UI. Adding a lesson means adding a file plus a manifest
 * entry: no UI code changes.
 */

const LESSONS_DIR = join(process.cwd(), "lessons");
const STEP_TYPES: StepType[] = ["observation", "challenge", "explanation", "transition"];

function fail(file: string, message: string): never {
  throw new Error(`Invalid lesson "${file}": ${message}`);
}

function validateStep(file: string, step: unknown, index: number): LessonStep {
  if (typeof step !== "object" || step === null) fail(file, `step ${index + 1} is not an object`);
  const candidate = step as LessonStep;
  if (!STEP_TYPES.includes(candidate.type)) {
    fail(file, `step ${index + 1} has unknown type "${candidate.type}"`);
  }
  if (candidate.type === "challenge") {
    if (!candidate.prompt) fail(file, `challenge step ${index + 1} is missing a prompt`);
    if (!candidate.expected) fail(file, `challenge step ${index + 1} is missing "expected"`);
    if (!candidate.hint) fail(file, `challenge step ${index + 1} is missing a hint`);
  } else if (!candidate.text) {
    fail(file, `${candidate.type} step ${index + 1} is missing text`);
  }
  return candidate;
}

function parseManifestFile(raw: string): Record<string, unknown> {
  const documents = parseAllDocuments(raw)
    .map((document) => document.toJS() as Record<string, unknown>)
    .filter(Boolean);
  return (documents.length > 1 ? documents : documents[0]) as Record<string, unknown>;
}

function loadLesson(fileName: string, order: number): Lesson {
  const source = readFileSync(join(LESSONS_DIR, `${fileName}.yaml`), "utf8");
  const doc = parse(source) as Partial<Lesson> & { files?: Record<string, string> };

  if (!doc || typeof doc !== "object") fail(fileName, "file is empty or not valid YAML");
  if (!doc.id) fail(fileName, "missing id");
  if (!doc.title) fail(fileName, "missing title");
  if (!doc.chapter) fail(fileName, "missing chapter");
  if (!doc.intro) fail(fileName, "missing intro");
  if (!Array.isArray(doc.steps) || doc.steps.length === 0) fail(fileName, "missing steps");

  const files: Lesson["files"] = {};
  for (const [name, raw] of Object.entries(doc.files ?? {})) {
    if (typeof raw !== "string") fail(fileName, `file "${name}" must be a YAML string block`);
    files[name] = { raw: raw.trimEnd(), doc: parseManifestFile(raw) };
  }

  return {
    id: doc.id,
    order,
    chapter: doc.chapter,
    title: doc.title,
    concept: doc.concept ?? "",
    intro: doc.intro,
    initialState: doc.initialState,
    files: Object.keys(files).length ? files : undefined,
    steps: doc.steps.map((step, index) => validateStep(fileName, step, index)),
  };
}

export function loadLessons(): Lesson[] {
  return lessonManifest.map((fileName, index) => loadLesson(fileName, index + 1));
}
