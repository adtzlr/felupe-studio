declare const __APP_VERSION__: string;
declare const __PYODIDE_VERSION__: string;
declare const __FELUPE_VERSION__: string;
declare const __WHEELS__: string[];
declare const __LAZY_WHEELS__: Record<string, string>;
declare const __BUILD_ID__: string;
/** The brand of the build (ADR 0020); the app reads the one of its page first. */
declare const __BRAND__: import("./brand").Brand;
