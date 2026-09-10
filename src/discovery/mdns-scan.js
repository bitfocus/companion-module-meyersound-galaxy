/*
 * discovery/mdns-scan.js — dependency-free mDNS (multicast DNS) browser for
 * Meyer Sound Galaxy units that advertise the `_mslg._tcp.local` service.
 *
 * Why this exists: the native ATDECC helper (helper.js) only hears Galaxys
 * that emit IEEE-1722.1 ADP on the segment it listens on. On a control /
 * management network the units are reachable by IP and announce themselves
 * over mDNS `_mslg._tcp`, but emit no ATDECC ADP there — so ATDECC discovery
 * comes up empty while the devices are plainly present. This scanner recovers
 * those units and feeds them into the same device list the ATDECC and virtual
 * scanners populate, so they reappear in the discovery dropdown.
 *
 * Self-contained on purpose: matches the module's zero-runtime-dependency
 * design. It binds UDP 5353, joins 224.0.0.251, periodically sends a PTR
 * query for `_mslg._tcp.local`, and parses the answers into
 * {added,updated,removed} events.
 *
 * Meyer's `g2d` responder uses a flat, non-standard layout: the PTR, A, AAAA
 * and TXT records are all owned directly by "_mslg._tcp.local" (no per-instance
 * SRV record), one response packet per unit from the unit's own source IP. The
 * TXT carries the identity we surface: galileoName (device name), systemName
 * (group), galileoType (model), serialNumber and mac. Connection target is the
 * advertised routable IPv4 on the Galaxy control port 25003.
 *
 * Fail-soft: any socket error disables the scanner quietly — manual entry
 * and the other discovery sources keep working.
 */

const dgram = require('node:dgram')
const os = require('node:os')
const { EventEmitter } = require('node:events')

const MDNS_ADDR = '224.0.0.251'
const MDNS_PORT = 5353
const SERVICE = '_mslg._tcp.local'
const DEFAULT_GALAXY_PORT = 25003

const SCAN_INTERVAL_MS = 10000
const EXPIRE_CHECK_MS = 5000
// A record we haven't re-heard within this window is considered gone. mDNS
// answers carry a TTL; we use max(TTL, floor) and expire at 1.5x so a single
// missed announce doesn't drop a live device.
const MIN_TTL_S = 30

// ---- DNS record types we care about -------------------------------------
const TYPE_A = 1
const TYPE_PTR = 12
const TYPE_TXT = 16
const TYPE_AAAA = 28

/**
 * Read a (possibly compression-pointer) DNS name starting at `offset`.
 * Returns { name, next } where `next` is the offset just past the name in the
 * record stream (pointers do not advance the outer cursor beyond their 2 bytes).
 */
function readName(buf, offset) {
	const labels = []
	let pos = offset
	let jumped = false
	let next = offset
	let guard = 0
	while (pos < buf.length) {
		if (guard++ > 128) break // corrupt / hostile packet — bail
		const len = buf[pos]
		if (len === 0) {
			pos += 1
			if (!jumped) next = pos
			break
		}
		if ((len & 0xc0) === 0xc0) {
			// compression pointer: top two bits set, 14-bit offset follows
			if (pos + 1 >= buf.length) break
			const ptr = ((len & 0x3f) << 8) | buf[pos + 1]
			if (!jumped) next = pos + 2
			jumped = true
			pos = ptr
			continue
		}
		if (pos + 1 + len > buf.length) break
		labels.push(buf.toString('utf8', pos + 1, pos + 1 + len))
		pos += 1 + len
	}
	return { name: labels.join('.'), next }
}

function parseTxt(buf, start, len) {
	const out = {}
	let pos = start
	const end = start + len
	while (pos < end) {
		const l = buf[pos]
		pos += 1
		if (l === 0 || pos + l > end) break
		const kv = buf.toString('utf8', pos, pos + l)
		pos += l
		const eq = kv.indexOf('=')
		if (eq < 0) out[kv.toLowerCase()] = ''
		else out[kv.slice(0, eq).toLowerCase()] = kv.slice(eq + 1)
	}
	return out
}

function ipv4(buf, off) {
	return `${buf[off]}.${buf[off + 1]}.${buf[off + 2]}.${buf[off + 3]}`
}

