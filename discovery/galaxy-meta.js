/*
 * discovery/galaxy-meta.js — small utilities for translating ATDECC ADP
 * fields into things the rest of the module wants:
 *
 *   - macToIPv6LinkLocal(mac, ifaceScope)
 *       maps "00:1c:ab:01:1a:dc" + "en15" -> "fe80::21c:abff:fe01:1adc%en15"
 *
 *   - modelNameFromEntityModelId(idHex)
 *       maps an observed Meyer entity_model_id to one of:
 *         "Galaxy 408" / "Galaxy 816" / "Galaxy 816-AES" / "Galaxy Bluehorn"
 */

function macToIPv6LinkLocal(mac, scope) {
	const bytes = mac
		.toLowerCase()
		.split(':')
		.map((b) => parseInt(b, 16))
	if (bytes.length !== 6 || bytes.some(Number.isNaN)) {
		throw new Error(`invalid MAC: ${mac}`)
	}
	const inverted = bytes.slice()
	inverted[0] ^= 0x02
	const eui64 = [
		inverted[0], inverted[1], inverted[2],
		0xff, 0xfe,
		inverted[3], inverted[4], inverted[5],
	]
	const grp = []
	for (let i = 0; i < 8; i += 2) {
		const v = (eui64[i] << 8) | eui64[i + 1]
		grp.push(v.toString(16))
	}
	const base = `fe80::${grp[0]}:${grp[1]}:${grp[2]}:${grp[3]}`
	return scope ? `${base}%${scope}` : base
}

// entity_model_id format observed in the wild (16 hex chars / 8 bytes):
//
//   001cabb80400 XR
//   ────────────  ──
//   prefix         model byte (high nibble = selector, low nibble = revision)
//
//   X (selector):  3 = Galaxy 408
//                  4 = Galaxy 816
//                  5 = Galaxy 816-AES
//                  8 = Galaxy Bluehorn
//   R (revision):  'a' on real hardware, '0' on virtual / development
//                  instances — ignored here for naming.
const MODEL_ID_PATTERN = /^001cabb80400([3458])0[0-9a-f]{2}$/
const MODEL_BY_SELECTOR = {
	'3': 'Galaxy 408',
	'4': 'Galaxy 816',
	'5': 'Galaxy 816-AES',
	'8': 'Galaxy Bluehorn',
}

function modelNameFromEntityModelId(idHex) {
	const id = (idHex || '').toLowerCase()
	const m = id.match(MODEL_ID_PATTERN)
	if (m) return MODEL_BY_SELECTOR[m[1]]
	if (id.startsWith('001cab')) return `Galaxy (model ${id.slice(6)})`
	return idHex || 'Galaxy (unknown model)'
}

module.exports = { macToIPv6LinkLocal, modelNameFromEntityModelId }
