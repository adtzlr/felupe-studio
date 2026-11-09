/** A plain file name, so that a file cannot be written outside of the project. */
export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  if (!base || base === "." || base === "..")
    throw new Error(`Invalid file name '${name}'.`);
  return base;
}