function ipv6(buf, off) {
	const parts = []
	for (let i = 0; i < 16; i += 2) parts.push(((buf[off + i] << 8) | buf[off + i + 1]).toString(16))
	// leave uncompressed — good enough as a connection target and easy to read
	return parts.join(':')
}

/** Build a single-question mDNS query packet for `name`/`type`. */
function buildQuery(name, type) {
	const labels = name.split('.').filter(Boolean)
	let qlen = 0
	for (const l of labels) qlen += 1 + Buffer.byteLength(l)
	qlen += 1 // root
	const buf = Buffer.alloc(12 + qlen + 4)
	// header: id 0, flags 0 (standard query), 1 question
	buf.writeUInt16BE(0, 0)
	buf.writeUInt16BE(0, 2)
	buf.writeUInt16BE(1, 4)
	let pos = 12
	for (const l of labels) {
		const b = Buffer.from(l, 'utf8')
		buf[pos] = b.length
		b.copy(buf, pos + 1)
		pos += 1 + b.length
	}
	buf[pos] = 0
	pos += 1
	buf.writeUInt16BE(type, pos) // QTYPE
	buf.writeUInt16BE(0x0001, pos + 2) // QCLASS IN (QM — multicast response)
	return buf
}

class MslgMdnsScanner extends EventEmitter {
	constructor(opts = {}) {
		super()
		this.log = opts.log || (() => {})
		this.intervalMs = opts.intervalMs || SCAN_INTERVAL_MS
		this.sock = null
		this.timer = null
		this.expireTimer = null
		// key -> emitted device record
		this.known = new Map()
		this._started = false
	}

	start() {
		if (this._started) return
		this._started = true
		let sock
		try {
			sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
		} catch (e) {
			this.log('debug', `mDNS: socket create failed: ${e.message}`)
			this._started = false
			return
		}
		this.sock = sock

		sock.on('error', (e) => {
			// EADDRINUSE without reuse, or a transient network error. mDNS is a
			// best-effort extra source; disable quietly rather than take anything down.
			this.log('debug', `mDNS: socket error (${e.code || ''}): ${e.message} — mDNS discovery disabled`)
			this.stop()
		})

		sock.on('message', (msg, rinfo) => {
			try {
				this._onPacket(msg, rinfo)
			} catch (err) {
				this.log('debug', `mDNS: parse error: ${err?.message || err}`)
			}
		})

		sock.on('listening', () => {
			try {
				sock.setMulticastTTL(255)
			} catch (_) {
				/* ignore */
			}
			try {
				sock.setMulticastLoopback(false)
			} catch (_) {
				/* ignore */
			}
			// Join the mDNS group on every non-internal IPv4 interface so
			// multi-homed hosts (e.g. a laptop on Wi-Fi + wired) hear answers
			// on all of them, not just the default route.
			const ifaces = os.networkInterfaces()
			let joined = 0
			for (const list of Object.values(ifaces)) {
				for (const ni of list || []) {
					if (ni.family !== 'IPv4' || ni.internal) continue
					try {
						sock.addMembership(MDNS_ADDR, ni.address)
						joined++
					} catch (_) {
						/* a given iface may refuse; keep going */
					}
				}
			}
			if (joined === 0) {
				try {
					sock.addMembership(MDNS_ADDR)
				} catch (_) {
					/* ignore */
				}
			}
			// Continuous-querying warm-up: a couple of quick follow-ups so a
			// device is found within a second or two instead of on the next
			// 10s tick (mDNS clients ramp queries at increasing intervals).
			this._query()
			setTimeout(() => this._query(), 1000)
			setTimeout(() => this._query(), 3000)
			this.timer = setInterval(() => this._query(), this.intervalMs)
			this.expireTimer = setInterval(() => this._expire(), EXPIRE_CHECK_MS)
		})

		try {
			// Bind 5353 so we receive multicast answers. reuseAddr lets us share
			// the port with a system mDNS responder (avahi / mDNSResponder).
			sock.bind(MDNS_PORT)
		} catch (e) {
			this.log('debug', `mDNS: bind failed: ${e.message} — mDNS discovery disabled`)
			this.stop()
		}
	}

	stop() {
		this._started = false
		if (this.timer) {
			clearInterval(this.timer)
			this.timer = null
		}
		if (this.expireTimer) {
			clearInterval(this.expireTimer)
			this.expireTimer = null
		}
		if (this.sock) {
			try {
				this.sock.close()
			} catch (_) {
				/* ignore */
			}
			this.sock = null
		}
		for (const dev of this.known.values()) this.emit('mslg-removed', dev)
		this.known.clear()
	}

