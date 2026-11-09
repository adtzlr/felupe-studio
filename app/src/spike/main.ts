import "../style.css";
import "./spike.css";
import type {
  BenchmarkResult,
  FromWorker,
  LoadTimings,
  ToWorker,
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
let runId = 0;

const environment = {
  userAgent: navigator.userAgent,
  cores: navigator.hardwareConcurrency,
  memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
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

const worker = new Worker(
  new URL("../worker/pyodide.worker.ts", import.meta.url),
  {
    type: "module",
  },
);

worker.onmessage = (event: MessageEvent<FromWorker>) => {
  const message = event.data;
  switch (message.type) {
    case "ready":
      versions = message.versions;
      timings = message.timings;
      status.textContent =
        `Ready: Pyodide ${versions.pyodide}, Python ${versions.python}, ` +
        `FElupe ${versions.felupe}, NumPy ${versions.numpy}, SciPy ${versions.scipy}.`;
      row(loadTable, ["Pyodide", seconds(timings.pyodide / 1000)]);
      row(loadTable, [
        "NumPy, SciPy, micropip",
        seconds(timings.packages / 1000),
      ]);
      row(loadTable, ["FElupe (micropip)", seconds(timings.felupe / 1000)]);
      row(loadTable, ["Total", seconds(timings.total / 1000)]);
      loadTable.hidden = false;
      runButton.disabled = false;
      updateMarkdown();
      break;
    case "progress":
      status.textContent = message.message;
      break;
    case "benchmark-result": {
      const r = message.result;
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
      break;
    }
    case "done":
      status.textContent = "Done.";
      runButton.disabled = false;
      break;
    case "error":
      errorBox.textContent = message.message;
      status.textContent = "Failed.";
      runButton.disabled = versions === undefined;
      break;
  }
};

form.addEventListener("submit", (event) => {
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
  runId += 1;
  const message: ToWorker = { type: "benchmark", id: runId, sizes };
  worker.postMessage(message);
});

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(markdownBox.textContent ?? "");
  copyButton.textContent = "Copied";
});

const init: ToWorker = {
  type: "init",
  pyodideVersion: __PYODIDE_VERSION__,
  felupeVersion: __FELUPE_VERSION__,
};
worker.postMessage(init);
