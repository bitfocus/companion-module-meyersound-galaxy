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

// Resolved relative to the running main.js so it works in both modes:
//   - dev mode    → <module>/helper/prebuilt   (main.js lives in <module>/src,
//                   so the binaries are one level up at <module>/helper/prebuilt)
//   - companion-module-build pkg → <pkg>/prebuilt (extraFiles flattens it)
const MODULE_DIR = path.dirname(process.argv[1] || '')
const PREBUILT_CANDIDATES = [
	path.join(MODULE_DIR, 'helper', 'prebuilt'), // older flat dev layout
	path.join(MODULE_DIR, '..', 'helper', 'prebuilt'), // dev: main.js under src/
	path.join(MODULE_DIR, 'prebuilt'), // packaged: extraFiles flattens it
]
const PREBUILT_DIR =
	PREBUILT_CANDIDATES.find((p) => fs.existsSync(p)) || PREBUILT_CANDIDATES[PREBUILT_CANDIDATES.length - 1]

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
		this.expireTimer = null
		this.restartTimer = null
		this.expectedExit = false
	}

	start() {
		// Clear any pending restart so back-to-back start() calls (e.g. a
		// rapid disable→enable cycle in Companion) can't leave a second
		// restartTimer firing into a new process.
		if (this.restartTimer) {
			clearTimeout(this.restartTimer)
			this.restartTimer = null
		}

		const bin = helperBinaryPath()
		this.log('info', `spawning ${bin}`)
		this.expectedExit = false
		this.gotReady = false

		try {
			this.proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] })
		} catch (e) {
			// spawn throws ENOENT if the binary is missing — same intent as
			// the previous existsSync check, without the race window.
			this.emit('helper-error', `spawn failed: ${e.message}`)
			this.log('error', `spawn failed: ${e.message}`)
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
			// If the process died before it could even emit a 'ready'
			// event, the most common cause is a platform prerequisite
			// (BPF group / CAP_NET_RAW / Npcap install). The Windows
			// loader uses exit code 0xC0000135 (-1073741515 as int32)
			// to signal "required DLL not found", which is what happens
			// when wpcap.dll is missing because Npcap was never installed.
			if (!this.gotReady && !this.expectedExit) {
				this._logPrerequisiteHint(code)
			}
			this.proc = null
			try {
				this.rl?.close()
			} catch (_) {
				/* ignore */
			}
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

	_logPrerequisiteHint(exitCode) {
		if (process.platform === 'win32') {
			// 0xC0000135 = STATUS_DLL_NOT_FOUND. Node surfaces it as a
			// signed int32, which is -1073741515.
			if (exitCode === -1073741515 || exitCode === 0xc0000135) {
				this.log(
					'error',
					'Discovery helper failed to start: wpcap.dll not found. ' +
						'Install Npcap from https://npcap.com — pick the default ' +
						'install options and re-enable this connection.',
				)
				return
			}
			this.log(
				'warn',
				'Discovery helper exited before reporting ready. If you have ' +
					'not installed Npcap (https://npcap.com), do that first.',
			)
			return
		}
		if (process.platform === 'darwin') {
			this.log(
				'warn',
				'Discovery helper exited before reporting ready. If the ' +
					'preceding error mentioned BPF permission denied, add this ' +
					'user to the access_bpf group: ' +
					'sudo dseditgroup -o edit -a $USER -t user access_bpf, ' +
					'then log out and back in.',
			)
			return
		}
		if (process.platform === 'linux') {
			this.log(
				'warn',
				'Discovery helper exited before reporting ready. If the ' +
					'preceding error mentioned EPERM, grant the helper binary ' +
					'CAP_NET_RAW: sudo setcap cap_net_raw=eip <path-to-helper>.',
			)
		}
	}

	stop() {
		this.expectedExit = true
		if (this.restartTimer) {
			clearTimeout(this.restartTimer)
			this.restartTimer = null
		}
		if (this.expireTimer) {
			clearInterval(this.expireTimer)
			this.expireTimer = null
		}
		if (this.proc) {
			try {
				this.proc.stdin.end()
			} catch (_) {
				/* ignore */
			}
			try {
				this.proc.kill('SIGTERM')
			} catch (_) {
				/* ignore */
			}
		}
		try {
			this.rl?.close()
		} catch (_) {
			/* ignore */
		}
		this.rl = null
		this.devices.clear()
	}

	_onLine(line) {
		let msg
		try {
			msg = JSON.parse(line)
		} catch (_) {
			this.log('debug', `non-JSON line: ${line}`)
			return
		}
		switch (msg.event) {
			case 'ready':
				this.gotReady = true
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

module.exports = { DiscoveryHelper }
