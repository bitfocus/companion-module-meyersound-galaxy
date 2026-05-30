/*
 * Picked up by @companion-module/tools' `companion-module-build` script.
 * Lists runtime assets that webpack can't bundle (the native helper
 * binaries) so they end up inside the packaged tarball.
 *
 * The build tool copies each entry to <pkg>/<basename>, so
 * 'helper/prebuilt' lands at <pkg>/prebuilt/ — discovery/helper.js
 * resolves that location at runtime.
 */
module.exports = {
	extraFiles: ['helper/prebuilt'],
}
