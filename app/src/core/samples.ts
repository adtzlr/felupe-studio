// The sample models of the app (#32, #350): the folder of samples of the build,
// app/samples or SAMPLES_DIR, where every sample describes itself (its sample.json)
// and the prefix of its folder gives the order. The plugin src/vite/samples.ts reads
// it and lists the samples in the virtual module.
import list from "virtual:samples";
import { SUFFIX } from "./files";

export interface Sample {
  id: string;
  /** The folder of the sample in the folder of samples, e.g. `05_glued-plate`. */
  folder: string;
  title: string;
  description: string;
  /** Short labels of what the sample shows. */
  topics: string[];
  /** The mesh files of the project. */
  files: string[];
  /** The sample has a picture of its own (else a placeholder). */
  thumbnail: boolean;
}

/** The samples of the build, none without a folder of samples. */
export const SAMPLES: readonly Sample[] = list;

/** The build has samples. */
export const HAS_SAMPLES = SAMPLES.length > 0;

/** The URL of a file of a sample. */
export const sampleUrl = (sample: Sample, file: string, base: string) =>
  new URL(`samples/${sample.folder}/${file}`, base).href;

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

/** The URL of the picture of a sample (made by scripts/make_samples.py, #127). */
export const thumbnailUrl = (sample: Sample, base: string) =>
  sample.thumbnail
    ? sampleUrl(sample, "thumbnail.svg", base)
    : `data:image/svg+xml,${encodeURIComponent(PLACEHOLDER)}`;

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
