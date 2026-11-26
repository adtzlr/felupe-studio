# 0025 User-defined materials

Status: Accepted

## Context

The material registry of the schema (#24, #136, #191, #346) has the common models: hyperelastic models of FElupe and of tensortrax, linear-elastic and elastic-plastic strain-based models, the Mullins effect. A user may need another one: a strain energy function of their own, an anisotropic model, a combination of models, or a class of their own. FElupe takes any of them: a constitutive model is an object with the methods `gradient` and `hessian`, e.g. `fem.Hyperelastic(...) & fem.Volumetric(...)`, a `fem.Material` of functions, or an object of a class of the user.

#192 proposed the code of a material inside the project file, with an inline editor. The mesh scripts (#182, ADR 0009) run Python code of a project another way: a file next to the project, run with the parameters of the model as variables.

## Decision

- **A user-defined material is a Python file next to the project,** like a mesh script (ADR 0009):
  - opened with the project, kept in the browser and in project archives (ADR 0007), and reported if it is missing;
  - not text inside the project file, so it can be edited and tried with any editor and Python.
- **One command, `material.script {name, file, kind, …}`,** next to `material.add`, as `mesh.script` is next to `mesh.import`, with the properties of its kind:
  - It is of the kind *material*, so a section references a material of the registry and one of a file alike.
  - `MaterialScript` is a `oneOf` of one definition per kind, with `kind` as a constant. Like the material models and the formulations (ADR 0024), a definition carries its label (`x-label`) and its menu of the ribbon (`x-group`, *User-defined*).
- **The kinds:**
  - `constitutive` (#423): the file makes a variable `umat`, any constitutive model of FElupe with `gradient` and `hessian`;
  - `hyperelastic` (#424): the file defines a strain energy function of tensortrax, which the script makes a `fem.Hyperelastic`;
  - `strain` (#425): the file defines a strain-based function, which the script makes a `fem.MaterialStrain` in a framework.
- **The parameters:**
  - A file of the kind `constitutive` gets the parameters of the model as variables: all of them, or the listed ones (`parameters`), like a mesh script. So a value of the material is a parameter of the model, with its slider and its expressions.
  - The kinds `hyperelastic` and `strain` take the keyword arguments of their function as fields of the material: `arguments`, a number or an expression of the parameters per argument, by its name. The worker reads them from the signature of the function in the run before a job (#424, #425), so the form has a field per argument, with its default value.
- **`volumetric`:** whether the material has a volumetric part of its own, by default `true`.
  - The commands alone cannot know it of a file, and the rule of the formulations (`section_material`, ADR 0024) needs it, like the bulk modulus of a model of the registry.
  - So the displacement formulation `u` takes a material with one, and `u-p-J` one without, with the same messages.
  - A constitutive model of a file is not strain-based: a section takes it like a material with a volumetric part of its own.
  - A strain energy function of a file has one with its bulk modulus `bulk`, a `fem.Volumetric` after it, like the models of tensortrax of the registry: without it, the function is the isochoric part of the strain energy and needs `u-p-J` (#424).
- **The script:** `rubber = run_material_script("soft.py", {"mu": mu, "bulk": bulk})`.
  - The helper is embedded only in scripts with materials of files, and its name is reserved.
  - It runs the file with `runpy.run_path(file, init_globals=parameters)` and takes its `umat`. A file without `umat`, or a `umat` without `gradient` and `hessian`, raises an error that says so.
  - The parameters are passed as a dict, so a parameter may have any name.
  - A strain energy function (#424): `rubber = fem.Hyperelastic(material_function("soft.py", "strain_energy"), mu=mu)` and `rubber &= fem.Volumetric(bulk=bulk)`, the lines of FElupe that a user would write. `material_function()` runs the file without the parameters and takes the function; with the Mullins effect, the function is the `material` of `fem.ogden_roxburgh`, like a model of tensortrax (#346).
- **The worker:**
  - The file is written into the folder of the project, like a mesh script, and the jobs run the generated script there.
  - It loads tensortrax for a model with a material of a file, which may use `fem.Hyperelastic`.
  - A request `inspect-material` runs the file once with the parameters, so its error is an issue of the material before a job, with the traceback of the file, and its properties say what it made: the type of `umat` and the number of its state variables. It runs again for a new version of the file or new values of its parameters.
  - Of a strain energy function (#424), it runs with the values of the material and gives the functions of the file with their arguments. It makes the material like the script and evaluates its stress and its elasticity tensor at a deformation, so an error in the function, an argument without a value or one that the function does not have is an issue before a job.
- **The templates** are files of the package (`felupe_studio/templates/`), one per kind, each a minimal file with the parameters as variables and their values for a run alone. A golden case runs each of them, so a template that no longer runs fails CI. *Download template* in the properties of a material saves the template of its kind under the name of its file; the app has them in its bundle, not from Python.
- **What a shared project may run:** a material script runs Python code, like a mesh script.
  - In the browser, Pyodide is a sandbox.
  - The local runtime (#240) shows the scripts of an opened project before they run (#183).
  - The MCP server runs a script only if it wrote it, or with `--allow-scripts`.

## Consequences

- A section takes a material of a file like one of the registry, with its formulation by `volumetric`.
- The results have the strains and the stresses as usual. The state variables of a material of a file are carried through a job, so a restored substep has its load history, but they are no contour: the contours of state variables (the equivalent plastic strain, the Mullins effect) are those of the models of the registry, and the Mullins effect of a strain energy function of a file (#424).
- An error of the file is an issue of the material before a job. The file runs once more in every job; a file that takes long to run, e.g. a fit of its parameters, takes that time twice.
- Every job with a material of a file loads tensortrax in the browser, a small wheel of pure Python, whether the file needs it or not.
- A script named like the FElupe script of a project archive (`<name>.py`) stays a script of its command when the archive is read, as for mesh scripts.

## Alternatives

- **Code inside the project file (#192):** one file less, but no editor, no `python soft.py` to try it, and long strings in JSON. An inline editor of the app remains a candidate (#192); it would edit the file of the project.
- **A command per kind** (`material.constitutive`, `material.hyperelastic`, `material.strain`): three commands of one kind of object, with the same file and parameters. One command with a registry of its kinds fits the materials and the formulations, and gives one menu of the ribbon.
- **The arguments of a function in `parameters`,** like the values of a model of the registry (#424): `parameters` of a constitutive model lists parameters of the model, which are references, renamed with them. One name with two meanings in one command would need the kind in the references and the renames; `arguments` says what they are.
- **The volumetric part from the file:** the worker could evaluate `umat` at a volumetric deformation. The validation would then need a run of the file, while the rules of the formulations know everything from the commands alone, like the dimensions of the mesh tools (ADR 0019).
