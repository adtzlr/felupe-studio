// The file name of a pure-Python wheel of PyPI (#40), with the name of the package
// normalized like in the file names of wheels: felupe-contact 0.1.0 is
// felupe_contact-0.1.0-py3-none-any.whl (#461). The names of the files in
// public/wheels, of the URLs of the worker and of the cache of public/sw.js.

/**
 * @param {string} name The name of the package in config.wheels, e.g. felupe-contact.
 * @param {string} version Its version, e.g. 0.1.0.
 * @returns {string} The file name of the wheel.
 */
export function wheelFile(name, version) {
  return `${normalizedName(name)}-${version}-py3-none-any.whl`;
}

/**
 * @param {string} name The name of a package, e.g. felupe-contact.
 * @returns {string} The name in the file name of its wheel, e.g. felupe_contact.
 */
export function normalizedName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, "_");
}
