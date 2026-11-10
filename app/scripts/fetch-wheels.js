// Download the pure-Python wheels that Pyodide does not ship (FElupe, meshio) into
// public/wheels, so the app loads them from its own origin (#40). Versions and
// SHA-256 are pinned in package.json (config.wheels). Runs before dev and build.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf-8"),
);
const directory = new URL("../public/wheels/", import.meta.url);
const digest = (data) => createHash("sha256").update(data).digest("hex");

for (const [name, { version, sha256 }] of Object.entries(pkg.config.wheels)) {
  const filename = `${name}-${version}-py3-none-any.whl`;
  const target = new URL(filename, directory);
  try {
    if (digest(await readFile(target)) === sha256) continue;
  } catch {
    // not downloaded yet
  }

  const release = await fetch(`https://pypi.org/pypi/${name}/${version}/json`);
  if (!release.ok)
    throw new Error(`PyPI: ${release.status} for ${name} ${version}`);
  const file = (await release.json()).urls.find((u) => u.filename === filename);
  if (!file) throw new Error(`PyPI has no ${filename}`);

  const response = await fetch(file.url);
  if (!response.ok)
    throw new Error(`Download of ${filename} failed: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (digest(data) !== sha256) {
    throw new Error(
      `SHA-256 of ${filename} does not match package.json (config.wheels).`,
    );
  }

  await mkdir(directory, { recursive: true });
  await writeFile(target, data);
  console.log(
    `Downloaded ${filename} (${(data.length / 1024).toFixed(0)} KiB)`,
  );
}
