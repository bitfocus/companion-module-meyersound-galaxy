// actions/subwoofer-design.js
// Subwoofer design assist: End-fire, Array, Array End-Fire, and Gradient configurations

const { buildOutputChoices, nn } = require('../helpers')
const { safeGetChannels, speedOfSound_mps } = require('../actions-helpers')
const { FACTORY_RESET_COMMANDS } = require('../actions-data')

/**
 * Helper function to display subwoofer spacing preview
 * @param {Object} self - Module instance
 * @returns {string} Preview text
 */
function subassistPreview(self) {
	const d = self?._subassist || null
	if (!d || typeof d.spacing_m !== 'number') return '-- Run once to update preview --'
	const ft = d.spacing_m * 3.28084
	return `${ft.toFixed(2)} ft  (${d.spacing_m.toFixed(3)} m)`
}

/**
 * Helper function to display end-fire speed of sound preview
 * @param {Object} self - Module instance
 * @returns {string} Preview text
 */
function endfirePreview(self) {
	const d = self?._subassist || null
	if (!d || typeof d.c !== 'number' || typeof d.T !== 'number') return '-- Run once to update preview --'
	const c_mps = d.c
	const c_fps = c_mps * 3.28084
	const T_C = d.T
	const T_F = (T_C * 9) / 5 + 32
	return `c ≈ ${c_mps.toFixed(1)} m/s (${c_fps.toFixed(1)} ft/s) at ${T_C.toFixed(1)} °C (${T_F.toFixed(1)} °F)`
}

/**
 * Status line for the action: standby until run, then the applied summary or the reason it failed.
 * @param {Object} self - Module instance
 * @returns {string} Status text
 */
function statusPreview(self) {
	return self?._subassistStatus || 'Standby — press the button to apply.'
}

/**
 * Helper function to display arc speed of sound preview
 * @param {Object} self - Module instance
 * @returns {string} Preview text
 */
function arcPreview(self) {
	const d = self?._arcassist
	if (!d || typeof d.c !== 'number') return '-- Run once to update preview --'
	const c_mps = d.c
	const c_fps = c_mps * 3.28084
	const T_C = d.T
	const T_F = (T_C * 9) / 5 + 32
	return `c ≈ ${c_mps.toFixed(1)} m/s (${c_fps.toFixed(1)} ft/s) at ${T_C.toFixed(1)} °C (${T_F.toFixed(1)} °F)`
}

/**
 * Register subwoofer design actions
 * @param {Object} actions - Actions object to populate
 * @param {Object} self - Module instance
 * @param {number} NUM_INPUTS - Number of input channels
 * @param {number} NUM_OUTPUTS - Number of output channels
 */