	_query() {
		if (!this.sock) return
		const pkt = buildQuery(SERVICE, TYPE_PTR)
		try {
			this.sock.send(pkt, 0, pkt.length, MDNS_PORT, MDNS_ADDR)
		} catch (e) {
			this.log('debug', `mDNS: query send failed: ${e.message}`)
		}
	}

	_onPacket(buf, rinfo) {
		if (buf.length < 12) return
		const qd = buf.readUInt16BE(4)
		const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10)
		if (total === 0) return

		let pos = 12
		// skip questions
		for (let i = 0; i < qd; i++) {
			const { next } = readName(buf, pos)
			pos = next + 4 // QTYPE + QCLASS
			if (pos > buf.length) return
		}

		// Meyer's g2d mDNS responder uses a flat, non-standard layout: the PTR,
		// A, AAAA and TXT records are all owned directly by "_mslg._tcp.local"
		// (there is no per-instance SRV record). Each unit answers from its own
		// source IP, and the TXT carries the real identity (galileoName,
		// systemName, galileoType, serialNumber, mac). So we gather the records
		// owned by our service name and build one device per response packet.
		const owns = (n) => {
			const o = n.toLowerCase().replace(/\.$/, '')
			return o === SERVICE || o.endsWith(`.${SERVICE}`)
		}
		let sawService = false
		let txt = null
		const a4 = []
		const a6 = []
		let maxTtl = 0

		for (let i = 0; i < total; i++) {
			if (pos + 1 > buf.length) break
			const { name, next } = readName(buf, pos)
			pos = next
			if (pos + 10 > buf.length) break
			const type = buf.readUInt16BE(pos)
			const ttl = buf.readUInt32BE(pos + 4)
			const rdlen = buf.readUInt16BE(pos + 8)
			const rdata = pos + 10
			if (rdata + rdlen > buf.length) break
			if (ttl > maxTtl) maxTtl = ttl

			if (owns(name)) {
				if (type === TYPE_PTR) sawService = true
				else if (type === TYPE_TXT) {
					txt = parseTxt(buf, rdata, rdlen)
					sawService = true
				} else if (type === TYPE_A && rdlen === 4) {
					a4.push(ipv4(buf, rdata))
					sawService = true
				} else if (type === TYPE_AAAA && rdlen === 16) {
					a6.push(ipv6(buf, rdata))
					sawService = true
				}
			}
			pos = rdata + rdlen
		}

		if (!sawService) return

		const t = txt || {}
		const serial = String(t.serialnumber || t.serial || '').trim()
		const mac = String(t.mac || '')
			.split(',')[0]
			.trim()
			.toLowerCase()
		const name = String(t.galileoname || t.systemname || '').trim()
		const model = String(t.galileotype || '').trim()

		// Prefer an advertised routable IPv4; the packet's own source address
		// is the device and is a reliable fallback. Skip IPv4 link-local
		// (169.254.x) unless it's all we have.
		const routable4 = a4.find((ip) => !ip.startsWith('169.254.'))
		const host = routable4 || (rinfo && rinfo.address) || a4[0] || a6[0]
		if (!host) return

		const ttlS = Math.max(MIN_TTL_S, maxTtl || 0)
		// Key on the stablest identity available so repeated announces update
		// one entry: serial, else MAC, else the host address.
		const key = `mslg:${serial || mac || host}`
		const record = {
			entity_id: key,
			host,
			port: DEFAULT_GALAXY_PORT,
			entity_name: name || (mac ? `Galaxy ${mac}` : host),
			model,
			serial,
			mac,
			expiresAt: Date.now() + ttlS * 1500,
		}
		const existing = this.known.get(key)
		this.known.set(key, record)
		if (!existing) this.emit('mslg-added', record)
		else if (
			existing.host !== record.host ||
			existing.entity_name !== record.entity_name ||
			existing.model !== record.model
		)
			this.emit('mslg-updated', record, existing)
	}

	_expire() {
		const now = Date.now()
		for (const [key, dev] of this.known) {
			if (dev.expiresAt < now) {
				this.known.delete(key)
				this.emit('mslg-removed', dev)
			}
		}
	}
}

module.exports = { MslgMdnsScanner }
