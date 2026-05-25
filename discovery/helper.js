/*
 * discovery/helper.js — manages the native galaxy-discovery-helper child
 * process. Parses its NDJSON stdout into device-added/removed events and
 * expires devices whose `valid_time` has elapsed. Restarts the child if
 * it dies unexpectedly.
 */

const { spawn } = require('node:child_process')
const path = require('node:path')
const readline = require('node:readline')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')

const PREBUILT_DIR = path.join(__dirname, '..', 'helper', 'prebuilt')

function helperBinaryName() {
	const target =
		process.platform === 'darwin'
			? `darwin-${process.arch}`
			: process.platform === 'linux'
				? `linux-${process.arch}`
				: process.platform === 'win32'
					? `win-${process.arch}.exe`
					: `${process.platform}-${process.arch}`
	return `galaxy-discovery-helper-${target}`
}

function helperBinaryPath() {
	return path.join(PREBUILT_DIR, helperBinaryName())
}

class DiscoveryHelper extends EventEmitter {
	constructor(opts = {}) {
		super()
		this.log = opts.log || ((lvl, msg) => console.log(`[${lvl}]`, msg))
		this.proc = null
		this.rl = null
		this.devices = new Map()
		this.interfaces = []
		this.expireTimer = null
		this.restartTimer = null
		this.expectedExit = false
	}

	start() {
		const bin = helperBinaryPath()
		if (!fs.existsSync(bin)) {
			this.emit('helper-error', `helper binary not found: ${bin}`)
			this.log('error', `helper binary not found: ${bin}`)
			return
		}
		this.log('info', `spawning ${bin}`)
		this.expectedExit = false

		try {
			this.proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] })
		} catch (e) {
			this.emit('helper-error', `spawn failed: ${e.message}`)
			return
		}

		this.rl = readline.createInterface({ input: this.proc.stdout })
		this.rl.on('line', (line) => this._onLine(line))

		this.proc.stderr.on('data', (chunk) => {
			const txt = chunk.toString('utf8').trimEnd()
			if (txt) this.log('warn', `helper stderr: ${txt}`)
		})

		this.proc.on('exit', (code, signal) => {
			this.log('info', `helper exited (code=${code} signal=${signal})`)
			this.proc = null
			this.rl = null
			if (!this.expectedExit) {
				this.emit('helper-exit', { code, signal, unexpected: true })
				this.restartTimer = setTimeout(() => this.start(), 3000)
			} else {
				this.emit('helper-exit', { code, signal, unexpected: false })
			}
		})

		if (!this.expireTimer) {
			this.expireTimer = setInterval(() => this._expireDevices(), 5000)
		}
	}

	stop() {
		this.expectedExit = true
		if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
		if (this.expireTimer) { clearInterval(this.expireTimer); this.expireTimer = null }
		if (this.proc) {
			try { this.proc.stdin.end() } catch (_) { /* ignore */ }
			try { this.proc.kill('SIGTERM') } catch (_) { /* ignore */ }
		}
		this.devices.clear()
	}

	triggerDiscover() {
		if (!this.proc) return false
		try { this.proc.stdin.write('discover\n'); return true } catch (_) { return false }
	}

	identify(entityIdHex) {
		if (!this.proc) return false
		try { this.proc.stdin.write(`identify ${entityIdHex}\n`); return true } catch (_) { return false }
	}

	_onLine(line) {
		let msg
		try { msg = JSON.parse(line) } catch (_) {
			this.log('debug', `non-JSON line: ${line}`); return
		}
		switch (msg.event) {
			case 'ready':
				this.interfaces = Array.isArray(msg.interfaces) ? msg.interfaces : []
				this.emit('ready', msg)
				return
			case 'sent_discover':
				this.emit('discover-sent', msg)
				return
			case 'adp':
				this._onAdp(msg)
				return
			case 'error':
				this.log('warn', `helper error: ${msg.msg}`)
				this.emit('helper-error', msg.msg)
				return
			case 'stdin_closed':
			case 'quit':
				return
		}
	}

	_onAdp(msg) {
		const id = (msg.entity_id || '').toLowerCase()
		if (!id || id === '0000000000000000') return

		const now = Date.now()
		const validMs = Math.max(20, msg.valid_time_s || 0) * 1000

		const record = {
			entity_id: id,
			entity_model_id: (msg.entity_model_id || '').toLowerCase(),
			src_mac: (msg.src_mac || '').toLowerCase(),
			iface: msg.iface || '',
			expires_at: now + validMs * 1.5,
		}

		const existing = this.devices.get(id)
		if (msg.msg_type === 'ENTITY_DEPARTING') {
			if (existing) {
				this.devices.delete(id)
				this.emit('device-removed', existing)
			}
			return
		}

		this.devices.set(id, record)
		if (!existing) this.emit('device-added', record)
		else if (existing.iface !== record.iface) this.emit('device-updated', record, existing)
	}

	_expireDevices() {
		const now = Date.now()
		for (const [id, dev] of this.devices) {
			if (dev.expires_at < now) {
				this.devices.delete(id)
				this.emit('device-removed', dev)
			}
		}
	}
}

module.exports = { DiscoveryHelper, helperBinaryName, helperBinaryPath }
