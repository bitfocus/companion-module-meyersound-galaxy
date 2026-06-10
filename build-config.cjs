/*
 * Picked up by @companion-module/tools' `companion-module-build` script.
 * Lists runtime assets that webpack can't bundle so they end up inside the
 * packaged tarball.
 *
 * The build tool copies each entry to <pkg>/<basename>, so:
 *   - 'helper/prebuilt'          lands at <pkg>/prebuilt/ — discovery/helper.js
 *                                resolves that location at runtime.
 *   - 'src/starting-points.json' lands at <pkg>/starting-points.json — read via
 *                                fs.readFileSync at runtime by actions-data.js
 *                                (not bundled by webpack, so it must be copied).
 */
module.exports = {
	extraFiles: ['helper/prebuilt', 'src/starting-points.json'],
}
