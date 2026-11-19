declare const __APP_VERSION__: string;
declare const __PYODIDE_VERSION__: string;
declare const __FELUPE_VERSION__: string;
declare const __WHEELS__: string[];
declare const __LAZY_WHEELS__: Record<string, string>;
declare const __BUILD_ID__: string;

/** The samples of the build (#350): src/vite/samples.ts. */
declare module "virtual:samples" {
  const samples: import("./core/samples").Sample[];
  export default samples;
}
