// The sample models of the app (#32): project files with their mesh files in
// public/samples, listed in samples.json (both made by scripts/make_samples.py).
import index from "./samples.json";
import { SUFFIX } from "./files";

export interface Sample {
  id: string;
  title: string;
  description: string;
  /** Short labels of what the sample shows. */
  topics: string[];
  /** The mesh files of the project. */
  files: string[];
}

export const SAMPLES: readonly Sample[] = index;

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
