/*
 * discovery/cache.js — tiny on-disk cache of the last known discovery
 * result, shared across every running instance of this module via a
 * file in the OS temp directory.
 *
 * Purpose: when a user adds a second / third / fourth connection of
 * this module, the new instance reads the cache on startup and shows
 * the full Galaxy dropdown immediately — instead of running its own
 * 3-second discovery settle window from scratch. Existing instances
 * keep refreshing the cache as devices come and go, so a new instance
 * inherits the current view.
 *
 * Best-effort: any I/O error is swallowed silently. The cache is a
 * hint, never a source of truth.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CACHE_PATH = path.join(os.tmpdir(), 'companion-module-meyersound-galaxy-discovery.json')

// If the cache is older than this we drop it on read. Galaxys announce
// every ~10s and a running instance rewrites the cache on every
// device-change event, so anything older than ~60s strongly implies no
// other instance is running and we should not trust the snapshot.
const MAX_AGE_MS = 60_000

function readCache(log) {
	try {
		const json = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
		if (typeof json.writtenAt !== 'number') return null
		const ageMs = Date.now() - json.writtenAt
		if (ageMs > MAX_AGE_MS) {
			log?.('debug', `discovery cache stale (${Math.round(ageMs / 1000)}s old) — ignoring`)
			return null
		}
		if (!Array.isArray(json.devices)) return null
		log?.('info', `discovery cache hit — ${json.devices.length} device(s) restored from ${CACHE_PATH}`)
		return json.devices
	} catch (e) {
		if (e?.code !== 'ENOENT') log?.('debug', `discovery cache read failed: ${e.message}`)
		return null
	}
}

function writeCache(devices, log) {
	try {
		const payload = JSON.stringify({
			version: 1,
			writtenAt: Date.now(),
			devices,
		})
		// rename-into-place so concurrent readers never see a half-written file
		const tmp = `${CACHE_PATH}.${process.pid}.tmp`
		fs.writeFileSync(tmp, payload)
		fs.renameSync(tmp, CACHE_PATH)
	} catch (e) {
		log?.('debug', `discovery cache write failed (${e.code || ''}): ${e.message}`)
	}
}

module.exports = { readCache, writeCache, CACHE_PATH, MAX_AGE_MS }
