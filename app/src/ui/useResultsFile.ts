// The import of the results of a file (#414): File ▸ Import results… and the empty
// Results ribbon open the file dialog of a hidden input; the results of the chosen
// XDMF file are shown in the Results workspace, or the error in a banner.
import { useRef } from "preact/hooks";
import type { Results } from "./useResults";

interface Options {
  results: Results;
  /** The results of the file are shown, e.g. to open the Results workspace. */
  onShown: () => void;
  onError: (reason: unknown) => void;
}

export function useResultsFile({ results, onShown, onError }: Options) {
  const input = useRef<HTMLInputElement>(null);
  const { importResults } = results;
  return {
    /** Choose a file in the file dialog; none without Python. */
    choose: importResults && (() => input.current?.click()),
    /** The props of the hidden input of the file. */
    input: {
      ref: input,
      onChange: (event: Event) => {
        const element = event.currentTarget as HTMLInputElement;
        const file = element.files?.[0];
        element.value = "";
        if (file && importResults) importResults(file).then(onShown, onError);
      },
    },
  };
}
