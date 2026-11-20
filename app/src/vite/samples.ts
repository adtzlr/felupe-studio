// The samples of the build (#350): a folder of samples, that of the brand (ADR 0020;
// the default brand has `app/samples`) or of SAMPLES_DIR, e.g.
// `SAMPLES_DIR=~/my-samples npm run build` (or `npm run dev`).
//
// The folder has a folder per sample, sorted by their names. A prefix of digits and
// `_` (e.g. `01_`) gives the order and is not a part of the id: `14_engine-mount` is
// the sample `engine-mount`. A sample folder has its project `model.felupe.json`, the
// mesh files and scripts that it names, optionally its `sample.json` (title,
// description and topics) and its picture `thumbnail.svg`. Folders whose names
// start with `.` or `_` are left out. The rules and the messages are those of
// `felupe_studio.samples`, tested with tests/data/sample_folder_cases.json.
//
// The plugin copies the files of the samples to `samples/<folder>/` of the build and
// writes their list `samples/index.json`, which the app loads at runtime; in dev, it
// serves both. This module runs in Node (the config of Vite), not in the app.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { parse, ProjectError } from "../core/project";
import { INDEX, type Sample } from "../core/samples";

export const PROJECT = "model.felupe.json";
export const DESCRIPTION = "sample.json";
export const THUMBNAIL = "thumbnail.svg";

const PREFIX = /^\d+_/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const KEYS: Record<string, "text" | "texts"> = {
  title: "text",
  description: "text",
  topics: "texts",
};

/** A folder of samples breaks the rules; the message says how. */
export class SamplesError extends Error {}

const fail = (message: string): never => {
  throw new SamplesError(message);
};

/** The title of a sample from its id, e.g. "Engine mount" of "engine-mount". */
export function titleOf(id: string): string {
  const words = id.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The mesh files and scripts of the project of a sample, checked. */
function filesOf(id: string, folder: string): string[] {
  const path = join(folder, PROJECT);
  if (!existsSync(path)) fail(`the sample '${id}' has no ${PROJECT}.`);
  let commands;
  try {
    commands = parse(readFileSync(path, "utf-8")).commands;
  } catch (error) {
    const reason =
      error instanceof ProjectError
        ? error.errors.join(" ")
        : (error as Error).message;
    return fail(`the ${PROJECT} of the sample '${id}' is invalid: ${reason}`);
  }
  const files = [
    ...new Set(
      commands.flatMap((c) =>
        c.command === "mesh.import" || c.command === "mesh.script"
          ? [c.file]
          : [],
      ),
    ),
  ].sort();
  for (const file of files)
    if (!existsSync(join(folder, file)))
      fail(`the sample '${id}' has no file '${file}'.`);
  return files;
}

/** The description of a sample (its `sample.json`), checked; empty without it. */
function descriptionOf(id: string, folder: string): Partial<Sample> {
  const path = join(folder, DESCRIPTION);
  if (!existsSync(path)) return {};
  let description: unknown;
  try {
    description = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    fail(
      `the ${DESCRIPTION} of the sample '${id}' is not valid JSON: ` +
        `${(error as Error).message}.`,
    );
  }
  if (
    typeof description !== "object" ||
    description === null ||
    Array.isArray(description)
  )
    fail(`the ${DESCRIPTION} of the sample '${id}' is not an object.`);
  for (const [key, value] of Object.entries(description as object)) {
    const kind = KEYS[key];
    if (!kind)
      fail(
        `the ${DESCRIPTION} of the sample '${id}' has the unknown key '${key}'; ` +
          "it may have title, description and topics.",
      );
    const good =
      kind === "text"
        ? typeof value === "string"
        : Array.isArray(value) && value.every((t) => typeof t === "string");
    if (!good)
      fail(
        `the ${key} of the sample '${id}' is not ` +
          `${kind === "text" ? "a text" : "a list of texts"}.`,
      );
  }
  return description as Partial<Sample>;
}

/** The sample of a folder, checked. */
export function readSample(folder: string): Sample {
  const name = folder.split(/[\\/]/).pop()!;
  const id = name.replace(PREFIX, "");
  if (!ID.test(id))
    fail(
      `the folder '${name}' has no valid id: after the prefix of digits and _, ` +
        "it needs letters, digits, ., _ or -.",
    );
  const files = filesOf(id, folder);
  const description = descriptionOf(id, folder);
  return {
    id,
    folder: name,
    title: description.title ?? titleOf(id),
    description: description.description ?? "",
    topics: description.topics ?? [],
    files,
    thumbnail: existsSync(join(folder, THUMBNAIL)),
  };
}

/**
 * The samples of a folder of samples in their order, checked. Throws a
 * `SamplesError` with a clear message.
 */
export function readSamples(dir: string): Sample[] {
  const root = resolve(dir.replace(/^~(?=$|[\\/])/, homedir()));
  if (!existsSync(root) || !statSync(root).isDirectory())
    fail(`the folder ${root} does not exist.`);
  const names = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !/^[._]/.test(e.name))
    .map((e) => e.name)
    .sort();
  const folders = new Map<string, string>();
  return names.map((name) => {
    const sample = readSample(join(root, name));
    const other = folders.get(sample.id);
    if (other)
      fail(
        `the folders '${other}' and '${name}' have the same id '${sample.id}'.`,
      );
    folders.set(sample.id, name);
    return sample;
  });
}

/** The files of a sample that the build copies: what the app and Python read. */
export const filesToCopy = (sample: Sample, root: string): string[] =>
  [PROJECT, DESCRIPTION, THUMBNAIL, ...sample.files].filter((file) =>
    existsSync(join(root, sample.folder, file)),
  );

/**
 * The plugin of Vite: the list and the files in the build and in dev. The folder
 * is SAMPLES_DIR or that of the brand (`brandOptions()` of brand.ts); without one,
 * the app has no samples.
 */
export function samples(dir: string | null): Plugin {
  let list: Sample[] = [];
  const root = dir ? resolve(dir.replace(/^~(?=$|[\\/])/, homedir())) : "";
  return {
    name: "samples",
    buildStart() {
      // without a folder, e.g. of a brand without samples: none (#279)
      if (!dir) return;
      try {
        list = readSamples(root);
      } catch (error) {
        this.error(`The samples of ${root}: ${(error as Error).message}`);
      }
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: INDEX,
        source: JSON.stringify(list, null, 2) + "\n",
      });
      for (const sample of list)
        for (const file of filesToCopy(sample, root))
          this.emitFile({
            type: "asset",
            fileName: `samples/${sample.folder}/${file}`,
            source: readFileSync(join(root, sample.folder, file)),
          });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = decodeURIComponent((request.url ?? "").split("?")[0]);
        if (path.endsWith(`/${INDEX}`)) {
          response.setHeader("Content-Type", "application/json");
          return response.end(JSON.stringify(list));
        }
        const match = /\/samples\/([^/]+)\/([^/]+)$/.exec(path);
        const sample = list.find((s) => s.folder === match?.[1]);
        if (!match || !sample || !filesToCopy(sample, root).includes(match[2]))
          return next();
        if (match[2].endsWith(".svg"))
          response.setHeader("Content-Type", "image/svg+xml");
        response.end(readFileSync(join(root, sample.folder, match[2])));
      });
    },
  };
}
