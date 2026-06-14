// actions-helpers.js
// Helper functions used by action implementations

/**
 * Safely parse and validate channel selections from action options
 * @param {Object} options - Action options object
 * @param {string} key - Property key to extract channels from
 * @param {number} max - Maximum valid channel number
 * @returns {number[]} Array of valid channel numbers
 */
function safeGetChannels(options, key, max) {
	try {
		if (!options || !options[key]) return []

		const raw = Array.isArray(options[key]) ? options[key] : [options[key]]

		return raw.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n >= 1 && n <= max)
	} catch {
		// Defensive: malformed options yield no channels (no instance logger available here)
		return []
	}
}

/**
 * Calculate speed of sound in meters per second based on temperature
 * @param {number} tempC - Temperature in Celsius
 * @returns {number} Speed of sound in m/s
 */
function speedOfSound_mps(tempC) {
	const T = Number.isFinite(Number(tempC)) ? Number(tempC) : 20
	return 331.3 + 0.606 * T
}

/**
 * Build matrix input choices with live names
 * @param {Object} self - Module instance
 * @returns {Array} Choices array for matrix inputs (1-32)
 */
function buildMatrixInputChoices(self) {
	if (!self) return [{ id: '1', label: '1' }]
	const choices = []
	for (let i = 1; i <= 32; i++) {
		const nm = self?.inputName?.[i]
		const theLabel = nm && String(nm).trim() !== '' ? `${i} - ${nm}` : `${i}`
		choices.push({ id: String(i), label: theLabel })
	}
	return choices
}

/**
 * Build matrix output choices with live names
 * @param {Object} self - Module instance
 * @param {number} NUM_OUTPUTS - Number of output channels
 * @returns {Array} Choices array for matrix outputs
 */
function buildMatrixOutputChoices(self, NUM_OUTPUTS) {
	if (!self) return [{ id: '1', label: '1' }]
	const choices = []
	for (let o = 1; o <= NUM_OUTPUTS; o++) {
		const nm = self?.outputName?.[o]
		const label = nm && String(nm).trim() !== '' ? `${o} - ${nm}` : `${o}`
		choices.push({ id: String(o), label })
	}
	return choices
}

/**
 * Quote and escape a snapshot argument for the command protocol
 * @param {string} text - Text to quote
 * @returns {string} Quoted and escaped string
 */
function quoteSnapshotArg(text) {
	const safe = String(text ?? '')
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\r?\n/g, ' ')
	return `"${safe}"`
}

/**
 * Build a label string showing the current active snapshot info
 * @param {Object} self - Module instance
 * @returns {string} Formatted active snapshot label
 */
function buildActiveSnapshotLabel(self) {
	let raw = self?.snapshotValues?.snapshot_active_id
	if (raw == null && typeof self?.getVariableValue === 'function') {
		raw = self.getVariableValue('snapshot_active_id')
	}
	const idMatch = String(raw ?? '').match(/\d+/)
	const id = idMatch ? Number(idMatch[0]) : null
	if (!Number.isFinite(id)) return 'Active snapshot: Unknown'

	const name = String(self?.snapshotValues?.snapshot_active_name ?? '').trim()
	const comment = String(self?.snapshotValues?.snapshot_active_comment ?? '').trim()
	const pieces = [`ID ${id}`]
	if (name) pieces.push(`Name "${name}"`)
	if (comment) pieces.push(`Comment "${comment}"`)
	return `Active snapshot: ${pieces.join(' — ')}`
}

/**
 * Reusable "Global Link" checkbox for the top of an action's options. Lets a specific
 * button opt out of Link ID mirroring. Returns a fresh object each call so option defs
 * are not shared by reference between actions.
 * @returns {Object} A Companion checkbox input field definition
 */
function linkEnableOption(linkId) {
	const id = String(linkId ?? '').trim()
	return {
		type: 'checkbox',
		id: 'link_enable',
		label: id ? `Global Link (${id})` : 'Global Link',
		default: true,
		tooltip:
			'When on, this action is also sent to other Galaxy connections that share the same Link ID. Turn off to affect only this connection.',
	}
}

/**
 * Spread helper: include the Global Link checkbox only when this connection actually has a
 * Link ID configured, so it stays hidden when nothing is linked. The current Link ID is shown
 * in the label. configUpdated() re-runs updateActions(), so the checkbox (and its label)
 * appears/updates/disappears as soon as the Link ID is set, changed, or cleared.
 * Usage in an options array: `...linkEnableOptions(self),`
 * @param {Object} self - Module instance
 * @returns {Array} [] when no Link ID is set, otherwise [linkEnableOption(linkId)]
 */
function linkEnableOptions(self) {
	const linkId = String(self?.config?.link_id || '').trim()
	return linkId ? [linkEnableOption(linkId)] : []
}

/**
 * Translate the Link checkbox into _cmdSendLine options. Missing/true → mirror (link on);
 * false → noLink so this action is not mirrored to linked connections.
 * @param {Object} options - Action options object
 * @returns {{noLink: boolean}} Options to pass through to the send helpers / _cmdSendLine
 */
function linkOptsFrom(options) {
	return { noLink: options?.link_enable === false }
}

module.exports = {
	safeGetChannels,
	speedOfSound_mps,
	buildMatrixInputChoices,
	buildMatrixOutputChoices,
	quoteSnapshotArg,
	buildActiveSnapshotLabel,
	linkEnableOption,
	linkEnableOptions,
	linkOptsFrom,
}
