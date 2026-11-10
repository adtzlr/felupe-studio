import "../style.css";
import "./spike.css";
import { registerServiceWorker } from "../service-worker";
import { PyodideClient } from "../worker/client";
import type {
  BenchmarkResult,
  LoadTimings,
  Versions,
} from "../worker/protocol";
import { DEFAULT_SIZES, parseSizes, seconds, toMarkdown } from "./format";

const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

const status = $<HTMLParagraphElement>("#status");
const loadTable = $<HTMLTableElement>("#load");
const form = $<HTMLFormElement>("#form");
const sizesInput = $<HTMLInputElement>("#sizes");
const runButton = $<HTMLButtonElement>("#run");
const errorBox = $<HTMLParagraphElement>("#error");
const resultsTable = $<HTMLTableElement>("#results");
const copyButton = $<HTMLButtonElement>("#copy");
const markdownBox = $<HTMLPreElement>("#markdown");

sizesInput.value = DEFAULT_SIZES;

let versions: Versions | undefined;
let timings: LoadTimings | undefined;
let results: BenchmarkResult[] = [];

const environment = {
  userAgent: navigator.userAgent,
  cores: navigator.hardwareConcurrency,
  memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  serviceWorker: false,
};

function row(table: HTMLTableElement, cells: string[]): void {
  const tr = document.createElement("tr");
  for (const text of cells) {
    const td = document.createElement("td");
    td.textContent = text;
    tr.append(td);
  }
  table.tBodies[0].append(tr);
}

function updateMarkdown(): void {
  if (!versions || !timings) return;
  markdownBox.textContent = toMarkdown(environment, versions, timings, results);
  copyButton.disabled = false;
}

const client = new PyodideClient();
environment.serviceWorker = await registerServiceWorker();

client.ready.then(
  (ready) => {
    versions = ready.versions;
    timings = ready.timings;
    status.textContent =
      `Ready: Pyodide ${versions.pyodide}, Python ${versions.python}, ` +
      `FElupe ${versions.felupe}, NumPy ${versions.numpy}, SciPy ${versions.scipy}. ` +
      (environment.serviceWorker
        ? "Loaded through the service worker cache."
        : "Service worker not active yet: reload to measure with the cache.");
    row(loadTable, ["Pyodide", seconds(timings.pyodide / 1000)]);
    row(loadTable, ["NumPy, SciPy", seconds(timings.packages / 1000)]);
    row(loadTable, [
      "FElupe, meshio (wheels of the app)",
      seconds(timings.felupe / 1000),
    ]);
    row(loadTable, ["Total", seconds(timings.total / 1000)]);
    loadTable.hidden = false;
    runButton.disabled = false;
    updateMarkdown();
  },
  (error: Error) => {
    errorBox.textContent = error.message;
    status.textContent = "Failed.";
  },
);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.textContent = "";
  let sizes: number[];
  try {
    sizes = parseSizes(sizesInput.value);
  } catch (error) {
    errorBox.textContent = (error as Error).message;
    return;
  }
  results = [];
  resultsTable.tBodies[0].replaceChildren();
  runButton.disabled = true;
  try {
    await client.benchmark(
      sizes,
      (r) => {
        results.push(r);
        row(resultsTable, [
          String(r.n),
          String(r.dofs),
          String(r.cells),
          seconds(r.setup),
          seconds(r.solve),
          r.force.toFixed(4),
        ]);
        resultsTable.hidden = false;
        updateMarkdown();
      },
      (message) => (status.textContent = message),
    );
    status.textContent = "Done.";
  } catch (error) {
    errorBox.textContent = (error as Error).message;
    status.textContent = "Failed.";
  } finally {
    runButton.disabled = false;
  }
});

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(markdownBox.textContent ?? "");
  copyButton.textContent = "Copied";
});
