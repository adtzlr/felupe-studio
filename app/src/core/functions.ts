// The fields of the arguments of a function of a file in the form of its material:
// the arguments of a strain energy function after C (and statevars, #424) or of a
// strain-based function after dε, εn, σn and ζn (#425), from the run of the file
// before a job (`functionsOf` of MeshFiles), with their default values. A value of an
// argument that the function does not have stays a field, to clear it.
import type { Context, KeyField } from "./form";
import { FUNCTIONS } from "./materials";
import type { MeshFiles } from "./meshfiles";

/** The fields of the arguments of the function of a material of a file (#424). */
export function argumentFields(files: MeshFiles): NonNullable<Context["keys"]> {
  return (type, key, draft) => {
    if (
      type !== "material.script" ||
      key !== "arguments" ||
      typeof draft.kind !== "string" ||
      !(draft.kind in FUNCTIONS) ||
      typeof draft.file !== "string"
    )
      return undefined;
    const name =
      typeof draft.function === "string" && draft.function
        ? draft.function
        : FUNCTIONS[draft.kind as keyof typeof FUNCTIONS];
    const signature = files.functionsOf(draft.file)?.[name];
    if (!signature) return undefined;
    const fields: KeyField[] = signature.arguments.map((argument) =>
      argument.default === undefined
        ? {
            name: argument.name,
            required: true,
            hint: `An argument of ${name} without a default value`,
          }
        : {
            name: argument.name,
            placeholder:
              argument.default === null ? "default" : String(argument.default),
            hint: `An argument of ${name}; empty: its default value`,
          },
    );
    if (signature.kwargs) return fields;
    const known = new Set(signature.arguments.map((a) => a.name));
    const given =
      typeof draft.arguments === "object" && draft.arguments !== null
        ? Object.keys(draft.arguments)
        : [];
    return [
      ...fields,
      ...given
        .filter((argument) => !known.has(argument))
        .map((argument) => ({
          name: argument,
          hint: `${name} has no argument '${argument}': clear the field`,
        })),
    ];
  };
}
