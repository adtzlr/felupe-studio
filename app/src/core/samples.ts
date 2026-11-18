// The sample models of the app (#32): project files with their mesh files in
// public/samples, listed in samples.json (both made by scripts/make_samples.py), and
// the extra samples of a folder at build time (EXTRA_SAMPLES_DIR, #255). A build
// with BUILT_IN_SAMPLES=false has only the extra samples (#279).
import extra, { builtIn } from "virtual:extra-samples";
import { SUFFIX } from "./files";
import index from "./samples.json";

export interface Sample {
  id: string;
  title: string;
  description: string;
  /** Short labels of what the sample shows. */
  topics: string[];
  /** The mesh files of the project. */
  files: string[];
}

/** The built-in samples, none in a build with BUILT_IN_SAMPLES=false (#279). */
export const SAMPLES: readonly Sample[] = builtIn ? index : [];

/** The samples of EXTRA_SAMPLES_DIR of the build (none by default, #255). */
export const EXTRA_SAMPLES: readonly Sample[] = extra;

/**
 * The samples in the sections of the welcome panel and of the dialog: the built-in
 * samples, then the extra ones (*More samples*, #255); without the built-in samples,
 * the extra ones are the samples (#279).
 */
export function sampleSections(
  builtIn: readonly Sample[] = SAMPLES,
  more: readonly Sample[] = EXTRA_SAMPLES,
): { samples: readonly Sample[]; more: readonly Sample[] } {
  return builtIn.length
    ? { samples: builtIn, more }
    : { samples: more, more: [] };
}

/** The build has samples, built-in or extra ones (#279). */
export const HAS_SAMPLES = SAMPLES.length + EXTRA_SAMPLES.length > 0;

/** The URL of a file of a sample. */
export const sampleUrl = (sample: Sample, file: string, base: string) =>
  new URL(`samples/${sample.id}/${file}`, base).href;

/** The URL of the picture of a sample (made by scripts/make_samples.py, #127). */
export const thumbnailUrl = (sample: Sample, base: string) =>
  sampleUrl(sample, "thumbnail.svg", base);

/**
 * The files of a sample, like files opened by the user: the project file (named
 * after the sample) and its mesh files.
 */
export async function sampleFiles(
  sample: Sample,
  base: string,
  get: typeof fetch = fetch,
): Promise<File[]> {
  const load = async (file: string, name = file) => {
    const response = await get(sampleUrl(sample, file, base));
    if (!response.ok) {
      throw new Error(
        `${file} of the sample could not be loaded (${response.status}).`,
      );
    }
    return new File([await response.blob()], name);
  };
  return Promise.all([
    load("model.felupe.json", `${sample.id}${SUFFIX}`),
    ...sample.files.map((file) => load(file)),
  ]);
}
