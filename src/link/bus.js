// link/bus.js
// Loopback-only UDP multicast bus used to mirror control commands between module instances
// (connections) running on the same Companion server. Connections sharing a non-empty Link ID
// replay each other's outgoing device commands, so e.g. muting one Galaxy mutes its linked peers.
//
// Best-effort and self-contained: any socket failure logs a warning and turns the bus into a
// no-op — the module keeps working as a normal single connection. Nothing leaves the host
// (multicast TTL 0, membership/interface pinned to 127.0.0.1).

const dgram = require('node:dgram')

const MODULE_TAG = 'meyersound-galaxy-link/v1' // namespaces this module's traffic
const MCAST_ADDR = '239.255.77.13' // admin-scoped group, loopback only
const MCAST_PORT = 25113 // fixed shared bus port for this module
const PROTO_V = 1

class LinkBus {
	/**
	 * @param {Object} o
	 * @param {string} o.originId - stable per-instance id (ignore our own datagrams)
	 * @param {Function} o.log - (level, message) => void
	 * @param {Function} o.onMessage - (line) => void, called for peer commands to replay
	 */
	constructor({ originId, log, onMessage } = {}) {
		this.originId = String(originId || '')
		this.log = typeof log === 'function' ? log : () => {}
		this.onMessage = typeof onMessage === 'function' ? onMessage : () => {}
		this.linkId = ''
		this.sock = null
		this.ready = false
	}

	/** Open and join the multicast group. Idempotent; safe to call repeatedly. */
	start() {
		if (this.sock) return
		let sock
		try {
			sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
			sock.on('error', (e) => {
				this.log('warn', `Link bus socket error: ${e?.message || e}; linking disabled`)
				try {
					sock.close()
				} catch {}
				if (this.sock === sock) {
					this.sock = null
					this.ready = false
				}
			})
			sock.on('message', (buf) => this._onDatagram(buf))
			sock.bind(MCAST_PORT, () => {
				try {
					sock.setMulticastInterface('127.0.0.1')
					sock.setMulticastTTL(0) // never leaves the host
					sock.addMembership(MCAST_ADDR, '127.0.0.1') // loopback interface only
					sock.setMulticastLoopback(true) // sibling sockets on this host receive sends
					this.ready = true
					this.log('info', `Link bus ready on ${MCAST_ADDR}:${MCAST_PORT} (loopback)`)
				} catch (e) {
					this.log('warn', `Link bus join failed: ${e?.message || e}; linking disabled`)
					try {
						sock.close()
					} catch {}
					this.sock = null
					this.ready = false
				}
			})
			this.sock = sock
		} catch (e) {
			this.log('warn', `Link bus unavailable: ${e?.message || e}; linking disabled`)
			this.sock = null
			this.ready = false
		}
	}

	/** Leave the group and close the socket. */
	stop() {
		const s = this.sock
		this.sock = null
		this.ready = false
		if (!s) return
		try {
			s.dropMembership(MCAST_ADDR, '127.0.0.1')
		} catch {}
		try {
			s.close()
		} catch {}
	}

	/** Set the active link group id. Empty disables send/receive. */
	setLinkId(id) {
		this.linkId = id ? String(id) : ''
	}

	/** Broadcast a command line to the link group. No-op unless ready and linked. */
	send(line) {
		if (!this.ready || !this.sock || !this.linkId) return
		if (typeof line !== 'string' || !line) return
		const msg = JSON.stringify({
			v: PROTO_V,
			tag: MODULE_TAG,
			linkId: this.linkId,
			originId: this.originId,
			line,
		})
		try {
			this.sock.send(Buffer.from(msg), MCAST_PORT, MCAST_ADDR)
		} catch (e) {
			this.log('debug', `Link bus send failed: ${e?.message || e}`)
		}
	}

	_onDatagram(buf) {
		if (!this.linkId) return
		let m
		try {
			m = JSON.parse(buf.toString('utf8'))
		} catch {
			return
		}
		if (!m || m.tag !== MODULE_TAG || m.v !== PROTO_V) return
		if (m.linkId !== this.linkId) return // different link group
		if (m.originId === this.originId) return // our own loopback echo
		if (typeof m.line !== 'string' || !m.line) return
		try {
			this.onMessage(m.line)
		} catch {}
	}
}

module.exports = { LinkBus, MODULE_TAG, MCAST_ADDR, MCAST_PORT }
