/*
 * discovery/virtual-scan.js — discover virtual / standalone g2d instances
 * running on this Mac via a TCP port-probe on 127.0.0.1.
 *
 * Compass-spawned virtuals use the conventional virtual port range (50503,
 * 50403, 50303, …, 48603). A standalone `g2d g2d` launched from a terminal
 * binds to the real-Galaxy port 25003 on the local host. We probe both.
 */

const net = require('node:net')
const { EventEmitter } = require('node:events')

const VIRTUAL_BASE_PORT = 50503
const VIRTUAL_PORT_STEP = 100
const VIRTUAL_MIN_ID = 1
const VIRTUAL_MAX_ID = 20
const HOST = '127.0.0.1'
const STANDALONE_PORT = 25003

const SCAN_INTERVAL_MS = 10000
const PROBE_TIMEOUT_MS = 800

const TX_EOL = '\n'
const EOL_SPLIT = /\r\n|\n|\r/

const ENTITY_NAME_ADDR = '/entity/entity_name'
const ENTITY_ID_ADDR = '/entity/entity_id'
const ENTITY_MODEL_ID_ADDR = '/entity/entity_model_id'
const MODEL_STRING_ADDR = '/status/model_string'
const SERIAL_NUMBER_ADDR = '/entity/serial_number'

function virtualPortForId(id) {
	return VIRTUAL_BASE_PORT - (id - VIRTUAL_MIN_ID) * VIRTUAL_PORT_STEP
}

function extractRhs(line) {
	const eq = line.indexOf('=')
	if (eq < 0) return undefined
	const rhs = line.slice(eq + 1).trim()
	if (
		rhs.length >= 2 &&
		((rhs.startsWith("'") && rhs.endsWith("'")) ||
			(rhs.startsWith('"') && rhs.endsWith('"')))
	) return rhs.slice(1, -1)
	return rhs
}

function probePort(host, port) {
	return new Promise((resolve) => {
		const sock = new net.Socket()
		let buf = ''
		let done = false
		const info = {}
		const finish = (val) => {
			if (done) return
			done = true
			clearTimeout(timer)
			try { sock.destroy() } catch (_) { /* ignore */ }
			resolve(val)
		}
		const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS)

		sock.on('error', () => finish(null))
		sock.on('close', () => {
			if (!done) finish(Object.keys(info).length ? info : null)
		})
		sock.on('data', (chunk) => {
			buf += chunk.toString('utf8')
			const parts = buf.split(EOL_SPLIT)
			buf = parts.pop() ?? ''
			for (const raw of parts) {
				const line = raw.trim()
				if (!line || line.includes('#error')) continue
				if (line.includes(ENTITY_ID_ADDR)) {
					info.raw_entity_id = (extractRhs(line) || '').toLowerCase().replace(/^0x/, '').padStart(16, '0')
				} else if (line.includes(ENTITY_NAME_ADDR)) {
					info.entity_name = extractRhs(line) || ''
				} else if (line.includes(ENTITY_MODEL_ID_ADDR)) {
					info.entity_model_id = (extractRhs(line) || '').toLowerCase().replace(/^0x/, '').padStart(16, '0')
				} else if (line.includes(MODEL_STRING_ADDR)) {
					info.model_string = extractRhs(line) || ''
				} else if (line.includes(SERIAL_NUMBER_ADDR)) {
					info.serial_number = extractRhs(line) || ''
				}
				if (
					info.raw_entity_id != null &&
					info.entity_name != null &&
					info.entity_model_id != null &&
					info.model_string != null &&
					info.serial_number != null
				) {
					finish(info)
					return
				}
			}
		})
		sock.connect(port, host, () => {
			try {
				sock.write(Buffer.from(
					`${ENTITY_ID_ADDR}${TX_EOL}${ENTITY_NAME_ADDR}${TX_EOL}${ENTITY_MODEL_ID_ADDR}${TX_EOL}${MODEL_STRING_ADDR}${TX_EOL}${SERIAL_NUMBER_ADDR}${TX_EOL}`,
					'utf8',
				))
			} catch (_) { finish(null) }
		})
	})
}

class VirtualGalaxyScanner extends EventEmitter {
	constructor(opts = {}) {
		super()
		this.log = opts.log || (() => {})
		this.intervalMs = opts.intervalMs || SCAN_INTERVAL_MS
		this.timer = null
		this.known = new Map()
		this._inFlight = false
	}

	start() {
		if (this.timer) return
		this._scan().catch(() => {})
		this.timer = setInterval(() => this._scan().catch(() => {}), this.intervalMs)
	}

	stop() {
		if (this.timer) { clearInterval(this.timer); this.timer = null }
		for (const dev of this.known.values()) this.emit('virtual-removed', dev)
		this.known.clear()
	}

	async _scan() {
		if (this._inFlight) return
		this._inFlight = true
		try {
			const ports = [STANDALONE_PORT]
			for (let id = VIRTUAL_MIN_ID; id <= VIRTUAL_MAX_ID; id++) ports.push(virtualPortForId(id))
			const results = await Promise.all(ports.map((p) => probePort(HOST, p).then((r) => ({ port: p, info: r }))))
			const now = Date.now()
			const found = new Map()
			for (const { port, info } of results) {
				if (!info || !info.raw_entity_id) continue
				// Synthesize a unique entity_id (virtuals share the default
				// 0xfffe000000 so we can't key on the raw one).
				const entity_id = `virtual:${HOST}:${port}`
				found.set(port, {
					...info,
					entity_id,
					host: HOST,
					port,
					lastSeen: now,
					is_virtual: true,
				})
			}

			for (const [port, dev] of found) {
				const prev = this.known.get(port)
				this.known.set(port, dev)
				if (!prev) this.emit('virtual-added', dev)
				else if (prev.entity_id !== dev.entity_id || prev.entity_name !== dev.entity_name) {
					this.emit('virtual-updated', dev, prev)
				}
			}
			for (const [port, prev] of this.known) {
				if (!found.has(port)) {
					this.known.delete(port)
					this.emit('virtual-removed', prev)
				}
			}
		} finally {
			this._inFlight = false
		}
	}

	snapshot() { return [...this.known.values()] }
}

module.exports = { VirtualGalaxyScanner }
