// Saving files (#400, #439): with the save dialog of the system where the browser
// has one and allows it, else as downloads. A browser that refuses the dialog, by
// its site setting *File editing* or a policy, gets downloads for the rest of the
// session, after a note once.
import { useRef, useState } from "preact/hooks";
import {
  type FileData,
  type SavePicker,
  saver,
  systemPicker,
} from "../core/save";
import type { Banner } from "./useProject";

/** The note of a browser that refuses the save dialog (#439). */
export const REFUSED: Banner = {
  title:
    "The browser does not let FElupe Studio choose where files are saved, so they are downloaded.",
  lines: [
    "Chrome and Edge allow it with the site setting File editing, unless a policy of the browser blocks it. Reload the page after a change.",
  ],
  info: true,
};

interface Options {
  /** The save dialog; the default is that of the browser, if it has one. */
  picker?: SavePicker;
  download: (name: string, data: FileData) => void;
  /** The browser refused the save dialog: called once. */
  onRefused: () => void;
}

export function useSaver({ picker: given, download, onRefused }: Options) {
  const [picker] = useState(() => given ?? systemPicker());
  const [refused, setRefused] = useState(false);
  // the callback of the latest render
  const latest = useRef(onRefused);
  latest.current = onRefused;
  // one saver for the session: it keeps whether the browser refused the dialog
  const [save] = useState(() =>
    saver({
      picker,
      download,
      onRefused: () => {
        setRefused(true);
        latest.current();
      },
    }),
  );
  return {
    save,
    /** Whether a save opens the save dialog, else it is a download. */
    dialog: !!picker && !refused,
  };
}
