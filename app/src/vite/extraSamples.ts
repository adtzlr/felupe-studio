// Extra samples from a folder at build time (#255): `EXTRA_SAMPLES_DIR=~/my-samples
// npm run build` (or `npm run dev`) adds the samples of a folder outside of the
// repository to the app, e.g. private ones. Without it, the build is unchanged.
//
// The folder has the layout of public/samples: a folder per sample with its
// `model.felupe.json`, its mesh files or mesh scripts and optionally its
// `thumbnail.svg`, and optionally a `samples.json` (the format of
// src/core/samples.json, `files` may be left out) with titles, descriptions, topics
// and the order. A sample without an entry gets its id and title from its folder.
// The plugin copies the files to `samples/<id>/` of the build (and serves them in
// dev), and the virtual module `virtual:extra-samples` lists them. This module runs
// in Node (the config of Vite), not in the app.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { parse, ProjectError } from "../core/project";
import type { Sample } from "../core/samples";
import builtIn from "../core/samples.json";

const VIRTUAL = "virtual:extra-samples";
const RESOLVED = `\0${VIRTUAL}`;
const PROJECT = "model.felupe.json";
const THUMBNAIL = "thumbnail.svg";

/** A sample of the folder, with where its files are. */
export interface ExtraSample extends Sample {
  /** The folder of the sample. */
  folder: string;
  /** The sample has a picture of its own (else a placeholder). */
  thumbnail: boolean;
}

export class ExtraSamplesError extends Error {}

const fail = (message: string): never => {
  throw new ExtraSamplesError(`EXTRA_SAMPLES_DIR: ${message}`);
};

/** The title of a sample from its id, e.g. "Engine mount" of "engine-mount". */
export function titleOf(id: string): string {
  const words = id.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A neutral picture of a sample without one: a cube on a grey card. */
export const PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100">
<rect width="160" height="100" fill="#8a94a3" fill-opacity="0.12"/>
<g fill="none" stroke="#8a94a3" stroke-width="2" stroke-linejoin="round">
<polygon points="80,26 104,38 80,50 56,38"/>
<polyline points="56,38 56,62 80,74 104,62 104,38"/>
<line x1="80" y1="50" x2="80" y2="74"/>
</g>
</svg>
`;

/** The mesh files and scripts of a project file, checked like the app does. */
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
  for (const file of files) {
    if (!existsSync(join(folder, file)))
      fail(`the sample '${id}' has no file '${file}'.`);
  }
  return files;
}

/**
 * The samples of a folder: those of its `samples.json` in its order, then the other
 * folders by name. Throws an `ExtraSamplesError` with a clear message.
 */
export function readExtraSamples(
  dir: string,
  taken: readonly string[] = builtIn.map((s) => s.id),
): ExtraSample[] {
  const root = resolve(dir.replace(/^~(?=$|[\\/])/, homedir()));
  if (!existsSync(root) || !statSync(root).isDirectory())
    fail(`the folder ${root} does not exist.`);
  const folders = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
  const indexPath = join(root, "samples.json");
  let index: Partial<Sample>[] = [];
  if (existsSync(indexPath)) {
    try {
      index = JSON.parse(readFileSync(indexPath, "utf-8"));
    } catch (error) {
      fail(`samples.json is not valid JSON: ${(error as Error).message}`);
    }
    if (!Array.isArray(index)) fail("samples.json is not a list of samples.");
  }
  for (const entry of index) {
    if (typeof entry?.id !== "string")
      fail("an entry of samples.json has no id.");
    if (!folders.includes(entry.id!))
      fail(`the entry '${entry.id}' of samples.json has no folder.`);
  }
  const listed = index.map((entry) => entry.id!);
  const ids = [...listed, ...folders.filter((f) => !listed.includes(f))];
  return ids.map((id) => {
    if (taken.includes(id))
      fail(`the id '${id}' is taken by a built-in sample.`);
    const folder = join(root, id);
    const entry = index.find((e) => e.id === id) ?? {};
    return {
      id,
      title: entry.title ?? titleOf(id),
      description: entry.description ?? "",
      topics: entry.topics ?? [],
      files: filesOf(id, folder),
      folder,
      thumbnail: existsSync(join(folder, THUMBNAIL)),
    };
  });
}

/** The content of a file of a sample: its picture, or the placeholder. */
function content(sample: ExtraSample, file: string): string | Buffer {
  if (file === THUMBNAIL && !sample.thumbnail) return PLACEHOLDER;
  return readFileSync(join(sample.folder, file));
}

/** The files of a sample that the app loads. */
const served = (sample: ExtraSample) => [PROJECT, THUMBNAIL, ...sample.files];

/** The plugin of Vite: the virtual module, the files in the build and in dev. */
export function extraSamples(
  dir: string | undefined = process.env.EXTRA_SAMPLES_DIR,
): Plugin {
  let samples: ExtraSample[] = [];
  return {
    name: "extra-samples",
    buildStart() {
      try {
        samples = dir ? readExtraSamples(dir) : [];
      } catch (error) {
        this.error((error as Error).message);
      }
    },
    resolveId: (id) => (id === VIRTUAL ? RESOLVED : undefined),
    load(id) {
      if (id !== RESOLVED) return undefined;
      const list = samples.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        topics: s.topics,
        files: s.files,
      }));
      return `export default ${JSON.stringify(list)};`;
    },
    generateBundle() {
      for (const sample of samples)
        for (const file of served(sample))
          this.emitFile({
            type: "asset",
            fileName: `samples/${sample.id}/${file}`,
            source: content(sample, file),
          });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = decodeURIComponent((request.url ?? "").split("?")[0]);
        const match = /\/samples\/([^/]+)\/(.+)$/.exec(path);
        const sample = samples.find((s) => s.id === match?.[1]);
        if (!match || !sample || !served(sample).includes(match[2]))
          return next();
        const type = match[2].endsWith(".svg") ? "image/svg+xml" : undefined;
        if (type) response.setHeader("Content-Type", type);
        response.end(content(sample, match[2]));
      });
    },
  };
}