function registerSubwooferDesignActions(actions, self, NUM_INPUTS, NUM_OUTPUTS) {
	// Get data structures from self.constructor (attached in main.js)
	const PRODUCT_INTEGRATION_DATA = self.constructor.PRODUCT_INTEGRATION_DATA || {}
	const STARTING_POINTS_SOURCE = self.constructor.STARTING_POINTS_SOURCE || {}

	const subwooferSpeakerChoices = PRODUCT_INTEGRATION_DATA.subwooferSpeakerChoices || [{ id: '', label: '-- None --' }]
	const endfireStartingPointOptionDefs = PRODUCT_INTEGRATION_DATA.endfireStartingPointOptionDefs || []
	const arrayStartingPointOptionDefs = PRODUCT_INTEGRATION_DATA.arrayStartingPointOptionDefs || []
	const arrayendfireStartingPointOptionDefs = PRODUCT_INTEGRATION_DATA.arrayendfireStartingPointOptionDefs || []
	const gradientStartingPointOptionDefs_Front = PRODUCT_INTEGRATION_DATA.gradientStartingPointOptionDefs_Front || []
	const gradientStartingPointOptionDefs_Reversed =
		PRODUCT_INTEGRATION_DATA.gradientStartingPointOptionDefs_Reversed || []

	/**
	 * Generate output link group choices with names
	 */
	const getOutputLinkGroupChoices = () => {
		const choices = [{ id: '0', label: 'None (Unassigned)' }]
		for (let group = 1; group <= 8; group++) {
			const name = self?.outputLinkGroupName?.[group]
			const label = name && name.trim() !== '' ? `Link Group ${group} (${name})` : `Link Group ${group}`
			choices.push({ id: String(group), label })
		}
		return choices
	}

	const productIntegrationSpeakers = PRODUCT_INTEGRATION_DATA.speakers || new Map()
	const productIntegrationStartingPoints = PRODUCT_INTEGRATION_DATA.startingPoints || new Map()
	const endfireSpeakerStartingPointOption = PRODUCT_INTEGRATION_DATA.endfireSpeakerStartingPointOption || new Map()
	const arraySpeakerStartingPointOption = PRODUCT_INTEGRATION_DATA.arraySpeakerStartingPointOption || new Map()
	const arrayendfireSpeakerStartingPointOption =
		PRODUCT_INTEGRATION_DATA.arrayendfireSpeakerStartingPointOption || new Map()
	const gradientSpeakerStartingPointOption_Front =
		PRODUCT_INTEGRATION_DATA.gradientSpeakerStartingPointOption_Front || new Map()
	const gradientSpeakerStartingPointOption_Reversed =
		PRODUCT_INTEGRATION_DATA.gradientSpeakerStartingPointOption_Reversed || new Map()

	const outputChoices = buildOutputChoices(self, NUM_OUTPUTS)
	const outputChoicesFriendly = outputChoices

	// Channel naming shared by every mode: with a prefix, name an output "<prefix> <suffix>";
	// with an empty prefix, revert to the device default "Output <ch>". Mirrors into local
	// state + the output_<ch>_name variable.
	const applyChannelName = (ch, prefix, suffix) => {
		const p = String(prefix || '').trim()
		const channelName = p ? (suffix ? `${p} ${suffix}` : p) : `Output ${ch}`
		self._cmdSendLine(`/device/output/${ch}/name='${channelName}'`)
		if (!self.outputName) self.outputName = {}
		self.outputName[ch] = channelName
		self.setVariableValues?.({ [`output_${ch}_name`]: channelName })
	}

	// Mono symmetric-pair label for output index i of a `total`-sub array: "1 & 6", "2 & 5", …
	// For an odd count the centre sub pairs with itself, so it's labelled with a single number.
	const monoPairLabel = (i, total) => {
		const a = i + 1
		const b = total - i
		return a === b ? `${a}` : `${a} & ${b}`
	}

	// Update the action's Status line (standby / applied summary / reason it failed) and re-render.
	const setStatus = (msg) => {
		self._subassistStatus = msg
		try {
			self.updateActions?.()
		} catch {}
	}

	// Validate that a set of contiguous output blocks fit the device and don't overlap.
	// blocks: [{ label, start, count }]. Returns a human-readable reason string, or null if OK.
	const validateOutputBlocks = (blocks) => {
		const used = new Map() // ch -> block label
		for (const b of blocks) {
			if (!b || b.count <= 0) continue
			const last = b.start + b.count - 1
			if (b.start < 1 || last > NUM_OUTPUTS) {
				return `${b.label} would use outputs ${b.start}–${last}, but the device only has ${NUM_OUTPUTS} outputs`
			}
			for (let ch = b.start; ch <= last; ch++) {
				if (used.has(ch)) return `output ${ch} would be set by both ${used.get(ch)} and ${b.label}`
				used.set(ch, b.label)
			}
		}
		return null
	}

	// Shared Output Link Group handling for every mode. Given the outputs an action just
	// configured and the selected link-group option:
	//   - a real group (1-8) → assign those outputs to it and enable (un-bypass) the group
	//   - "None" (0)          → unassign those outputs and disable (bypass) the group(s) they were in
	// Returns log lines describing what changed.
	const applyLinkGroup = (channels, linkGroupOpt) => {
		const linkGroup = String(linkGroupOpt || '0')
		const groupNum = Number(linkGroup)
		const lines = []
		if (!self.outputLinkGroupAssign) self.outputLinkGroupAssign = {}
		if (!self.outputLinkGroupBypass) self.outputLinkGroupBypass = {}

		if (groupNum >= 1 && groupNum <= 8) {
			for (const ch of channels) {
				self._cmdSendLine(`/device/output/${ch}/output_link_group='${linkGroup}'`)
				self.outputLinkGroupAssign[ch] = groupNum
			}
			self._cmdSendLine(`/device/output_link_group/${groupNum}/bypass='false'`)
			self.outputLinkGroupBypass[groupNum] = false
			lines.push(`Link Group ${groupNum}: Enabled`)
		} else {
			// "None": revert — unassign these outputs and disable the group(s) they belonged to
			const affected = new Set()
			for (const ch of channels) {
				const prev = Number(self.outputLinkGroupAssign[ch] || 0)
				if (prev >= 1 && prev <= 8) affected.add(prev)
				self._cmdSendLine(`/device/output/${ch}/output_link_group='0'`)
				self.outputLinkGroupAssign[ch] = 0
			}
			for (const g of affected) {
				self._cmdSendLine(`/device/output_link_group/${g}/bypass='true'`)
				self.outputLinkGroupBypass[g] = true
				lines.push(`Link Group ${g}: Disabled (outputs unassigned)`)
			}
		}

		if (typeof self.checkFeedbacks === 'function') {
			self.checkFeedbacks('output_link_group_bypassed')
			self.checkFeedbacks('output_link_group_assigned')
		}
		return lines
	}

	// Helper: does a starting-point title look like a front/rear facing preset?
	const isFrontFacingTitle = (title) => /front\s*facing/i.test(String(title || ''))
	const isRearFacingTitle = (title) => /rear\s*facing/i.test(String(title || ''))

	// Loudspeakers that ship a Front Facing preset but no Rear Facing one. In End-Fire
	// Gradient mode these need a user-supplied rear delay (polarity is reversed automatically).
	const noRearFacingSpeakers = []
	for (const [key, entries] of productIntegrationStartingPoints.entries()) {
		if (!Array.isArray(entries)) continue
		const hasFront = entries.some((e) => isFrontFacingTitle(e.title))
		const hasRear = entries.some((e) => isRearFacingTitle(e.title))
		if (hasFront && !hasRear) noRearFacingSpeakers.push(key)
	}

	// End-Fire Gradient builds each tap (a front-facing + reversed rear-facing gradient pair) from
	// just the first front output and first rear output, auto-filling the rest from the tap count.
	const EG_MAX_TAPS = 8

	// Speaker keys that have a Front Facing preset but no Rear Facing one, inlined as a JSON
	// literal so the isVisible functions below stay self-contained when Companion serializes them.
	const noRearFacingJson = JSON.stringify(noRearFacingSpeakers)
	const egNoRearVisible = new Function(
		'options',
		`return !!options && options.mode === 'endfire_gradient' && ${noRearFacingJson}.includes(options.eg_speaker)`,
	)
	const gradientNoRearVisible = new Function(
		'options',
		`return !!options && options.mode === 'gradient' && ${noRearFacingJson}.includes(options.gradient_speaker)`,
	)
	const agNoRearVisible = new Function(
		'options',
		`return !!options && options.mode === 'array_gradient' && ${noRearFacingJson}.includes(options.ag_speaker)`,
	)

	// Speaker keys with no Front Facing preset (End-Fire auto-applies front-facing processing).
	const noFrontFacingSpeakers = []
	for (const [key, entries] of productIntegrationStartingPoints.entries()) {
		if (!Array.isArray(entries)) continue
		if (!entries.some((e) => isFrontFacingTitle(e.title))) noFrontFacingSpeakers.push(key)
	}
	const noFrontFacingJson = JSON.stringify(noFrontFacingSpeakers)
	const endfireNoFrontVisible = new Function(
		'options',
		`return !!options && options.mode === 'endfire' && ${noFrontFacingJson}.includes(options.endfire_speaker)`,
	)

	// Phase Curve (PC63 / PC100 / PC125) option defs, grouped by the set of phases a loudspeaker
	// offers so speakers with identical choices share one dropdown. The selected phase resolves to
	// the delay_integration type id applied to that speaker's outputs. Built per mode because the
	// isVisible (mode + speaker option id) must be self-contained for Companion's serialization.
	const buildPhaseDefs = (modeStr, speakerOptId, idPrefix) => {
		const groups = new Map() // comboKey -> { choices, defaultId, speakers[] }
		for (const speaker of productIntegrationSpeakers.values()) {
			if (speaker.key === 'OFF' || !Array.isArray(speaker.phases) || speaker.phases.length === 0) continue
			const comboKey = speaker.phases
				.map((p) => p.id)
				.sort((a, b) => a.localeCompare(b))
				.join('|')
			let group = groups.get(comboKey)
			if (!group) {
				group = {
					choices: speaker.phases.map((p) => ({ id: p.id, label: p.label })),
					defaultId: speaker.phases[0].id,
					speakers: [],
				}
				groups.set(comboKey, group)
			}
			group.speakers.push(speaker.key)
		}
		const defs = []
		const speakerPhaseOption = new Map() // speaker.key -> option id
		let n = 0
		for (const group of groups.values()) {
			const optionId = `${idPrefix}${++n}`
			const allowedJson = JSON.stringify(group.speakers)
			const isVisible = new Function(
				'options',
				`return !!options && options.mode === '${modeStr}' && ${allowedJson}.includes(options.${speakerOptId})`,
			)
			defs.push({
				type: 'dropdown',
				id: optionId,
				label: 'Phase Curve',
				default: group.defaultId,
				choices: group.choices,
				isVisible,
			})
			for (const sp of group.speakers) speakerPhaseOption.set(sp, optionId)
		}
		return { defs, speakerPhaseOption }
	}
	const { defs: egPhaseOptionDefs, speakerPhaseOption: egSpeakerPhaseOption } = buildPhaseDefs(
		'endfire_gradient',
		'eg_speaker',
		'eg_phase_',
	)
	const { defs: endfirePhaseOptionDefs, speakerPhaseOption: endfireSpeakerPhaseOption } = buildPhaseDefs(
		'endfire',
		'endfire_speaker',
		'endfire_phase_',
	)
	const { defs: gradientPhaseOptionDefs, speakerPhaseOption: gradientSpeakerPhaseOption } = buildPhaseDefs(
		'gradient',
		'gradient_speaker',
		'gradient_phase_',
	)
	const { defs: arrayPhaseOptionDefs, speakerPhaseOption: arraySpeakerPhaseOption } = buildPhaseDefs(
		'array',
		'array_speaker',
		'array_phase_',
	)
	const { defs: arrayendfirePhaseOptionDefs, speakerPhaseOption: arrayendfireSpeakerPhaseOption } = buildPhaseDefs(
		'array_endfire',
		'arrayendfire_speaker',
		'arrayendfire_phase_',
	)
	const { defs: agPhaseOptionDefs, speakerPhaseOption: agSpeakerPhaseOption } = buildPhaseDefs(
		'array_gradient',
		'ag_speaker',
		'ag_phase_',
	)

	actions['subassist_combined'] = {
		name: 'Sub Design Assist',
		options: [
			{
				type: 'static-text',
				id: 'status',
				label: 'Status',
				value: statusPreview(self),
			},
			{
				type: 'dropdown',
				id: 'mode',
				label: 'Mode',
				default: 'endfire',
				choices: [
					{ id: 'array', label: 'Array' },
					{ id: 'array_endfire', label: 'Array End-Fire' },
					{ id: 'array_gradient', label: 'Array Gradient' },
					{ id: 'endfire', label: 'End-Fire' },
					{ id: 'endfire_gradient', label: 'End-Fire Gradient' },
					{ id: 'gradient', label: 'Gradient' },
				],
			},

			// ===== END-FIRE OPTIONS =====
			{
				type: 'dropdown',
				id: 'endfire_speaker',
				label: 'Loudspeaker',
				default: '',
				choices: subwooferSpeakerChoices,
				isVisible: (o) => o.mode === 'endfire',
			},
			...endfirePhaseOptionDefs,
			{
				type: 'static-text',
				id: 'endfire_no_front_warning',
				label: 'No factory Front Facing preset',
				value:
					'This loudspeaker has no factory front-facing settings. Enter a base delay below — it is added on top of every end-fire tap.',
				isVisible: endfireNoFrontVisible,
			},
			{
				type: 'number',
				id: 'endfire_manual_delay_ms',
				label: 'Base delay (ms)',
				default: 0,
				min: 0,
				max: 100,
				step: 0.01,
				isVisible: endfireNoFrontVisible,
			},
			{
				type: 'static-text',
				id: 'speed_preview',
				label: 'Speed of sound',
				value: endfirePreview(self),
				isVisible: (o) => o.mode === 'endfire',
			},
			{
				type: 'static-text',
				id: 'preview',
				label: 'Recommended spacing',
				value: subassistPreview(self),
				isVisible: (o) => o.mode === 'endfire',
			},
			{
				type: 'number',
				id: 'freq',
				label: 'Target frequency (Hz)',
				default: 80,
				min: 10,
				max: 200,
				step: 1,
				isVisible: (o) => o.mode === 'endfire',
			},
			{
				type: 'number',
				id: 'temp_endfire',
				label: 'Air temperature',
				default: 20,
				min: -40,
				max: 140,
				step: 0.1,
				isVisible: (o) => o.mode === 'endfire',
			},
			{
				type: 'dropdown',
				id: 'tempUnit_endfire',
				label: 'Temperature unit',
				default: 'C',
				choices: [
					{ id: 'C', label: '°C' },
					{ id: 'F', label: '°F' },
				],
				isVisible: (o) => o.mode === 'endfire',
			},
			{
				type: 'dropdown',
				id: 'depth',
				label: 'Depth (number of taps)',
				default: '2',
				choices: [
					{ id: '2', label: '2 (T0..T1)' },
					{ id: '3', label: '3 (T0..T2)' },
					{ id: '4', label: '4 (T0..T3)' },
					{ id: '5', label: '5 (T0..T4)' },
					{ id: '6', label: '6 (T0..T5)' },
					{ id: '7', label: '7 (T0..T6)' },
					{ id: '8', label: '8 (T0..T7)' },
				],
				isVisible: (o) => o.mode === 'endfire',
			},
			{
				type: 'dropdown',
				id: 'endfire_first_output',
				label: 'First output',
				default: '1',
				choices: outputChoicesFriendly,
				isVisible: (o) => o.mode === 'endfire',
			},
			{
				type: 'textinput',
				id: 'endfire_channel_prefix',
				label: 'Channel name prefix (optional)',
				default: '',
				tooltip: 'When set, names each output "<prefix> T#" (e.g. "Sub T0", "Sub T1")',
				isVisible: (o) => o.mode === 'endfire',
			},
			{
				type: 'dropdown',
				id: 'endfire_link_group',
				label: 'Assign to Output Link Group',
				default: '0',
				choices: getOutputLinkGroupChoices(),
				isVisible: (o) => o.mode === 'endfire',
			},
			{
				type: 'checkbox',
				id: 'reset_endfire',
				label: 'Reset channels to factory defaults before applying',
				default: false,
				isVisible: (o) => o.mode === 'endfire',
			},

			// ===== ARRAY OPTIONS =====
			{
				type: 'dropdown',
				id: 'array_speaker',
				label: 'Loudspeaker',
				default: '',
				choices: subwooferSpeakerChoices,
				isVisible: (o) => o.mode === 'array',
			},
			...arrayPhaseOptionDefs,
			{
				type: 'static-text',
				id: 'arc_preview',
				label: 'Speed of sound',
				value: arcPreview(self),
				isVisible: (o) => o.mode === 'array',
			},
			{
				type: 'number',
				id: 'numSubs',
				label: 'Number of subs',
				default: 6,
				min: 1,
				max: 2 * NUM_OUTPUTS,
				tooltip: `Up to ${2 * NUM_OUTPUTS} in Mono (uses half the outputs); Stereo is limited to ${NUM_OUTPUTS} outputs.`,
				isVisible: (o) => o.mode === 'array',
			},
			{
				type: 'dropdown',
				id: 'array_output_mode',
				label: 'Output',
				default: 'stereo',
				choices: [
					{ id: 'stereo', label: 'Stereo (full array)' },
					{ id: 'mono', label: 'Mono (first half only)' },
				],
				tooltip:
					'Stereo writes every sub. Mono writes only the first half (the array is mirror-symmetric, ' +
					'so e.g. 12 subs → outputs 1–6 with the same delays) for a single-sided deployment.',
				isVisible: (o) => o.mode === 'array',
			},
			{
				type: 'checkbox',
				id: 'array_flip_layout',
				label: 'Flip delay order',
				default: false,
				tooltip:
					'Inverts the arc so the starting/edge channels get 0 ms and the center gets the max delay ' +
					'(in-to-out instead of out-to-in). In Mono this puts 0 ms at the starting channel.',
				isVisible: (o) => o.mode === 'array',
			},
			{
				type: 'dropdown',
				id: 'startCh',
				label: 'Starting output channel',
				default: '',
				choices: outputChoicesFriendly,
				isVisible: (o) => o.mode === 'array',
			},
			{
				type: 'dropdown',
				id: 'units',
				label: 'Units',
				default: 'm',
				choices: [
					{ id: 'm', label: 'Meters' },
					{ id: 'ft', label: 'Feet' },
				],
				isVisible: (o) => o.mode === 'array',
			},
			{
				type: 'number',
				id: 'spacing',
				label: 'Sub spacing',
				default: 1.0,
				step: 0.01,
				isVisible: (o) => o.mode === 'array',
			},
			{
				type: 'number',
				id: 'radius',
				label: 'Arc angle (degrees)',
				default: 60,
				min: 0,
				max: 180,
				step: 1,
				isVisible: (o) => o.mode === 'array',
			},
			{
				type: 'number',
				id: 'temp_array',
				label: 'Air temperature',
				default: 20.0,
				step: 0.1,
				min: -40,
				max: 140,
				isVisible: (o) => o.mode === 'array',
			},
			{
				type: 'dropdown',
				id: 'tempUnit_array',
				label: 'Temperature unit',
				default: 'C',
				choices: [
					{ id: 'C', label: '°C' },
					{ id: 'F', label: '°F' },
				],
				isVisible: (o) => o.mode === 'array',
			},
			{
				type: 'textinput',
				id: 'array_channel_prefix',
				label: 'Channel name prefix (optional)',
				default: '',
				tooltip: 'When set, names each output "<prefix> #" (e.g. "Sub 1", "Sub 2")',
				isVisible: (o) => o.mode === 'array',
			},
			{
				type: 'dropdown',
				id: 'array_link_group',
				label: 'Assign to Output Link Group',
				default: '0',
				choices: getOutputLinkGroupChoices(),
				isVisible: (o) => o.mode === 'array',
			},
			{
				type: 'checkbox',
				id: 'reset_array',
				label: 'Reset channels to factory defaults before applying',
				default: false,
				isVisible: (o) => o.mode === 'array',
			},

			// ===== ARRAY END-FIRE OPTIONS =====
			{
				type: 'dropdown',
				id: 'arrayendfire_speaker',
				label: 'Loudspeaker',
				default: '',
				choices: subwooferSpeakerChoices,
				isVisible: (o) => o.mode === 'array_endfire',
			},
			...arrayendfirePhaseOptionDefs,
			{
				type: 'static-text',
				id: 'arrayendfire_speed_preview',
				label: 'Speed of sound',
				value: arcPreview(self),
				isVisible: (o) => o.mode === 'array_endfire',
			},
			{
				type: 'static-text',
				id: 'arrayendfire_spacing_preview',
				label: 'Recommended tap spacing (from end-fire freq + temp)',
				value: subassistPreview(self),
				isVisible: (o) => o.mode === 'array_endfire',
			},
			{
				type: 'number',
				id: 'freq_arrayendfire',
				label: 'End-Fire frequency (Hz)',
				default: 80,
				min: 20,
				max: 200,
				step: 0.1,
				isVisible: (o) => o.mode === 'array_endfire',
			},
			{
				type: 'number',
				id: 'depth_arrayendfire',
				label: 'End-Fire depth (rows: 2-8)',
				default: 2,
				min: 2,
				max: 8,
				step: 1,
				isVisible: (o) => o.mode === 'array_endfire',
			},
			{
				type: 'number',
				id: 'numSubs_arrayendfire',
				label: 'Number of subs per row',
				default: 6,
				min: 1,
				max: 2 * NUM_OUTPUTS,
				tooltip: `Up to ${2 * NUM_OUTPUTS} per row in Mono (uses half the outputs); outputs are limited to ${NUM_OUTPUTS}.`,
				isVisible: (o) => o.mode === 'array_endfire',
			},
			{
				type: 'dropdown',
				id: 'arrayendfire_output_mode',
				label: 'Output',
				default: 'stereo',
				choices: [
					{ id: 'stereo', label: 'Stereo (full row)' },
					{ id: 'mono', label: 'Mono (first half of each row)' },
				],
				tooltip:
					'Stereo writes every sub in each row. Mono writes only the first half of each row (rows are ' +
					'mirror-symmetric, so e.g. 6 subs/row → first 3) for a single-sided deployment.',
				isVisible: (o) => o.mode === 'array_endfire',
			},
			{
				type: 'checkbox',
				id: 'arrayendfire_flip_layout',
				label: 'Flip delay order',
				default: false,
				tooltip:
					'Inverts each row’s arc so the edge/start subs get 0 ms and the center gets the max arc ' +
					'delay (in-to-out instead of out-to-in). In Mono this puts 0 ms at the start of each row.',
				isVisible: (o) => o.mode === 'array_endfire',
			},
			{
				type: 'number',
				id: 'startCh_front_arrayendfire',
				label: 'First output (front row)',
				default: 1,
				min: 1,
				max: NUM_OUTPUTS,
				isVisible: (o) => o.mode === 'array_endfire',
			},
			{
				type: 'number',
				id: 'startCh_second_arrayendfire',
				label: 'First output (second row)',
				default: 7,
				min: 1,
				max: NUM_OUTPUTS,
				isVisible: (o) => o.mode === 'array_endfire' && Number(o.depth_arrayendfire) >= 2,
			},
			{
				type: 'number',
				id: 'startCh_third_arrayendfire',
				label: 'First output (third row)',
				default: 13,
				min: 1,
				max: NUM_OUTPUTS,
				isVisible: (o) => o.mode === 'array_endfire' && Number(o.depth_arrayendfire) >= 3,
			},
			{
				type: 'number',
				id: 'startCh_fourth_arrayendfire',
				label: 'First output (fourth row)',
				default: 19,
				min: 1,
				max: NUM_OUTPUTS,
				isVisible: (o) => o.mode === 'array_endfire' && Number(o.depth_arrayendfire) >= 4,
			},
			{
				type: 'number',
				id: 'startCh_fifth_arrayendfire',
				label: 'First output (fifth row)',
				default: 25,
				min: 1,
				max: NUM_OUTPUTS,
				isVisible: (o) => o.mode === 'array_endfire' && Number(o.depth_arrayendfire) >= 5,
			},
			{
				type: 'number',
				id: 'startCh_sixth_arrayendfire',
				label: 'First output (sixth row)',
				default: 31,
				min: 1,
				max: NUM_OUTPUTS,
				isVisible: (o) => o.mode === 'array_endfire' && Number(o.depth_arrayendfire) >= 6,
			},
			{
				type: 'number',
				id: 'startCh_seventh_arrayendfire',
				label: 'First output (seventh row)',
				default: 37,
				min: 1,
				max: NUM_OUTPUTS,
				isVisible: (o) => o.mode === 'array_endfire' && Number(o.depth_arrayendfire) >= 7,
			},
			{
				type: 'number',
				id: 'startCh_eighth_arrayendfire',
				label: 'First output (eighth row)',
				default: 43,
				min: 1,
				max: NUM_OUTPUTS,
				isVisible: (o) => o.mode === 'array_endfire' && Number(o.depth_arrayendfire) >= 8,
			},
			{
				type: 'dropdown',
				id: 'units_arrayendfire',
				label: 'Units',
				default: 'm',
				choices: [
					{ id: 'm', label: 'Meters' },
					{ id: 'ft', label: 'Feet' },
				],
				isVisible: (o) => o.mode === 'array_endfire',
			},
			{
				type: 'number',
				id: 'spacing_arrayendfire',
				label: 'Sub spacing',
				default: 1.0,
				step: 0.01,
				isVisible: (o) => o.mode === 'array_endfire',
			},
			{
				type: 'number',
				id: 'radius_arrayendfire',
				label: 'Arc angle (degrees)',
				default: 60,
				min: 0,
				max: 180,
				step: 1,
				isVisible: (o) => o.mode === 'array_endfire',
			},
			{
				type: 'number',
				id: 'temp_arrayendfire',
				label: 'Air temperature',
				default: 20.0,
				step: 0.1,
				min: -40,
				max: 140,
				isVisible: (o) => o.mode === 'array_endfire',
			},
			{
				type: 'dropdown',
				id: 'tempUnit_arrayendfire',
				label: 'Temperature unit',
				default: 'C',
				choices: [
					{ id: 'C', label: '°C' },
					{ id: 'F', label: '°F' },
				],
				isVisible: (o) => o.mode === 'array_endfire',
			},
			{
				type: 'textinput',
				id: 'arrayendfire_channel_prefix',
				label: 'Channel name prefix (optional)',
				default: '',
				tooltip: 'When set, names each output "<prefix> <Row> #" (e.g. "Sub Front 1")',
				isVisible: (o) => o.mode === 'array_endfire',
			},
			{
				type: 'dropdown',
				id: 'arrayendfire_link_group',
				label: 'Assign to Output Link Group',
				default: '0',
				choices: getOutputLinkGroupChoices(),
				isVisible: (o) => o.mode === 'array_endfire',
			},
			{
				type: 'checkbox',
				id: 'reset_arrayendfire',
				label: 'Reset channels to factory defaults before applying',
				default: false,
				isVisible: (o) => o.mode === 'array_endfire',
			},

			// ===== GRADIENT OPTIONS =====
			{
				type: 'dropdown',
				id: 'gradient_speaker',
				label: 'Loudspeaker',
				default: '',
				choices: subwooferSpeakerChoices,
				isVisible: (o) => o.mode === 'gradient',
			},
			...gradientPhaseOptionDefs,
			{
				type: 'static-text',
				id: 'gradient_no_rear_warning',
				label: 'No factory Rear Facing preset',
				value:
					'This loudspeaker has no factory rear-facing settings. Enter a rear delay below — it is applied to the reversed outputs and polarity is reversed automatically.',
				isVisible: gradientNoRearVisible,
			},
			{
				type: 'number',
				id: 'gradient_manual_rear_delay_ms',
				label: 'Rear delay (ms)',
				default: 0,
				min: 0,
				max: 100,
				step: 0.01,
				isVisible: gradientNoRearVisible,
			},
			{
				type: 'multidropdown',
				id: 'gradient_outputs_front',
				label: 'Output Front',
				default: [],
				choices: outputChoicesFriendly,
				minSelection: 0,
				isVisible: (o) => o.mode === 'gradient',
			},
			{
				type: 'multidropdown',
				id: 'gradient_outputs_reversed',
				label: 'Output Reversed',
				default: [],
				choices: outputChoicesFriendly,
				minSelection: 0,
				isVisible: (o) => o.mode === 'gradient',
			},
			{
				type: 'textinput',
				id: 'gradient_channel_prefix',
				label: 'Channel name prefix (optional)',
				default: '',
				tooltip: 'When set, names each output "<prefix> Front" / "<prefix> Reversed"',
				isVisible: (o) => o.mode === 'gradient',
			},
			{
				type: 'dropdown',
				id: 'gradient_link_group',
				label: 'Assign to Output Link Group',
				default: '0',
				choices: getOutputLinkGroupChoices(),
				isVisible: (o) => o.mode === 'gradient',
			},
			{
				type: 'checkbox',
				id: 'reset_gradient',
				label: 'Reset channels to factory defaults before applying',
				default: false,
				isVisible: (o) => o.mode === 'gradient',
			},

			// ===== END-FIRE GRADIENT OPTIONS =====
			{
				type: 'dropdown',
				id: 'eg_speaker',
				label: 'Loudspeaker',
				default: '',
				choices: subwooferSpeakerChoices,
				isVisible: (o) => o.mode === 'endfire_gradient',
			},
			...egPhaseOptionDefs,
			{
				type: 'static-text',
				id: 'eg_no_rear_warning',
				label: 'No factory Rear Facing preset',
				value:
					'This loudspeaker has no factory rear-facing settings. Enter a rear delay below — polarity is reversed automatically on the negative outputs.',
				isVisible: egNoRearVisible,
			},
			{
				type: 'number',
				id: 'eg_manual_rear_delay_ms',
				label: 'Rear delay (ms)',
				default: 0,
				min: 0,
				max: 100,
				step: 0.01,
				isVisible: egNoRearVisible,
			},
			{
				type: 'static-text',
				id: 'eg_speed_preview',
				label: 'Speed of sound',
				value: endfirePreview(self),
				isVisible: (o) => o.mode === 'endfire_gradient',
			},
			{
				type: 'static-text',
				id: 'eg_spacing_preview',
				label: 'Recommended tap spacing (from target freq + temp)',
				value: subassistPreview(self),
				isVisible: (o) => o.mode === 'endfire_gradient',
			},
			{
				type: 'number',
				id: 'freq_eg',
				label: 'Target frequency (Hz)',
				default: 80,
				min: 10,
				max: 200,
				step: 1,
				isVisible: (o) => o.mode === 'endfire_gradient',
			},
			{
				type: 'number',
				id: 'temp_eg',
				label: 'Air temperature',
				default: 20,
				min: -40,
				max: 140,
				step: 0.1,
				isVisible: (o) => o.mode === 'endfire_gradient',
			},
			{
				type: 'dropdown',
				id: 'tempUnit_eg',
				label: 'Temperature unit',
				default: 'C',
				choices: [
					{ id: 'C', label: '°C' },
					{ id: 'F', label: '°F' },
				],
				isVisible: (o) => o.mode === 'endfire_gradient',
			},
			{
				type: 'dropdown',
				id: 'eg_depth',
				label: 'Depth (number of end-fire taps)',
				default: '2',
				choices: [
					{ id: '2', label: '2 (T0..T1)' },
					{ id: '3', label: '3 (T0..T2)' },
					{ id: '4', label: '4 (T0..T3)' },
					{ id: '5', label: '5 (T0..T4)' },
					{ id: '6', label: '6 (T0..T5)' },
					{ id: '7', label: '7 (T0..T6)' },
					{ id: '8', label: '8 (T0..T7)' },
				],
				isVisible: (o) => o.mode === 'endfire_gradient',
			},
			{
				type: 'dropdown',
				id: 'eg_first_front',
				label: 'First front-facing output',
				default: '1',
				choices: outputChoicesFriendly,
				isVisible: (o) => o.mode === 'endfire_gradient',
			},
			{
				type: 'dropdown',
				id: 'eg_first_rear',
				label: 'First rear-facing output',
				default: '2',
				choices: outputChoicesFriendly,
				isVisible: (o) => o.mode === 'endfire_gradient',
			},
			{
				type: 'textinput',
				id: 'eg_channel_prefix',
				label: 'Channel name prefix (optional)',
				default: '',
				tooltip: 'When set, names each output "<prefix> T# Front" / "<prefix> T# Rear" (e.g. "Sub Floor T0 Front")',
				isVisible: (o) => o.mode === 'endfire_gradient',
			},
			{
				type: 'dropdown',
				id: 'eg_link_group',
				label: 'Assign to Output Link Group',
				default: '0',
				choices: getOutputLinkGroupChoices(),
				isVisible: (o) => o.mode === 'endfire_gradient',
			},
			{
				type: 'checkbox',
				id: 'reset_eg',
				label: 'Reset channels to factory defaults before applying',
				default: false,
				isVisible: (o) => o.mode === 'endfire_gradient',
			},

			// ===== ARRAY GRADIENT OPTIONS =====
			{
				type: 'dropdown',
				id: 'ag_speaker',
				label: 'Loudspeaker',
				default: '',
				choices: subwooferSpeakerChoices,
				isVisible: (o) => o.mode === 'array_gradient',
			},
			...agPhaseOptionDefs,
			{
				type: 'static-text',
				id: 'ag_no_rear_warning',
				label: 'No factory Rear Facing preset',
				value:
					'This loudspeaker has no factory rear-facing settings. Enter a rear delay below — it is added to the rear outputs and polarity is reversed automatically.',
				isVisible: agNoRearVisible,
			},
			{
				type: 'number',
				id: 'ag_manual_rear_delay_ms',
				label: 'Rear delay (ms)',
				default: 0,
				min: 0,
				max: 100,
				step: 0.01,
				isVisible: agNoRearVisible,
			},
			{
				type: 'static-text',
				id: 'ag_speed_preview',
				label: 'Speed of sound',
				value: arcPreview(self),
				isVisible: (o) => o.mode === 'array_gradient',
			},
			{
				type: 'number',
				id: 'ag_numSubs',
				label: 'Number of subs (per side)',
				default: 6,
				min: 1,
				max: NUM_OUTPUTS,
				isVisible: (o) => o.mode === 'array_gradient',
			},
			{
				type: 'dropdown',
				id: 'ag_output_mode',
				label: 'Output',
				default: 'stereo',
				choices: [
					{ id: 'stereo', label: 'Stereo (full array)' },
					{ id: 'mono', label: 'Mono (first half only)' },
				],
				tooltip:
					'Stereo writes every sub. Mono writes only the first half of the front and rear blocks ' +
					'(the array is mirror-symmetric) for a single-sided deployment.',
				isVisible: (o) => o.mode === 'array_gradient',
			},
			{
				type: 'checkbox',
				id: 'ag_flip_layout',
				label: 'Flip delay order',
				default: false,
				tooltip:
					'Inverts the arc so the starting/edge channels get 0 ms and the center gets the max arc ' +
					'delay (in-to-out instead of out-to-in). In Mono this puts 0 ms at the starting channel.',
				isVisible: (o) => o.mode === 'array_gradient',
			},
			{
				type: 'dropdown',
				id: 'ag_startCh_front',
				label: 'First front output',
				default: '1',
				choices: outputChoicesFriendly,
				isVisible: (o) => o.mode === 'array_gradient',
			},
			{
				type: 'dropdown',
				id: 'ag_startCh_rear',
				label: 'First rear output',
				default: '7',
				choices: outputChoicesFriendly,
				isVisible: (o) => o.mode === 'array_gradient',
			},
			{
				type: 'dropdown',
				id: 'ag_units',
				label: 'Units',
				default: 'm',
				choices: [
					{ id: 'm', label: 'Meters' },
					{ id: 'ft', label: 'Feet' },
				],
				isVisible: (o) => o.mode === 'array_gradient',
			},
			{
				type: 'number',
				id: 'ag_spacing',
				label: 'Sub spacing',
				default: 1.0,
				step: 0.01,
				isVisible: (o) => o.mode === 'array_gradient',
			},
			{
				type: 'number',
				id: 'ag_radius',
				label: 'Arc angle (degrees)',
				default: 60,
				min: 0,
				max: 180,
				step: 1,
				isVisible: (o) => o.mode === 'array_gradient',
			},
			{
				type: 'number',
				id: 'ag_temp',
				label: 'Air temperature',
				default: 20.0,
				step: 0.1,
				min: -40,
				max: 140,
				isVisible: (o) => o.mode === 'array_gradient',
			},
			{
				type: 'dropdown',
				id: 'ag_tempUnit',
				label: 'Temperature unit',
				default: 'C',
				choices: [
					{ id: 'C', label: '°C' },
					{ id: 'F', label: '°F' },
				],
				isVisible: (o) => o.mode === 'array_gradient',
			},
			{
				type: 'textinput',
				id: 'ag_channel_prefix',
				label: 'Channel name prefix (optional)',
				default: '',
				tooltip: 'When set, names each output "<prefix> Front #" / "<prefix> Rear #"',
				isVisible: (o) => o.mode === 'array_gradient',
			},
			{
				type: 'dropdown',
				id: 'ag_link_group',
				label: 'Assign to Output Link Group',
				default: '0',
				choices: getOutputLinkGroupChoices(),
				isVisible: (o) => o.mode === 'array_gradient',
			},
			{
				type: 'checkbox',
				id: 'reset_ag',
				label: 'Reset channels to factory defaults before applying',
				default: false,
				isVisible: (o) => o.mode === 'array_gradient',
			},
		],
		callback: async (e) => {
			const mode = e.options.mode

			if (mode === 'endfire') {
				// Execute End-Fire logic
				const f = Math.max(1e-6, Number(e.options.freq) || 80)
				const unitIn = e.options.tempUnit_endfire === 'F' ? 'F' : 'C'
				let T = Number.isFinite(Number(e.options.temp_endfire)) ? Number(e.options.temp_endfire) : 20
				if (unitIn === 'F') T = ((T - 32) * 5) / 9
				const c = speedOfSound_mps(T)

				const depth = Math.min(8, Math.max(2, Number(e.options.depth) || 2))

				const spacing_m = c / (4 * f)
				self._subassist = { spacing_m, T, c }
				self.setVariableValues?.({
					subassist_spacing_ft: (spacing_m * 3.28084).toFixed(2),
					subassist_spacing_m: spacing_m.toFixed(3),
				})

				const roundTo01 = (val) => Math.round(val / 0.01) * 0.01
				const perTapMs = roundTo01(1000 / (4 * f))
				const perTapSamples = Math.round(perTapMs * 96)

				const firstOutput = Math.max(1, Math.min(NUM_OUTPUTS, Math.round(Number(e.options.endfire_first_output) || 1)))

				// Resolve product integration: delay-integration type from the selected Phase Curve,
				// and the auto-detected Front Facing starting point. Loudspeakers without a front
				// preset fall back to a user-typed base delay added on top of every tap.
				const speakerKey = String(e.options?.endfire_speaker || '')
				let typeId = null
				let frontControlPoints = []
				let baseSamples = 0
				let frontLabel = ''

				if (speakerKey && speakerKey !== 'OFF' && speakerKey !== '') {
					const speakerEntry = productIntegrationSpeakers.get(speakerKey)
					if (speakerEntry?.phases?.length > 0) {
						const phaseOptionId = endfireSpeakerPhaseOption.get(speakerKey)
						const selectedPhaseId = phaseOptionId ? String(e.options?.[phaseOptionId] || '').trim() : ''
						const phase = speakerEntry.phases.find((p) => p.id === selectedPhaseId) || speakerEntry.phases[0]
						typeId = phase?.typeId ?? null
					}

					const spEntries = productIntegrationStartingPoints.get(speakerKey) || []
					const frontEntry = spEntries.find((sp) => isFrontFacingTitle(sp.title))
					if (frontEntry) {
						// Front Facing carries no cabinet delay — keep its filters, drop any delay line
						frontControlPoints = (frontEntry.controlPoints || []).filter((cp) => !/\/delay=/.test(String(cp)))
						frontLabel = frontEntry.title
					} else {
						const manualMs = Math.max(0, Number(e.options.endfire_manual_delay_ms) || 0)
						baseSamples = Math.round(manualMs * 96)
						frontLabel = `manual base delay ${manualMs.toFixed(2)} ms`
						self.log?.(
							'warn',
							`Loudspeaker ${speakerKey} has no factory Front Facing preset — using manual base delay ${manualMs.toFixed(2)} ms.`,
						)
					}
				}

				// Check if factory reset is enabled
				const shouldReset = e.options.reset_endfire === true
				const channelPrefix = String(e.options?.endfire_channel_prefix || '').trim()
				const configuredChannels = []

				// Reject impossible configurations before touching the device
				const efBlockErr = validateOutputBlocks([{ label: `${depth} taps`, start: firstOutput, count: depth }])
				if (efBlockErr) {
					const msg = `Not applied — ${efBlockErr}. Reduce the tap count or pick an earlier first output.`
					self.log?.('warn', msg)
					setStatus(`⚠️ ${msg}`)
					return
				}

				const lines = []
				// One output per tap, auto-filled from the first output: T0 = first, T1 = first+1, …
				for (let t = 0; t < depth; t++) {
					const ch = firstOutput + t
					const targetSamples = baseSamples + t * perTapSamples
					const targetMs = targetSamples / 96

					if (shouldReset) {
						for (const resetCmd of FACTORY_RESET_COMMANDS) self._cmdSendLine(resetCmd.replace(/\{ch\}/g, ch))
					}
					if (typeId) {
						self._cmdSendLine(`/processing/output/${ch}/delay_integration/type=${typeId}`)
					}
					for (const cmd of frontControlPoints) {
						self._cmdSendLine(cmd.replace(/\{ch\}/g, ch).replace(/\{\}/g, ch))
					}
					self._cmdSendLine(`/processing/output/${ch}/delay=${targetSamples}`)
					self._applyOutputDelay(ch, targetSamples)
					applyChannelName(ch, channelPrefix, `T${t}`)
					configuredChannels.push(ch)

					const spLabel =
						speakerKey && speakerKey !== 'OFF' ? ` [${speakerKey}${frontLabel ? ': ' + frontLabel : ''}]` : ''
					lines.push(`End-Fire T${t}: ch ${ch} = ${targetMs.toFixed(2)} ms${spLabel}`)
				}

				// Assign/enable or (for "None") unassign/disable the Output Link Group
				lines.push(...applyLinkGroup(configuredChannels, e.options?.endfire_link_group))

				if (lines.length) {
					const c_fps = c * 3.28084
					const T_F = (T * 9) / 5 + 32
					self.log?.(
						'info',
						[
							`End-Fire: f=${f} Hz | T=${e.options.temp_endfire}°${unitIn} (~${T.toFixed(1)}°C, c~${c.toFixed(1)} m/s ~ ${c_fps.toFixed(1)} ft/s) | perTap~${perTapMs.toFixed(2)} ms`,
							...lines,
						].join(' | '),
					)
				}
				setStatus(
					`✅ Applied — End-Fire: ${configuredChannels.length} output(s), ${depth} taps from output ${firstOutput}.`,
				)

				try {
					self.updateActions?.()
				} catch {}
			} else if (mode === 'array') {
				// Execute Array logic
				try {
					const o = e.options
					const unitIn = o.tempUnit_array === 'F' ? 'F' : 'C'
					let T = Number.isFinite(Number(o.temp_array)) ? Number(o.temp_array) : 20
					if (unitIn === 'F') T = ((T - 32) * 5) / 9
					const c = speedOfSound_mps(T)

					self._arcassist = { T, c }
					try {
						self.updateActions?.()
					} catch {}

					if (o.startCh === '' || !Number.isFinite(Number(o.startCh))) {
						const c_fps = c * 3.28084
						const T_F = (T * 9) / 5 + 32
						self.log?.(
							'info',
							`Arc preview: c~${c.toFixed(1)} m/s (${c_fps.toFixed(1)} ft/s) at ${T.toFixed(1)} °C (${T_F.toFixed(1)} °F)`,
						)
						setStatus('Pick a starting output channel to apply.')
						return
					}

					// Product integration: delay-integration type from the selected Phase Curve, and the
					// Front Facing starting point applied automatically (all subs face the same way).
					const speakerKey = String(e.options?.array_speaker || '')
					let typeId = null
					let startingPointCommands = null
					let startingPointTitle = ''

					if (speakerKey && speakerKey !== 'OFF' && speakerKey !== '') {
						const speakerEntry = productIntegrationSpeakers.get(speakerKey)
						if (speakerEntry?.phases?.length > 0) {
							const phaseOptionId = arraySpeakerPhaseOption.get(speakerKey)
							const selectedPhaseId = phaseOptionId ? String(e.options?.[phaseOptionId] || '').trim() : ''
							const phase = speakerEntry.phases.find((p) => p.id === selectedPhaseId) || speakerEntry.phases[0]
							typeId = phase?.typeId ?? null
						}

						const entries = productIntegrationStartingPoints.get(speakerKey) || []
						const frontEntry = entries.find((sp) => isFrontFacingTitle(sp.title))
						if (frontEntry && Array.isArray(frontEntry.controlPoints) && frontEntry.controlPoints.length > 0) {
							// Front Facing carries no delay; drop any delay line so the arc delay isn't overwritten
							startingPointCommands = frontEntry.controlPoints.filter((cp) => !/\/delay=/.test(String(cp)))
							startingPointTitle = frontEntry.title || ''
						}
					}

					const n = Math.max(1, Math.min(2 * NUM_OUTPUTS, Number(o.numSubs)))
					const start = Math.max(1, Math.min(NUM_OUTPUTS, Number(o.startCh)))
					const end = Math.min(NUM_OUTPUTS, start + n - 1)

					const toMeters = o.units === 'ft' ? 0.3048 : 1.0
					const spacingM = Number(o.spacing) * toMeters
					const arcAngleDeg = Number(o.radius) || 0 // Treat "radius" field as arc angle in degrees

					const roundTo01 = (val) => Math.round(val / 0.01) * 0.01

					const msAtIndex = (i) => {
						if (arcAngleDeg === 0) return 0 // Straight line, no delays

						// Meyer Sound calculation method (matches Excel and official documentation)
						// Uses Cartesian distance calculation from arc positions to reference line

						const singleSplayDeg = arcAngleDeg / (n - 1)
						const singleSplayRad = (singleSplayDeg * Math.PI) / 180
						const AcC_virtual = -spacingM / singleSplayRad // Virtual acoustic center (negative radius)

						// Base angle offset for even/odd speaker count
						const baseAngleDeg = n % 2 === 0 ? singleSplayDeg / 2 : 0

						// Reference point Y coordinate (straight line spacing)
						// For even count: starts at spacing/2, increments by spacing
						// T values go from high to low (T7=11, T8=9, ..., T12=1 for 6 speakers with 2m spacing)
						const T_base = n % 2 === 0 ? spacingM / 2 : 0
						const T = T_base + (n - 1 - i) * spacingM

						// Speaker angle (decreases from high to low: 66°, 54°, 42°, 30°, 18°, 6° for 60° arc)
						const angleDeg = baseAngleDeg + (n - 1 - i) * singleSplayDeg
						const angleRad = (angleDeg * Math.PI) / 180

						// Speaker position on arc (Cartesian coordinates)
						const L = Math.abs(AcC_virtual) * Math.cos(angleRad) + AcC_virtual
						const M = Math.abs(AcC_virtual) * Math.sin(angleRad)

						// Reference point coordinates
						const S = 0

						// Euclidean distance from speaker to reference point
						const distance = Math.sqrt(Math.pow(S - L, 2) + Math.pow(T - M, 2))

						return (distance / c) * 1000
					}

					const raw = []
					for (let i = 0; i < n; i++) raw.push(msAtIndex(i))
					const minMs = Math.min(...raw)
					const relative = raw.map((v) => v - minMs)

					// Create symmetric delays: arc is symmetric, so we mirror the second half.
					// Flip inverts the curve (edges = 0 ms, center = max) by building from the reversed
					// half; this preserves the real arc values and puts 0 ms at the start channel.
					const halfCount = Math.ceil(n / 2)
					let baseHalf = relative.slice(n - halfCount)
					if (o.array_flip_layout === true) baseHalf = baseHalf.slice().reverse()

					const offsetsMs = [...baseHalf]
					// Append reverse, skipping last element for even count (to avoid duplicating center)
					for (let i = halfCount - (n % 2 === 0 ? 1 : 2); i >= 0; i--) {
						offsetsMs.push(baseHalf[i])
					}

					// Check if factory reset is enabled
					const shouldReset = e.options.reset_array === true
					const channelPrefix = String(e.options?.array_channel_prefix || '').trim()
					const configuredChannels = []

					// Mono writes only the first half (the arc is mirror-symmetric); Stereo writes all.
					const writeCount = String(o.array_output_mode) === 'mono' ? Math.ceil(n / 2) : n
					const writeOffsets = offsetsMs.slice(0, writeCount)

					// Reject impossible configurations before touching the device
					const blockErr = validateOutputBlocks([{ label: `${n} subs`, start, count: writeCount }])
					if (blockErr) {
						const msg = `Not applied — ${blockErr}. Use Mono (uses half the outputs), reduce the sub count, or pick an earlier starting channel.`
						self.log?.('warn', msg)
						setStatus(`⚠️ ${msg}`)
						return
					}

					const lines = []
					for (let i = 0; i < writeCount; i++) {
						const ch = start + i

						// Apply factory reset if checkbox is enabled
						if (shouldReset) {
							for (const resetCmd of FACTORY_RESET_COMMANDS) {
								const cmd = resetCmd.replace(/\{ch\}/g, ch)
								self._cmdSendLine(cmd)
							}
						}

						// Apply product integration if specified
						if (typeId) {
							self._cmdSendLine(`/processing/output/${ch}/delay_integration/type=${typeId}`)
						}
						if (startingPointCommands && Array.isArray(startingPointCommands)) {
							for (const cmd of startingPointCommands) {
								const finalCmd = cmd.replace(/\{ch\}/g, ch).replace(/\{\}/g, ch)
								self._cmdSendLine(finalCmd)
							}
						}

						// Apply arc delay
						const targetMs = roundTo01(writeOffsets[i])
						self._setOutputDelayMs(ch, targetMs)
						// In Mono each output represents a symmetric pair (e.g. 6 subs → "1 & 6", "2 & 5", "3 & 4")
						applyChannelName(
							ch,
							channelPrefix,
							String(o.array_output_mode) === 'mono' ? monoPairLabel(i, n) : `${i + 1}`,
						)
						configuredChannels.push(ch)

						const spLabel =
							speakerKey && speakerKey !== 'OFF'
								? ` [${speakerKey}${startingPointTitle ? ': ' + startingPointTitle : ''}]`
								: ''
						lines.push(`Arc: ch ${ch} = ${targetMs.toFixed(2)} ms${spLabel}`)
					}

					// Assign/enable or (for "None") unassign/disable the Output Link Group
					lines.push(...applyLinkGroup(configuredChannels, e.options?.array_link_group))

					self.log?.(
						'info',
						[
							`Sub Arc: n=${n}, ch ${start}-${end}, spacing=${o.spacing}${o.units}, R=${o.radius}${o.units}, T=${o.temp_array}°${unitIn} (~${T.toFixed(1)}°C, c~${c.toFixed(1)} m/s)`,
							...lines,
						].join(' | '),
					)
					setStatus(
						`✅ Applied — Array: ${configuredChannels.length} output(s)${String(o.array_output_mode) === 'mono' ? ' (Mono)' : ''}, ${n} subs, ${o.radius}° arc.`,
					)
				} catch (err) {
					self.log?.('error', `Arc delay failed: ${err?.message || err}`)
					setStatus(`⚠️ Array failed: ${err?.message || err}`)
				}
			} else if (mode === 'gradient') {
				// Execute Gradient logic
				const speakerKey = String(e.options?.gradient_speaker || '')
				if (!speakerKey || speakerKey === 'OFF' || speakerKey === '') {
					self.log?.('warn', 'Please select a loudspeaker for Gradient mode')
					setStatus('Select a loudspeaker to apply.')
					return
				}

				// Delay integration type from the selected Phase Curve, falling back to the first phase
				let typeId = null
				const speakerEntry = productIntegrationSpeakers.get(speakerKey)
				if (speakerEntry?.phases?.length > 0) {
					const phaseOptionId = gradientSpeakerPhaseOption.get(speakerKey)
					const selectedPhaseId = phaseOptionId ? String(e.options?.[phaseOptionId] || '').trim() : ''
					const phase = speakerEntry.phases.find((p) => p.id === selectedPhaseId) || speakerEntry.phases[0]
					typeId = phase?.typeId ?? null
				}

				if (!typeId) {
					self.log?.('warn', `Invalid product integration selection for speaker ${speakerKey}`)
					setStatus(`⚠️ Not applied — invalid product integration for ${speakerKey}.`)
					return
				}

				const finalTypeId = String(typeId)
				const shouldReset = e.options.reset_gradient === true
				const channelPrefix = String(e.options?.gradient_channel_prefix || '').trim()
				const lines = []

				// Auto-detect the Front Facing / Rear Facing starting points by title — front goes to
				// the front outputs, rear (polarity + cabinet delay) to the reversed outputs.
				const spEntries = productIntegrationStartingPoints.get(speakerKey) || []
				const frontEntry = spEntries.find((sp) => isFrontFacingTitle(sp.title))
				const rearEntry = spEntries.find((sp) => isRearFacingTitle(sp.title))

				// Process Front outputs
				const frontOutputsRaw = e.options.gradient_outputs_front
				const frontOutputs = Array.isArray(frontOutputsRaw)
					? frontOutputsRaw.map(Number).filter((ch) => Number.isFinite(ch) && ch >= 1 && ch <= NUM_OUTPUTS)
					: []

				// Process Reversed outputs
				const reversedOutputsRaw = e.options.gradient_outputs_reversed
				const reversedOutputs = Array.isArray(reversedOutputsRaw)
					? reversedOutputsRaw.map(Number).filter((ch) => Number.isFinite(ch) && ch >= 1 && ch <= NUM_OUTPUTS)
					: []

				// Check for duplicate output selections
				const frontSet = new Set(frontOutputs)
				const reversedSet = new Set(reversedOutputs)
				const duplicates = frontOutputs.filter((ch) => reversedSet.has(ch))
				if (duplicates.length > 0) {
					self.log?.(
						'warn',
						`Warning: Outputs ${duplicates.join(', ')} are selected in both Front and Reversed. The Reversed setting will overwrite the Front setting for these channels.`,
					)
				}

				if (frontOutputs.length > 0) {
					const frontCommands =
						frontEntry && Array.isArray(frontEntry.controlPoints) && frontEntry.controlPoints.length > 0
							? frontEntry.controlPoints
							: null
					const frontTitle = frontCommands ? frontEntry.title || '' : ''

					for (let k = 0; k < frontOutputs.length; k++) {
						const ch = frontOutputs[k]
						// Apply factory reset if checkbox is enabled
						if (shouldReset) {
							for (const resetCmd of FACTORY_RESET_COMMANDS) {
								const cmd = resetCmd.replace(/\{ch\}/g, ch)
								self._cmdSendLine(cmd)
							}
						}

						// Apply delay integration type
						self._cmdSendLine(`/processing/output/${ch}/delay_integration/type=${finalTypeId}`)

						// Optional channel naming
						applyChannelName(ch, channelPrefix, frontOutputs.length > 1 ? `Front ${k + 1}` : 'Front')

						// Apply starting point commands if any
						if (frontCommands && Array.isArray(frontCommands)) {
							for (const cmd of frontCommands) {
								const finalCmd = cmd.replace(/\{ch\}/g, ch).replace(/\{\}/g, ch)
								self._cmdSendLine(finalCmd)
							}
						}

						const spLabel = frontTitle ? ` (${frontTitle})` : ''
						lines.push(`Front ch ${ch}${spLabel}`)
					}
				}

				if (reversedOutputs.length > 0) {
					// Reversed outputs use the Rear Facing preset (polarity + cabinet delay). Loudspeakers
					// without a rear preset fall back to the front-facing filters + a user-typed rear delay,
					// with polarity reversed automatically.
					let reversedCommands, reversedTitle, reversedDelaySamples
					if (rearEntry && Array.isArray(rearEntry.controlPoints) && rearEntry.controlPoints.length > 0) {
						reversedCommands = rearEntry.controlPoints // delay + polarity already baked in
						reversedTitle = rearEntry.title || ''
						reversedDelaySamples = null
					} else {
						const manualMs = Math.max(0, Number(e.options.gradient_manual_rear_delay_ms) || 0)
						reversedDelaySamples = Math.round(manualMs * 96)
						reversedCommands = (frontEntry?.controlPoints || []).filter((cp) => !/\/delay=/.test(String(cp)))
						reversedTitle = `${frontEntry?.title || 'front'} + reversed polarity (manual ${manualMs.toFixed(2)} ms)`
						self.log?.(
							'warn',
							`Loudspeaker ${speakerKey} has no factory Rear Facing preset — reversed outputs use manual rear delay ${manualMs.toFixed(2)} ms with polarity reversed automatically.`,
						)
					}
					const reversedHasPolarity = reversedCommands.some((cp) => /polarity_reversal/.test(String(cp)))

					for (let k = 0; k < reversedOutputs.length; k++) {
						const ch = reversedOutputs[k]
						if (shouldReset) {
							for (const resetCmd of FACTORY_RESET_COMMANDS) self._cmdSendLine(resetCmd.replace(/\{ch\}/g, ch))
						}
						self._cmdSendLine(`/processing/output/${ch}/delay_integration/type=${finalTypeId}`)
						applyChannelName(ch, channelPrefix, reversedOutputs.length > 1 ? `Reversed ${k + 1}` : 'Reversed')
						for (const cmd of reversedCommands) {
							self._cmdSendLine(cmd.replace(/\{ch\}/g, ch).replace(/\{\}/g, ch))
						}
						if (!reversedHasPolarity) self._cmdSendLine(`/processing/output/${ch}/polarity_reversal='true'`)
						if (reversedDelaySamples !== null) {
							self._cmdSendLine(`/processing/output/${ch}/delay=${reversedDelaySamples}`)
							self._applyOutputDelay(ch, reversedDelaySamples)
						}
						const spLabel = reversedTitle ? ` (${reversedTitle})` : ''
						lines.push(`Reversed ch ${ch}${spLabel}`)
					}
				}

				// Assign/enable or (for "None") unassign/disable the Output Link Group
				lines.push(...applyLinkGroup([...frontOutputs, ...reversedOutputs], e.options?.gradient_link_group))

				if (lines.length > 0) {
					self.log?.('info', [`Gradient: ${speakerKey} (type ${finalTypeId})`, ...lines].join(' | '))
					setStatus(
						`✅ Applied — Gradient: ${speakerKey}, ${frontOutputs.length} front + ${reversedOutputs.length} reversed output(s).`,
					)
				} else {
					self.log?.('warn', 'No outputs selected for Gradient mode')
					setStatus('Select Front and/or Reversed outputs to apply.')
				}
			} else if (mode === 'endfire_gradient') {
				// Execute End-Fire Gradient logic: a cardioid gradient pair (front-facing +
				// reversed rear-facing) with the end-fire steering delay summed onto the rear.
				const speakerKey = String(e.options?.eg_speaker || '')
				if (!speakerKey || speakerKey === 'OFF' || speakerKey === '') {
					self.log?.('warn', 'Please select a loudspeaker for End-Fire Gradient mode')
					setStatus('Select a loudspeaker to apply.')
					return
				}

				// Delay integration type from the selected Phase Curve (PC63/PC100/PC125), falling
				// back to the first available phase if none/invalid is chosen.
				let typeId = null
				const speakerEntry = productIntegrationSpeakers.get(speakerKey)
				if (speakerEntry?.phases?.length > 0) {
					const phaseOptionId = egSpeakerPhaseOption.get(speakerKey)
					const selectedPhaseId = phaseOptionId ? String(e.options?.[phaseOptionId] || '').trim() : ''
					const phase = speakerEntry.phases.find((p) => p.id === selectedPhaseId) || speakerEntry.phases[0]
					typeId = phase?.typeId ?? null
				}
				if (!typeId) {
					self.log?.('warn', `Invalid product integration selection for speaker ${speakerKey}`)
					setStatus(`⚠️ Not applied — invalid product integration for ${speakerKey}.`)
					return
				}
				const finalTypeId = String(typeId)

				// End-fire delay from target frequency + speed of sound (quarter-wavelength tap)
				const f = Math.max(1e-6, Number(e.options.freq_eg) || 80)
				const unitIn = e.options.tempUnit_eg === 'F' ? 'F' : 'C'
				let T = Number.isFinite(Number(e.options.temp_eg)) ? Number(e.options.temp_eg) : 20
				if (unitIn === 'F') T = ((T - 32) * 5) / 9
				const c = speedOfSound_mps(T)

				const spacing_m = c / (4 * f)
				self._subassist = { spacing_m, T, c }
				self.setVariableValues?.({
					subassist_spacing_ft: (spacing_m * 3.28084).toFixed(2),
					subassist_spacing_m: spacing_m.toFixed(3),
				})
				try {
					self.updateActions?.()
				} catch {}

				const roundTo01 = (val) => Math.round(val / 0.01) * 0.01
				const perTapMs = roundTo01(1000 / (4 * f))
				const endfireSamples = Math.round(perTapMs * 96)

				// Auto-detect Front Facing / Rear Facing starting points by title
				const spEntries = productIntegrationStartingPoints.get(speakerKey) || []
				const frontEntry = spEntries.find((sp) => isFrontFacingTitle(sp.title))
				const rearEntry = spEntries.find((sp) => isRearFacingTitle(sp.title))
				if (!frontEntry) {
					self.log?.(
						'warn',
						`Loudspeaker ${speakerKey} has no Front Facing starting point required for End-Fire Gradient`,
					)
					return
				}

				// The Rear Facing starting point bakes in a cabinet-specific gradient delay
				// (e.g. /processing/output/{}/delay='365'). Parse it so we can sum it with the
				// end-fire delay rather than letting one overwrite the other.
				const parseDelaySamples = (controlPoints) => {
					for (const cp of controlPoints || []) {
						const m = String(cp).match(/\/delay=['"]?(-?\d+(?:\.\d+)?)['"]?/)
						if (m) return Math.round(Number(m[1]))
					}
					return 0
				}
				const withoutDelay = (controlPoints) => (controlPoints || []).filter((cp) => !/\/delay=/.test(String(cp)))

				// Resolve the rear-facing treatment. When the loudspeaker has a factory Rear Facing
				// preset we use its filters + baked-in cabinet delay. Otherwise we synthesize the rear
				// from the front-facing filters, reverse polarity automatically, and use a user-typed delay.
				let rearControlPoints
				let cabinetSamples
				let rearLabel
				if (rearEntry) {
					rearControlPoints = withoutDelay(rearEntry.controlPoints)
					cabinetSamples = parseDelaySamples(rearEntry.controlPoints)
					rearLabel = rearEntry.title
				} else {
					const manualMs = Math.max(0, Number(e.options.eg_manual_rear_delay_ms) || 0)
					cabinetSamples = Math.round(manualMs * 96)
					rearControlPoints = withoutDelay(frontEntry.controlPoints)
					rearLabel = `${frontEntry.title} + reversed polarity (manual ${manualMs.toFixed(2)} ms)`
					self.log?.(
						'warn',
						`Loudspeaker ${speakerKey} has no factory Rear Facing preset — using manual rear delay ${manualMs.toFixed(2)} ms and reversing polarity automatically on the negative outputs.`,
					)
				}
				// Make sure the rear outputs end up polarity-reversed even when synthesized.
				const rearHasPolarity = rearControlPoints.some((cp) => /polarity_reversal/.test(String(cp)))

				const depth = Math.min(EG_MAX_TAPS, Math.max(2, Number(e.options.eg_depth) || 2))
				const firstFront = Math.max(1, Math.min(NUM_OUTPUTS, Math.round(Number(e.options.eg_first_front) || 1)))
				const firstRear = Math.max(1, Math.min(NUM_OUTPUTS, Math.round(Number(e.options.eg_first_rear) || 2)))

				// Auto-fill one front + one rear channel per tap from the two first outputs. Adjacent
				// first outputs (gap 1) interleave the pairs (stride 2: 1,3,5… / 2,4,6…); a larger gap
				// lays them out as consecutive blocks (stride 1: 1–N front / Rf–Rf+N-1 rear).
				const gap = firstRear - firstFront
				const stride = gap === 1 ? 2 : 1
				const taps = []
				for (let t = 0; t < depth; t++) {
					taps.push({ front: firstFront + t * stride, rear: firstRear + t * stride })
				}

				const inRange = (ch) => Number.isFinite(ch) && ch >= 1 && ch <= NUM_OUTPUTS

				// Reject impossible configurations before touching the device: any computed output beyond
				// the device, or a front/rear collision, means nothing is applied.
				const oob = new Set()
				const dupes = new Set()
				const usedRole = new Map()
				for (const { front, rear } of taps) {
					for (const ch of [front, rear]) {
						if (!inRange(ch)) {
							oob.add(ch)
							continue
						}
						if (usedRole.has(ch)) dupes.add(ch)
						else usedRole.set(ch, true)
					}
				}
				if (oob.size > 0) {
					const msg = `Not applied — computed outputs ${[...oob].sort((a, b) => a - b).join(', ')} fall outside 1–${NUM_OUTPUTS}. Lower the tap count or the first front/rear outputs.`
					self.log?.('warn', msg)
					setStatus(`⚠️ ${msg}`)
					return
				}
				if (dupes.size > 0) {
					const msg = `Not applied — outputs ${[...dupes].sort((a, b) => a - b).join(', ')} collide between front and rear. Increase the gap between the first outputs or reduce the tap count.`
					self.log?.('warn', msg)
					setStatus(`⚠️ ${msg}`)
					return
				}

				const shouldReset = e.options.reset_eg === true
				const resetIfNeeded = (ch) => {
					if (shouldReset) {
						for (const resetCmd of FACTORY_RESET_COMMANDS) self._cmdSendLine(resetCmd.replace(/\{ch\}/g, ch))
					}
				}

				// Optional channel naming: "<prefix> T# Front" / "<prefix> T# Rear"
				const channelPrefix = String(e.options?.eg_channel_prefix || '').trim()

				const configuredChannels = []
				const lines = []
				const frontFilterCmds = withoutDelay(frontEntry.controlPoints)

				for (let t = 0; t < depth; t++) {
					// End-fire steering delay for this tap (T0 = 0, each deeper tap one step more)
					const tapEndfireSamples = t * endfireSamples
					const tapEndfireMs = tapEndfireSamples / 96
					const fch = taps[t].front
					const rch = taps[t].rear

					// Front-facing output: front filters, end-fire delay only (no gradient delay)
					if (inRange(fch)) {
						resetIfNeeded(fch)
						self._cmdSendLine(`/processing/output/${fch}/delay_integration/type=${finalTypeId}`)
						for (const cmd of frontFilterCmds) {
							self._cmdSendLine(cmd.replace(/\{ch\}/g, fch).replace(/\{\}/g, fch))
						}
						self._cmdSendLine(`/processing/output/${fch}/delay=${tapEndfireSamples}`)
						self._applyOutputDelay(fch, tapEndfireSamples)
						applyChannelName(fch, channelPrefix, `T${t} Front`)
						configuredChannels.push(fch)
						lines.push(`T${t} front ch ${fch} = ${tapEndfireMs.toFixed(2)} ms (${frontEntry.title})`)
					}

					// Rear-facing output: rear filters + polarity, gradient delay + end-fire delay summed
					const rearSamples = cabinetSamples + tapEndfireSamples
					const rearMs = rearSamples / 96
					if (inRange(rch)) {
						resetIfNeeded(rch)
						self._cmdSendLine(`/processing/output/${rch}/delay_integration/type=${finalTypeId}`)
						for (const cmd of rearControlPoints) {
							self._cmdSendLine(cmd.replace(/\{ch\}/g, rch).replace(/\{\}/g, rch))
						}
						if (!rearHasPolarity) {
							self._cmdSendLine(`/processing/output/${rch}/polarity_reversal='true'`)
						}
						self._cmdSendLine(`/processing/output/${rch}/delay=${rearSamples}`)
						self._applyOutputDelay(rch, rearSamples)
						applyChannelName(rch, channelPrefix, `T${t} Rear`)
						configuredChannels.push(rch)
						lines.push(
							`T${t} rear ch ${rch} = ${rearMs.toFixed(2)} ms (cabinet ${(cabinetSamples / 96).toFixed(2)} + EF ${tapEndfireMs.toFixed(2)}) (${rearLabel})`,
						)
					}
				}

				// Assign/enable or (for "None") unassign/disable the Output Link Group
				lines.push(...applyLinkGroup(configuredChannels, e.options?.eg_link_group))

				if (lines.length > 0) {
					const c_fps = c * 3.28084
					self.log?.(
						'info',
						[
							`End-Fire Gradient: ${speakerKey} (type ${finalTypeId}) | f=${f} Hz, T=${e.options.temp_eg}°${unitIn} (~${T.toFixed(1)}°C, c~${c.toFixed(1)} m/s ~ ${c_fps.toFixed(1)} ft/s) | EF tap~${perTapMs.toFixed(2)} ms, cabinet ${cabinetSamples} smp`,
							...lines,
						].join(' | '),
					)
					setStatus(
						`✅ Applied — End-Fire Gradient: ${speakerKey}, ${depth} taps, ${configuredChannels.length} output(s).`,
					)
				} else {
					self.log?.('warn', 'No outputs selected for End-Fire Gradient mode')
					setStatus('No outputs configured to apply.')
				}
			} else if (mode === 'array_endfire') {
				// Execute Array End-Fire logic (combines end-fire and array)
				try {
					const o = e.options

					// Get end-fire parameters
					const f = Math.max(1e-6, Number(o.freq_arrayendfire) || 80)
					const depth = Math.min(8, Math.max(2, Number(o.depth_arrayendfire) || 2))

					// Get temperature and calculate speed of sound
					const unitIn = o.tempUnit_arrayendfire === 'F' ? 'F' : 'C'
					let T = Number.isFinite(Number(o.temp_arrayendfire)) ? Number(o.temp_arrayendfire) : 20
					if (unitIn === 'F') T = ((T - 32) * 5) / 9
					const c = speedOfSound_mps(T)

					// Store for variable updates
					const spacing_m = c / (4 * f)
					self._subassist = { spacing_m, T, c }
					self._arcassist = { T, c }
					self.setVariableValues?.({
						subassist_spacing_ft: (spacing_m * 3.28084).toFixed(2),
						subassist_spacing_m: spacing_m.toFixed(3),
					})

					try {
						self.updateActions?.()
					} catch {}

					// Get array parameters
					const toMeters = o.units_arrayendfire === 'ft' ? 0.3048 : 1.0
					const spacingM = Number(o.spacing_arrayendfire) * toMeters
					const arcAngleDeg = Number(o.radius_arrayendfire) || 0 // Treat "radius" field as arc angle in degrees
					const numSubs = Math.max(1, Math.min(2 * NUM_OUTPUTS, Number(o.numSubs_arrayendfire)))

					// Get starting channels for each row
					const rowLabels = ['front', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth']
					const rowStartChannels = []
					for (let rowIdx = 0; rowIdx < depth; rowIdx++) {
						const key = `startCh_${rowLabels[rowIdx]}_arrayendfire`
						const startCh = Number(o[key])
						if (Number.isFinite(startCh) && startCh >= 1 && startCh <= NUM_OUTPUTS) {
							rowStartChannels.push(startCh)
						} else {
							rowStartChannels.push(null)
						}
					}

					// Calculate end-fire delays per row
					const roundTo01 = (val) => Math.round(val / 0.01) * 0.01
					const perTapMs = roundTo01(1000 / (4 * f))
					const perTapSamples = Math.round(perTapMs * 96)

					// Calculate array arc delays (same for all rows)
					const msAtIndex = (i) => {
						if (arcAngleDeg === 0) return 0 // Straight line, no delays

						// Meyer Sound calculation method (matches Excel and official documentation)
						// Uses Cartesian distance calculation from arc positions to reference line

						const singleSplayDeg = arcAngleDeg / (numSubs - 1)
						const singleSplayRad = (singleSplayDeg * Math.PI) / 180
						const AcC_virtual = -spacingM / singleSplayRad // Virtual acoustic center (negative radius)

						// Base angle offset for even/odd speaker count
						const baseAngleDeg = numSubs % 2 === 0 ? singleSplayDeg / 2 : 0

						// Reference point Y coordinate (straight line spacing)
						// For even count: starts at spacing/2, increments by spacing
						// T values go from high to low (T7=11, T8=9, ..., T12=1 for 6 speakers with 2m spacing)
						const T_base = numSubs % 2 === 0 ? spacingM / 2 : 0
						const T = T_base + (numSubs - 1 - i) * spacingM

						// Speaker angle (decreases from high to low: 66°, 54°, 42°, 30°, 18°, 6° for 60° arc)
						const angleDeg = baseAngleDeg + (numSubs - 1 - i) * singleSplayDeg
						const angleRad = (angleDeg * Math.PI) / 180

						// Speaker position on arc (Cartesian coordinates)
						const L = Math.abs(AcC_virtual) * Math.cos(angleRad) + AcC_virtual
						const M = Math.abs(AcC_virtual) * Math.sin(angleRad)

						// Reference point coordinates
						const S = 0

						// Euclidean distance from speaker to reference point
						const distance = Math.sqrt(Math.pow(S - L, 2) + Math.pow(T - M, 2))

						return (distance / c) * 1000
					}

					const raw = []
					for (let i = 0; i < numSubs; i++) raw.push(msAtIndex(i))
					const minMs = Math.min(...raw)
					const relative = raw.map((v) => v - minMs)

					// Create symmetric delays: arc is symmetric, so we mirror the second half.
					// Flip inverts the curve (edge subs = 0 ms, center = max) by building from the reversed half.
					const halfCount = Math.ceil(numSubs / 2)
					let baseHalf = relative.slice(numSubs - halfCount)
					if (o.arrayendfire_flip_layout === true) baseHalf = baseHalf.slice().reverse()

					const arcOffsetsMs = [...baseHalf]
					// Append reverse, skipping last element for even count (to avoid duplicating center)
					for (let i = halfCount - (numSubs % 2 === 0 ? 1 : 2); i >= 0; i--) {
						arcOffsetsMs.push(baseHalf[i])
					}

					// Product integration: delay-integration type from the selected Phase Curve, and the
					// Front Facing starting point applied automatically (all subs face the same way).
					const speakerKey = String(o?.arrayendfire_speaker || '')
					let typeId = null
					let startingPointCommands = null
					let startingPointTitle = ''

					if (speakerKey && speakerKey !== 'OFF' && speakerKey !== '') {
						const speakerEntry = productIntegrationSpeakers.get(speakerKey)
						if (speakerEntry?.phases?.length > 0) {
							const phaseOptionId = arrayendfireSpeakerPhaseOption.get(speakerKey)
							const selectedPhaseId = phaseOptionId ? String(o?.[phaseOptionId] || '').trim() : ''
							const phase = speakerEntry.phases.find((p) => p.id === selectedPhaseId) || speakerEntry.phases[0]
							typeId = phase?.typeId ?? null
						}

						const entries = productIntegrationStartingPoints.get(speakerKey) || []
						const frontEntry = entries.find((sp) => isFrontFacingTitle(sp.title))
						if (frontEntry && Array.isArray(frontEntry.controlPoints) && frontEntry.controlPoints.length > 0) {
							// Front Facing carries no delay; drop any delay line so the combined delay isn't overwritten
							startingPointCommands = frontEntry.controlPoints.filter((cp) => !/\/delay=/.test(String(cp)))
							startingPointTitle = frontEntry.title || ''
						}
					}

					// Check if factory reset is enabled
					const shouldReset = o.reset_arrayendfire === true
					const channelPrefix = String(o?.arrayendfire_channel_prefix || '').trim()
					const configuredChannels = []

					// Mono writes only the first half of each row (rows are mirror-symmetric); Stereo writes all.
					// (Flip is already baked into arcOffsetsMs above.)
					const subsPerRow = String(o.arrayendfire_output_mode) === 'mono' ? Math.ceil(numSubs / 2) : numSubs
					const arcSeq = arcOffsetsMs.slice(0, subsPerRow)

					// Reject impossible configurations (rows past the outputs, or overlapping rows)
					const aefBlocks = []
					for (let rowIdx = 0; rowIdx < depth; rowIdx++) {
						const rsc = rowStartChannels[rowIdx]
						if (rsc === null) continue
						const rowNm = rowLabels[rowIdx].charAt(0).toUpperCase() + rowLabels[rowIdx].slice(1)
						aefBlocks.push({ label: `the ${rowNm} row`, start: rsc, count: subsPerRow })
					}
					const aefErr = validateOutputBlocks(aefBlocks)
					if (aefErr) {
						const msg = `Not applied — ${aefErr}. Use Mono, reduce subs per row, or change the per-row first outputs so the rows fit and don't overlap.`
						self.log?.('warn', msg)
						setStatus(`⚠️ ${msg}`)
						return
					}

					const lines = []

					// Apply combined delays to each row
					for (let rowIdx = 0; rowIdx < depth; rowIdx++) {
						const rowStartCh = rowStartChannels[rowIdx]
						if (rowStartCh === null) continue

						const endfireMs = (rowIdx * perTapSamples) / 96

						// Process each sub in this row
						for (let subIdx = 0; subIdx < subsPerRow; subIdx++) {
							const ch = rowStartCh + subIdx

							// Get the arc delay for this position in the array
							const arcMs = subIdx < arcSeq.length ? arcSeq[subIdx] : 0

							// Combined delay = end-fire delay + arc delay
							const combinedMs = roundTo01(endfireMs + arcMs)

							// Apply factory reset if checkbox is enabled
							if (shouldReset) {
								for (const resetCmd of FACTORY_RESET_COMMANDS) {
									const cmd = resetCmd.replace(/\{ch\}/g, ch)
									self._cmdSendLine(cmd)
								}
							}

							// Apply product integration if specified
							if (typeId) {
								self._cmdSendLine(`/processing/output/${ch}/delay_integration/type=${typeId}`)
							}
							if (startingPointCommands && Array.isArray(startingPointCommands)) {
								for (const cmd of startingPointCommands) {
									const finalCmd = cmd.replace(/\{ch\}/g, ch).replace(/\{\}/g, ch)
									self._cmdSendLine(finalCmd)
								}
							}

							// Apply combined delay
							self._setOutputDelayMs(ch, combinedMs)
							const rowNm = rowLabels[rowIdx].charAt(0).toUpperCase() + rowLabels[rowIdx].slice(1)
							// In Mono each output represents a symmetric pair within the row (e.g. "1 & 6")
							const subSuffix =
								String(o.arrayendfire_output_mode) === 'mono' ? monoPairLabel(subIdx, numSubs) : `${subIdx + 1}`
							applyChannelName(ch, channelPrefix, `${rowNm} ${subSuffix}`)
							configuredChannels.push(ch)

							const spLabel =
								speakerKey && speakerKey !== 'OFF'
									? ` [${speakerKey}${startingPointTitle ? ': ' + startingPointTitle : ''}]`
									: ''
							const rowName = rowLabels[rowIdx].charAt(0).toUpperCase() + rowLabels[rowIdx].slice(1)
							lines.push(
								`${rowName} row: ch ${ch} = ${combinedMs.toFixed(2)} ms (EF: ${endfireMs.toFixed(2)} + Arc: ${arcMs.toFixed(2)})${spLabel}`,
							)
						}
					}

					// Assign/enable or (for "None") unassign/disable the Output Link Group
					lines.push(...applyLinkGroup(configuredChannels, o?.arrayendfire_link_group))

					if (lines.length) {
						const c_fps = c * 3.28084
						const T_F = (T * 9) / 5 + 32
						self.log?.(
							'info',
							[
								`Array End-Fire: f=${f} Hz, depth=${depth} rows, ${numSubs} subs/row, spacing=${o.spacing_arrayendfire}${o.units_arrayendfire}, R=${o.radius_arrayendfire}${o.units_arrayendfire} | T=${o.temp_arrayendfire}°${unitIn} (~${T.toFixed(1)}°C, c~${c.toFixed(1)} m/s ~ ${c_fps.toFixed(1)} ft/s) | perRow~${perTapMs.toFixed(2)} ms`,
								...lines,
							].join(' | '),
						)
						setStatus(`✅ Applied — Array End-Fire: ${depth} rows, ${configuredChannels.length} output(s).`)
					} else {
						self.log?.('warn', 'No rows configured for Array End-Fire mode')
						setStatus('No rows configured to apply.')
					}
				} catch (err) {
					self.log?.('error', `Array End-Fire failed: ${err?.message || err}`)
					setStatus(`⚠️ Array End-Fire failed: ${err?.message || err}`)
				}
			} else if (mode === 'array_gradient') {
				// Array Gradient: a symmetric arc of front-facing subs (like Array) plus one rear-facing
				// sub per front sub — the rear gets the same arc delay + the cabinet gradient delay, with
				// polarity reversed (a cardioid arc).
				try {
					const o = e.options
					const speakerKey = String(o?.ag_speaker || '')
					if (!speakerKey || speakerKey === 'OFF' || speakerKey === '') {
						self.log?.('warn', 'Please select a loudspeaker for Array Gradient mode')
						setStatus('Select a loudspeaker to apply.')
						return
					}

					const unitIn = o.ag_tempUnit === 'F' ? 'F' : 'C'
					let T = Number.isFinite(Number(o.ag_temp)) ? Number(o.ag_temp) : 20
					if (unitIn === 'F') T = ((T - 32) * 5) / 9
					const c = speedOfSound_mps(T)
					self._arcassist = { T, c }
					try {
						self.updateActions?.()
					} catch {}

					// Phase Curve -> delay-integration type id
					let typeId = null
					const speakerEntry = productIntegrationSpeakers.get(speakerKey)
					if (speakerEntry?.phases?.length > 0) {
						const phaseOptionId = agSpeakerPhaseOption.get(speakerKey)
						const selectedPhaseId = phaseOptionId ? String(o?.[phaseOptionId] || '').trim() : ''
						const phase = speakerEntry.phases.find((p) => p.id === selectedPhaseId) || speakerEntry.phases[0]
						typeId = phase?.typeId ?? null
					}
					const finalTypeId = typeId ? String(typeId) : null

					// Auto-detect Front Facing / Rear Facing starting points
					const spEntries = productIntegrationStartingPoints.get(speakerKey) || []
					const frontEntry = spEntries.find((sp) => isFrontFacingTitle(sp.title))
					const rearEntry = spEntries.find((sp) => isRearFacingTitle(sp.title))
					const stripDelay = (cps) => (cps || []).filter((cp) => !/\/delay=/.test(String(cp)))
					const parseDelaySamples = (cps) => {
						for (const cp of cps || []) {
							const m = String(cp).match(/\/delay=['"]?(-?\d+(?:\.\d+)?)['"]?/)
							if (m) return Math.round(Number(m[1]))
						}
						return 0
					}
					const frontFilters = frontEntry ? stripDelay(frontEntry.controlPoints) : []
					let rearFilters, cabinetSamples, rearLabel
					if (rearEntry && Array.isArray(rearEntry.controlPoints) && rearEntry.controlPoints.length > 0) {
						rearFilters = stripDelay(rearEntry.controlPoints)
						cabinetSamples = parseDelaySamples(rearEntry.controlPoints)
						rearLabel = rearEntry.title || ''
					} else {
						const manualMs = Math.max(0, Number(o.ag_manual_rear_delay_ms) || 0)
						cabinetSamples = Math.round(manualMs * 96)
						rearFilters = frontFilters
						rearLabel = `${frontEntry?.title || 'front'} + reversed polarity (manual ${manualMs.toFixed(2)} ms)`
						self.log?.(
							'warn',
							`Loudspeaker ${speakerKey} has no factory Rear Facing preset — rear outputs use manual rear delay ${manualMs.toFixed(2)} ms with polarity reversed automatically.`,
						)
					}
					const rearHasPolarity = rearFilters.some((cp) => /polarity_reversal/.test(String(cp)))

					const n = Math.max(1, Math.min(NUM_OUTPUTS, Number(o.ag_numSubs)))
					const startFront = Math.max(1, Math.min(NUM_OUTPUTS, Number(o.ag_startCh_front) || 1))
					const startRear = Math.max(1, Math.min(NUM_OUTPUTS, Number(o.ag_startCh_rear) || 1))

					const toMeters = o.ag_units === 'ft' ? 0.3048 : 1.0
					const spacingM = Number(o.ag_spacing) * toMeters
					const arcAngleDeg = Number(o.ag_radius) || 0
					const roundTo01 = (val) => Math.round(val / 0.01) * 0.01

					// Same arc math as the Array mode
					const msAtIndex = (i) => {
						if (arcAngleDeg === 0) return 0
						const singleSplayDeg = arcAngleDeg / (n - 1)
						const singleSplayRad = (singleSplayDeg * Math.PI) / 180
						const AcC_virtual = -spacingM / singleSplayRad
						const baseAngleDeg = n % 2 === 0 ? singleSplayDeg / 2 : 0
						const T_base = n % 2 === 0 ? spacingM / 2 : 0
						const Ty = T_base + (n - 1 - i) * spacingM
						const angleDeg = baseAngleDeg + (n - 1 - i) * singleSplayDeg
						const angleRad = (angleDeg * Math.PI) / 180
						const L = Math.abs(AcC_virtual) * Math.cos(angleRad) + AcC_virtual
						const M = Math.abs(AcC_virtual) * Math.sin(angleRad)
						const distance = Math.sqrt(Math.pow(0 - L, 2) + Math.pow(Ty - M, 2))
						return (distance / c) * 1000
					}
					const raw = []
					for (let i = 0; i < n; i++) raw.push(msAtIndex(i))
					const minMs = Math.min(...raw)
					const relative = raw.map((v) => v - minMs)
					// Flip inverts the curve (edges = 0 ms, center = max) by building from the reversed half.
					const halfCount = Math.ceil(n / 2)
					let baseHalf = relative.slice(n - halfCount)
					if (o.ag_flip_layout === true) baseHalf = baseHalf.slice().reverse()
					const offsetsMs = [...baseHalf]
					for (let i = halfCount - (n % 2 === 0 ? 1 : 2); i >= 0; i--) offsetsMs.push(baseHalf[i])

					const shouldReset = o.reset_ag === true
					const channelPrefix = String(o?.ag_channel_prefix || '').trim()
					const configuredChannels = []
					// Mono writes only the first half (mirror-symmetric); Stereo writes all.
					const writeCount = String(o.ag_output_mode) === 'mono' ? Math.ceil(n / 2) : n
					const writeOffsets = offsetsMs.slice(0, writeCount)

					// Reject impossible configurations (front/rear past the outputs, or overlapping blocks)
					const agErr = validateOutputBlocks([
						{ label: 'the front outputs', start: startFront, count: writeCount },
						{ label: 'the rear outputs', start: startRear, count: writeCount },
					])
					if (agErr) {
						const msg = `Not applied — ${agErr}. Use Mono, reduce the sub count, or move the front/rear start channels so both blocks fit and don't overlap.`
						self.log?.('warn', msg)
						setStatus(`⚠️ ${msg}`)
						return
					}

					const resetIfNeeded = (ch) => {
						if (shouldReset) for (const rc of FACTORY_RESET_COMMANDS) self._cmdSendLine(rc.replace(/\{ch\}/g, ch))
					}
					const lines = []

					for (let i = 0; i < writeCount; i++) {
						const arcMs = roundTo01(writeOffsets[i])
						const arcSamples = Math.round(arcMs * 96)
						// In Mono each output represents a symmetric pair (e.g. 6 subs → "1 & 6", "2 & 5", "3 & 4")
						const pairSuffix = String(o.ag_output_mode) === 'mono' ? monoPairLabel(i, n) : `${i + 1}`

						// Front sub: front filters + arc delay
						const fch = startFront + i
						if (fch >= 1 && fch <= NUM_OUTPUTS) {
							resetIfNeeded(fch)
							if (finalTypeId) self._cmdSendLine(`/processing/output/${fch}/delay_integration/type=${finalTypeId}`)
							for (const cmd of frontFilters) self._cmdSendLine(cmd.replace(/\{ch\}/g, fch).replace(/\{\}/g, fch))
							self._cmdSendLine(`/processing/output/${fch}/delay=${arcSamples}`)
							self._applyOutputDelay(fch, arcSamples)
							applyChannelName(fch, channelPrefix, `Front ${pairSuffix}`)
							configuredChannels.push(fch)
							lines.push(`Front ch ${fch} = ${arcMs.toFixed(2)} ms`)
						}

						// Rear sub: rear filters + polarity, arc delay + cabinet gradient delay
						const rch = startRear + i
						if (rch >= 1 && rch <= NUM_OUTPUTS) {
							resetIfNeeded(rch)
							if (finalTypeId) self._cmdSendLine(`/processing/output/${rch}/delay_integration/type=${finalTypeId}`)
							for (const cmd of rearFilters) self._cmdSendLine(cmd.replace(/\{ch\}/g, rch).replace(/\{\}/g, rch))
							if (!rearHasPolarity) self._cmdSendLine(`/processing/output/${rch}/polarity_reversal='true'`)
							const rearSamples = arcSamples + cabinetSamples
							self._cmdSendLine(`/processing/output/${rch}/delay=${rearSamples}`)
							self._applyOutputDelay(rch, rearSamples)
							applyChannelName(rch, channelPrefix, `Rear ${pairSuffix}`)
							configuredChannels.push(rch)
							lines.push(
								`Rear ch ${rch} = ${(rearSamples / 96).toFixed(2)} ms (arc ${arcMs.toFixed(2)} + cabinet ${(cabinetSamples / 96).toFixed(2)})`,
							)
						}
					}

					lines.push(...applyLinkGroup(configuredChannels, o?.ag_link_group))
					self.log?.(
						'info',
						[
							`Array Gradient: ${speakerKey}${finalTypeId ? ' (type ' + finalTypeId + ')' : ''} | ${n}/side, front@${startFront} rear@${startRear}, R=${o.ag_radius}°, c~${c.toFixed(1)} m/s | rear: ${rearLabel}`,
							...lines,
						].join(' | '),
					)
					setStatus(`✅ Applied — Array Gradient: ${speakerKey}, ${n}/side, ${configuredChannels.length} output(s).`)
				} catch (err) {
					self.log?.('error', `Array Gradient failed: ${err?.message || err}`)
					setStatus(`⚠️ Array Gradient failed: ${err?.message || err}`)
				}
			}
		},
	}
}

module.exports = { registerSubwooferDesignActions }
