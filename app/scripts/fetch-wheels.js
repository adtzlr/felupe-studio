// Download the FElupe wheel into public/wheels, so the app installs FElupe from its
// own origin instead of resolving it on PyPI (#40). Version and SHA-256 are pinned in
// package.json (config.felupe, config.felupeWheelSha256). Runs before dev and build.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf-8"),
);
const { felupe: version, felupeWheelSha256: sha256 } = pkg.config;
const filename = `felupe-${version}-py3-none-any.whl`;
const directory = new URL("../public/wheels/", import.meta.url);
const target = new URL(filename, directory);

const digest = (data) => createHash("sha256").update(data).digest("hex");

try {
  if (digest(await readFile(target)) === sha256) process.exit(0);
} catch {
  // not downloaded yet
}

const release = await fetch(`https://pypi.org/pypi/felupe/${version}/json`);
if (!release.ok)
  throw new Error(`PyPI: ${release.status} for felupe ${version}`);
const file = (await release.json()).urls.find((u) => u.filename === filename);
if (!file) throw new Error(`PyPI has no ${filename}`);

const response = await fetch(file.url);
if (!response.ok)
  throw new Error(`Download of ${filename} failed: ${response.status}`);
const data = Buffer.from(await response.arrayBuffer());
if (digest(data) !== sha256) {
  throw new Error(
    `SHA-256 of ${filename} does not match package.json (config).`,
  );
}

await mkdir(directory, { recursive: true });
await writeFile(target, data);
console.log(`Downloaded ${filename} (${(data.length / 1024).toFixed(0)} KiB)`);
