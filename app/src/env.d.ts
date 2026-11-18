declare const __APP_VERSION__: string;
declare const __PYODIDE_VERSION__: string;
declare const __FELUPE_VERSION__: string;
declare const __WHEELS__: string[];
declare const __LAZY_WHEELS__: Record<string, string>;
declare const __BUILD_ID__: string;

/** The extra samples of the build (EXTRA_SAMPLES_DIR, #255). */
declare module "virtual:extra-samples" {
  const samples: import("./core/samples").Sample[];
  export default samples;
  /** The build has the built-in samples (#279). */
  export const builtIn: boolean;
}
