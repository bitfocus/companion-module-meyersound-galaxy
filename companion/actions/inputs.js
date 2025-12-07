// actions/inputs.js
// Input-related actions: mutes, gains, U-Shaping, Parametric EQ

const { rangeChoices, buildInputChoices, nn } = require('../helpers')
const { safeGetChannels } = require('../actions-helpers')

/**
 * Register input-related actions
 * @param {Object} actions - Actions object to populate
 * @param {Object} self - Module instance
 * @param {number} NUM_INPUTS - Number of input channels
 * @param {number} NUM_OUTPUTS - Number of output channels
 */
function registerInputActions(actions, self, NUM_INPUTS, NUM_OUTPUTS) {
	const inputChoicesNum = rangeChoices(NUM_INPUTS, 'Input ')
	const inputChoicesFriendly = buildInputChoices(self, NUM_INPUTS)
	const buildRotaryKey = (ev) => {
		const surf = ev?.surfaceId || ev?.event?.surfaceId || 'default'
		const ctrl = ev?.controlId || ev?.event?.controlId || null
		return ctrl ? `${surf}::${ctrl}` : null
	}

	// =========================
	// ======= MUTES ===========
	// =========================

	actions['input_mute_control'] = {
		name: 'Inputs: Mute',
		options: [
			{
				type: 'dropdown',
				id: 'operation',
				label: 'Operation',
				default: 'toggle',
				choices: [
					{ id: 'on', label: 'Mute ON' },
					{ id: 'off', label: 'Mute OFF' },
					{ id: 'toggle', label: 'Toggle' },
				],
			},
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Select input(s)',
				default: [],
				choices: inputChoicesFriendly,
				minSelection: 0,
			},
		],
		callback: (e) => {
			if (!self) return
			const op = e.options.operation
			const chs = safeGetChannels(e.options, 'chs', NUM_INPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid input channels selected')
				return
			}
			for (const ch of chs) {
				if (op === 'on' && typeof self._setMute === 'function') self._setMute('input', ch, true)
				else if (op === 'off' && typeof self._setMute === 'function') self._setMute('input', ch, false)
				else if (typeof self._toggleMute === 'function') self._toggleMute('input', ch)
			}
		},
	}

	actions['input_solo'] = {
		name: 'Inputs: Solo',
		options: [
			{
				type: 'dropdown',
				id: 'operation',
				label: 'Operation',
				default: 'toggle',
				choices: [
					{ id: 'on', label: 'Solo ON (unmute selected, mute others)' },
					{ id: 'off', label: 'Solo OFF (unmute all)' },
					{ id: 'toggle', label: 'Toggle' },
				],
			},
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Input(s) to solo',
				default: [],
				choices: inputChoicesFriendly,
				minSelection: 0,
			},
		],
		callback: (e) => {
			if (!self) return
			const op = e.options.operation
			const soloChannels = safeGetChannels(e.options, 'chs', NUM_INPUTS)
			if (soloChannels.length === 0) {
				self.log?.('warn', 'No valid input channels selected for solo')
				return
			}

			const soloSet = new Set(soloChannels)
			const currentSoloState = self.inputSoloState

			// Check if we're toggling the same solo selection
			const isSameSolo =
				currentSoloState &&
				currentSoloState.soloChannels.size === soloSet.size &&
				[...soloSet].every((ch) => currentSoloState.soloChannels.has(ch))

			let shouldApplySolo = false
			if (op === 'on') {
				shouldApplySolo = true
			} else if (op === 'off') {
				shouldApplySolo = false
			} else {
				// toggle
				shouldApplySolo = !isSameSolo
			}

			if (shouldApplySolo) {
				// Apply solo: unmute selected, mute others
				// Preserve original mute states from before the first solo, and keep them when switching solos
				const prevMute =
					(currentSoloState && currentSoloState.prevMute) ||
					(() => {
						const snap = {}
						for (let ch = 1; ch <= NUM_INPUTS; ch++) {
							snap[ch] = !!self?.inMute?.[ch]
						}
						return snap
					})()

				for (let ch = 1; ch <= NUM_INPUTS; ch++) {
					if (soloSet.has(ch)) {
						if (typeof self._setMute === 'function') {
							self._setMute('input', ch, false)
						}
					} else {
						if (typeof self._setMute === 'function') {
							self._setMute('input', ch, true)
						}
					}
				}
				self.inputSoloState = { soloChannels: soloSet, prevMute }
				self.log?.('info', `Soloed input channels: ${soloChannels.join(', ')}`)
			} else {
				// Unsolo: restore previous mute states if known
				const prevMute = currentSoloState?.prevMute || {}
				for (let ch = 1; ch <= NUM_INPUTS; ch++) {
					const shouldMute = prevMute[ch] ?? false
					if (typeof self._setMute === 'function') {
						self._setMute('input', ch, shouldMute)
					}
				}
				self.inputSoloState = null
				self.log?.('info', `Unsolo - restored previous mute states`)
			}

			// Update feedbacks
			if (typeof self.checkFeedbacks === 'function') {
				self.checkFeedbacks('input_muted', 'input_soloed')
			}
		},
	}

	// =========================
	// ======= GAIN ============
	// =========================

	actions['input_gain_set'] = {
		name: 'Input: Gain',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Input channel(s)',
				default: [],
				choices: inputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'dropdown',
				id: 'target',
				label: 'Set to',
				default: 'value',
				choices: [
					{ id: 'value', label: 'Specific dB value' },
					{ id: 'last', label: 'Last dB value' },
					{ id: 'pair', label: 'Toggle between two values' },
					{ id: 'nudge', label: 'Nudge (delta)' },
				],
			},
			{
				type: 'number',
				id: 'gain',
				label: 'Gain (dB)',
				default: 0,
				min: -90,
				max: 10,
				step: 0.1,
				isVisible: (o) => o.target === 'value',
			},
			{
				type: 'dropdown',
				id: 'delta',
				label: 'Delta (dB)',
				default: '0',
				choices: [
					{ id: '-3', label: '-3.0 dB' },
					{ id: '-2.5', label: '-2.5 dB' },
					{ id: '-2', label: '-2.0 dB' },
					{ id: '-1.5', label: '-1.5 dB' },
					{ id: '-1', label: '-1.0 dB' },
					{ id: '-0.5', label: '-0.5 dB' },
					{ id: '0', label: '0.0 dB' },
					{ id: '0.5', label: '+0.5 dB' },
					{ id: '1', label: '+1.0 dB' },
					{ id: '1.5', label: '+1.5 dB' },
					{ id: '2', label: '+2.0 dB' },
					{ id: '2.5', label: '+2.5 dB' },
					{ id: '3', label: '+3.0 dB' },
				],
				isVisible: (o) => o.target === 'nudge',
			},
			{
				type: 'number',
				id: 'gain_a',
				label: 'Gain A (dB)',
				default: 0,
				min: -90,
				max: 10,
				step: 0.1,
				isVisible: (o) => o.target === 'pair',
			},
			{
				type: 'number',
				id: 'gain_b',
				label: 'Gain B (dB)',
				default: -6,
				min: -90,
				max: 10,
				step: 0.1,
				isVisible: (o) => o.target === 'pair',
			},
			{
				type: 'number',
				id: 'fadeMs',
				label: 'Fade duration (ms)',
				default: 0,
				min: 0,
				max: 600000,
				step: 10,
				isVisible: (o) => o.target !== 'nudge',
			},
			{
				type: 'dropdown',
				id: 'curve',
				label: 'Curve (used if fading)',
				default: 'linear',
				choices: [
					{ id: 'linear', label: 'Linear (dB)' },
					{ id: 'log', label: 'Logarithmic' },
				],
				isVisible: (o) => o.target !== 'nudge',
			},
		],
		callback: (e) => {
			if (!self) return
			const chs = safeGetChannels(e.options, 'chs', NUM_INPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid input channels selected')
				return
			}
			const mode =
				e.options.target === 'last' || e.options.target === 'prev'
					? 'last'
					: e.options.target === 'pair'
						? 'pair'
						: e.options.target === 'nudge'
							? 'nudge'
							: 'value'
			const dur = Math.max(0, Number(e.options.fadeMs) || 0)
			const curve = e.options.curve === 'log' ? 'log' : 'linear'
			const btnId = e?.controlId || e?.event?.controlId || null

			if (mode === 'last') {
				for (const ch of chs) {
					const prev = typeof self._getPrevInputGain === 'function' ? self._getPrevInputGain(ch, btnId) : null
					if (prev == null) {
						self.log?.('debug', `Input ch ${ch}: no last dB stored`)
						continue
					}
					if (dur > 0 && typeof self._startInputGainFade === 'function') {
						self._startInputGainFade(ch, prev, dur, curve)
					} else if (typeof self._setInputGain === 'function') {
						self._setInputGain(ch, prev)
					}
				}
				return
			}

			if (mode === 'nudge') {
				const d = Number(e.options.delta)
				const curveNudge = e.options.curve === 'log' ? 'log' : 'linear'
				const durNudge = 0
				for (const ch of chs) {
					if (typeof self._subWrite === 'function') {
						self._subWrite(`/processing/input/${ch}/gain`)
					}
					if (typeof self._beginPrevCaptureWindow === 'function') {
						self._beginPrevCaptureWindow('input', ch, btnId, 300)
					}
					if (typeof self._rememberPrevInputGain === 'function') {
						self._rememberPrevInputGain(ch, btnId)
					}

					const cur = Number(self?.inputGain?.[ch])
					const base = Number.isFinite(cur) ? cur : 0
					const target = base + (Number.isFinite(d) ? d : 0)

					if (durNudge > 0 && typeof self._startInputGainFade === 'function') {
						self._startInputGainFade(ch, target, durNudge, curveNudge)
					} else if (typeof self._setInputGain === 'function') {
						self._setInputGain(ch, target)
					}
				}
				return
			}

			if (mode === 'pair') {
				const gA = Number(e.options.gain_a)
				const gB = Number(e.options.gain_b)
				for (const ch of chs) {
					if (typeof self._subWrite === 'function') {
						self._subWrite(`/processing/input/${ch}/gain`)
					}
					if (!self._inputGainToggle) self._inputGainToggle = {}
					const lastWasA = self._inputGainToggle[ch] === 'A'
					const targetGain = lastWasA ? gB : gA
					self._inputGainToggle[ch] = lastWasA ? 'B' : 'A'

					if (typeof self._beginPrevCaptureWindow === 'function') {
						self._beginPrevCaptureWindow('input', ch, btnId, 300)
					}
					if (typeof self._rememberPrevInputGain === 'function') {
						self._rememberPrevInputGain(ch, btnId)
					}

					if (dur > 0 && typeof self._startInputGainFade === 'function') {
						self._startInputGainFade(ch, targetGain, dur, curve)
					} else if (typeof self._setInputGain === 'function') {
						self._setInputGain(ch, targetGain)
					}
				}
				return
			}

			const g = Number(e.options.gain)
			for (const ch of chs) {
				if (typeof self._subWrite === 'function') {
					self._subWrite(`/processing/input/${ch}/gain`)
				}
				if (typeof self._beginPrevCaptureWindow === 'function') {
					self._beginPrevCaptureWindow('input', ch, btnId, 300)
				}
				if (typeof self._rememberPrevInputGain === 'function') {
					self._rememberPrevInputGain(ch, btnId)
				}
				if (dur > 0 && typeof self._startInputGainFade === 'function') {
					self._startInputGainFade(ch, g, dur, curve)
				} else if (typeof self._setInputGain === 'function') {
					self._setInputGain(ch, g)
				}
			}
		},
	}

	// =========================
	// ======= DELAY ===========
	// =========================

	actions['input_delay_set'] = {
		name: 'Input: Delay',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Input channel(s)',
				default: [],
				choices: inputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'dropdown',
				id: 'type',
				label: 'Delay type (unit)',
				default: 'unchanged',
				choices: [
					{ id: 'unchanged', label: '— Unchanged —' },
					{ id: '0', label: 'milliseconds' },
					{ id: '1', label: 'feet' },
					{ id: '2', label: 'meters' },
					{ id: '3', label: 'frames (24fps)' },
					{ id: '4', label: 'frames (25fps)' },
					{ id: '5', label: 'frames (30fps)' },
					{ id: '6', label: 'samples (96kHz)' },
				],
			},
			{
				type: 'number',
				id: 'value',
				label: 'Delay value (uses unit above)',
				default: 0,
				min: 0,
				max: 500,
				step: 0.01,
				isVisible: (o) => o.type !== 'unchanged',
			},
		],
		callback: (e) => {
			if (!self) return
			const chs = safeGetChannels(e.options, 'chs', NUM_INPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid input channels selected')
				return
			}
			const typeId = String(e.options.type || 'unchanged')
			const valueRaw = Number(e.options.value)
			const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
			const roundTo01 = (v) => Math.round(v / 0.01) * 0.01

			const valueToMs = (val, typeKey) => {
				const n = Number(val)
				if (!Number.isFinite(n)) return 0
				const SPEED_FT_PER_SEC = 1125
				const SPEED_M_PER_SEC = 343
				switch (typeKey) {
					case '1': // feet
						return (n * 1000) / SPEED_FT_PER_SEC
					case '2': // meters
						return (n * 1000) / SPEED_M_PER_SEC
					case '3': // frames 24 fps
						return (n / 24) * 1000
					case '4': // frames 25 fps
						return (n / 25) * 1000
					case '5': // frames 30 fps
						return (n / 30) * 1000
					case '6': // samples (96kHz)
						return n / 96
					case '0': // milliseconds
					default:
						return n
				}
			}

			for (const ch of chs) {
				if (typeId === 'unchanged') {
					continue
				}
				const msFromValue = valueToMs(valueRaw, typeId === 'unchanged' ? '0' : typeId)
				const targetMs = roundTo01(clamp(msFromValue, 0, 500))

				if (typeof self._setInputDelayMs === 'function') {
					self._setInputDelayMs(ch, targetMs)
				} else if (typeof self._cmdSendLine === 'function') {
					const samples = Math.round(targetMs * 96)
					self._cmdSendLine(`/processing/input/${ch}/delay=${samples}`)
					if (typeof self._applyInputDelay === 'function') {
						self._applyInputDelay(ch, samples)
					}
				}
			}
		},
	}

	// =========================
	// ==== LINK GROUPS ========
	// =========================
	// NOTE: Inputs support 4 link groups (1-4)

	actions['input_link_group_bypass'] = {
		name: 'Input: Link Group Bypass',
		options: [
			{
				type: 'dropdown',
				id: 'operation',
				label: 'Operation',
				default: 'toggle',
				choices: [
					{ id: 'on', label: 'Bypass ON' },
					{ id: 'off', label: 'Bypass OFF' },
					{ id: 'toggle', label: 'Toggle' },
				],
			},
			{
				type: 'multidropdown',
				id: 'groups',
				label: 'Link Group(s)',
				default: [],
				choices: [
					{ id: '1', label: 'Link Group 1' },
					{ id: '2', label: 'Link Group 2' },
					{ id: '3', label: 'Link Group 3' },
					{ id: '4', label: 'Link Group 4' },
				],
				minSelection: 0,
			},
		],
		callback: (e) => {
			if (!self) return
			const op = e.options.operation
			const groups = Array.isArray(e.options.groups)
				? e.options.groups.map((g) => Number(g)).filter((g) => g >= 1 && g <= 4)
				: []

			if (groups.length === 0) {
				self.log?.('warn', 'No valid input link groups selected')
				return
			}

			for (const group of groups) {
				const currentBypass = self?.inputLinkGroupBypass?.[group]
				let targetBypass = false

				if (op === 'on') {
					targetBypass = true
				} else if (op === 'off') {
					targetBypass = false
				} else {
					targetBypass = currentBypass !== true
				}

				const value = targetBypass ? 'true' : 'false'
				self._cmdSendLine(`/device/input_link_group/${group}/bypass='${value}'`)

				// Update local state
				if (!self.inputLinkGroupBypass) self.inputLinkGroupBypass = {}
				self.inputLinkGroupBypass[group] = targetBypass

				self.log?.('info', `Input Link Group ${group} bypass: ${value}`)
			}

			if (typeof self.checkFeedbacks === 'function') {
				self.checkFeedbacks('input_link_group_bypassed')
			}
		},
	}

	actions['input_link_group_assign'] = {
		name: 'Input: Assign to Link Group',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Input Channel(s)',
				default: [],
				choices: inputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'dropdown',
				id: 'link_group',
				label: 'Link Group',
				default: '0',
				choices: [
					{ id: '0', label: 'Unassign' },
					{ id: '1', label: 'Link Group 1' },
					{ id: '2', label: 'Link Group 2' },
					{ id: '3', label: 'Link Group 3' },
					{ id: '4', label: 'Link Group 4' },
				],
			},
		],
		callback: (e) => {
			if (!self) return

			const channels = e.options.chs || []
			const linkGroup = String(e.options.link_group || '0')

			for (const ch of channels) {
				const chNum = Number(ch)
				if (chNum < 1 || chNum > NUM_INPUTS) continue

				self._cmdSendLine(`/device/input/${chNum}/input_link_group=${linkGroup}`)

				// Update local state
				if (!self.inputLinkGroupAssign) self.inputLinkGroupAssign = {}
				self.inputLinkGroupAssign[chNum] = Number(linkGroup)

				const groupLabel = linkGroup === '0' ? 'Unassigned' : `Link Group ${linkGroup}`
				self.log?.('info', `Input ${chNum} assigned to: ${groupLabel}`)
			}

			if (typeof self.checkFeedbacks === 'function') {
				self.checkFeedbacks('input_link_group_assigned')
			}
		},
	}

	// =========================
	// ==== U-SHAPING EQ =======
	// =========================

	actions['input_ushaping_adjust'] = {
		name: 'Input: U-Shaping EQ',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Input channel(s)',
				default: [],
				choices: inputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'dropdown',
				id: 'band',
				label: 'Band',
				default: '1',
				choices: [
					{ id: '1', label: 'Band 1 (62 Hz)' },
					{ id: '2', label: 'Band 2 (250 Hz)' },
					{ id: '3', label: 'Band 3 (1 kHz)' },
					{ id: '4', label: 'Band 4 (4 kHz)' },
					{ id: '5', label: 'Band 5 (HF)' },
				],
			},
			{
				type: 'dropdown',
				id: 'param',
				label: 'Parameter',
				default: 'gain',
				choices: [
					{ id: 'gain', label: 'Gain' },
					{ id: 'frequency', label: 'Frequency' },
					{ id: 'slope', label: 'Slope' },
				],
			},
			{
				type: 'dropdown',
				id: 'mode',
				label: 'Mode',
				default: 'set',
				choices: [
					{ id: 'set', label: 'Set to value' },
					{ id: 'adjust', label: 'Adjust by delta (for knobs)' },
				],
			},
			{
				type: 'number',
				id: 'gain_value',
				label: 'Gain (dB)',
				default: 0,
				min: -18,
				max: 18,
				step: 0.1,
				isVisible: (o) => o.param === 'gain' && o.mode === 'set',
			},
			{
				type: 'number',
				id: 'gain_delta',
				label: 'Gain delta (dB)',
				default: 0.5,
				min: -18,
				max: 18,
				step: 0.1,
				isVisible: (o) => o.param === 'gain' && o.mode === 'adjust',
			},
			{
				type: 'number',
				id: 'frequency_value',
				label: 'Frequency (Hz)',
				default: 1000,
				min: 10,
				max: 20000,
				step: 1,
				isVisible: (o) => o.param === 'frequency' && o.mode === 'set' && o.band !== '5',
			},
			{
				type: 'number',
				id: 'frequency_delta',
				label: 'Frequency delta (Hz)',
				default: 10,
				min: -1000,
				max: 1000,
				step: 1,
				isVisible: (o) => o.param === 'frequency' && o.mode === 'adjust' && o.band !== '5',
			},
			{
				type: 'number',
				id: 'slope_value',
				label: 'Slope',
				default: 1,
				min: 0.1,
				max: 2,
				step: 0.1,
				isVisible: (o) => o.param === 'slope' && o.mode === 'set' && o.band !== '5',
			},
			{
				type: 'number',
				id: 'slope_delta',
				label: 'Slope delta',
				default: 0.1,
				min: -2,
				max: 2,
				step: 0.1,
				isVisible: (o) => o.param === 'slope' && o.mode === 'adjust' && o.band !== '5',
			},
			{
				type: 'static-text',
				id: 'band5_note',
				label: 'Note',
				value: 'Band 5 (HF) only has gain parameter',
				isVisible: (o) => o.band === '5' && o.param !== 'gain',
			},
		],
		callback: (e) => {
			if (!self || typeof self._cmdSendLine !== 'function') return
			const chs = safeGetChannels(e.options, 'chs', NUM_INPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid input channels selected')
				return
			}

			const band = Number(e.options.band)
			const param = e.options.param
			const mode = e.options.mode

			// Band 5 only supports gain
			if (band === 5 && param !== 'gain') {
				self.log?.('warn', 'Band 5 only supports gain parameter')
				return
			}

			for (const ch of chs) {
				let finalValue

				if (mode === 'adjust') {
					// Get current value and adjust it
					let currentValue = 0
					if (param === 'gain') {
						currentValue = Number(self?.inputUShaping?.[ch]?.[band]?.gain ?? 0)
						const delta = Number(e.options.gain_delta ?? 0)
						finalValue = Math.max(-18, Math.min(18, currentValue + delta))
					} else if (param === 'frequency') {
						currentValue = Number(self?.inputUShaping?.[ch]?.[band]?.frequency ?? 1000)
						const delta = Number(e.options.frequency_delta ?? 0)
						finalValue = Math.max(10, Math.min(20000, currentValue + delta))
					} else if (param === 'slope') {
						currentValue = Number(self?.inputUShaping?.[ch]?.[band]?.slope ?? 1)
						const delta = Number(e.options.slope_delta ?? 0)
						finalValue = Math.max(0.1, Math.min(2, currentValue + delta))
					}
				} else {
					// Set to absolute value
					if (param === 'gain') {
						finalValue = Math.max(-18, Math.min(18, Number(e.options.gain_value ?? 0)))
					} else if (param === 'frequency') {
						finalValue = Math.max(10, Math.min(20000, Number(e.options.frequency_value ?? 1000)))
					} else if (param === 'slope') {
						finalValue = Math.max(0.1, Math.min(2, Number(e.options.slope_value ?? 1)))
					}
				}

				// Send the command
				self._cmdSendLine(`/processing/input/${ch}/ushaping/${band}/${param}=${finalValue}`)

				// Update internal state if available
				if (typeof self._applyInputUShaping === 'function') {
					self._applyInputUShaping(ch, band, param, finalValue)
				}

				self.log?.('info', `Input ch ${ch}: U-Shaping band ${band} ${param} = ${finalValue}`)
			}
		},
	}

	// Chingonizer: symmetric U-Shaping control (bands 1-4 freq/slope, bands 1/5 mirrored gain)
	actions['input_ushaping_chingonizer'] = {
		name: 'Inputs: Chingonizer (U-Shaping Symmetry)',
		description:
			'Set the same center frequency for bands 1-4, mirror gain between bands 1 and 5 (inverted on 5), and set slope to 1 on bands 1-4.',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Input channel(s)',
				default: [],
				choices: inputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'number',
				id: 'frequency',
				label: 'Center frequency for bands 1-4 (Hz)',
				default: 1000,
				min: 160,
				max: 2500,
				step: 1,
			},
			{
				type: 'number',
				id: 'gain',
				label: 'Band 1 gain (Band 5 gets inverted)',
				default: 3,
				min: -18,
				max: 18,
				step: 0.1,
			},
		],
		callback: (e) => {
			if (!self || typeof self._cmdSendLine !== 'function') return

			const chs = safeGetChannels(e.options, 'chs', NUM_INPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid input channels selected')
				return
			}

			const freqRaw = Number(e.options.frequency ?? 1000)
			const freq = Math.max(160, Math.min(2500, freqRaw))

			const gainRaw = Number(e.options.gain ?? 0)
			const band1Gain = Math.max(-18, Math.min(18, gainRaw))
			const band5Gain = Math.max(-18, Math.min(18, -band1Gain))

			const slopeValue = 1

			for (const ch of chs) {
				// Frequencies and slopes for bands 1-4
				for (let band = 1; band <= 4; band++) {
					self._cmdSendLine(`/processing/input/${ch}/ushaping/${band}/frequency=${freq}`)
					self._cmdSendLine(`/processing/input/${ch}/ushaping/${band}/slope=${slopeValue}`)

					if (typeof self._applyInputUShaping === 'function') {
						self._applyInputUShaping(ch, band, 'frequency', freq)
						self._applyInputUShaping(ch, band, 'slope', slopeValue)
					}
				}

				// Mirrored gains for bands 1 and 5
				self._cmdSendLine(`/processing/input/${ch}/ushaping/1/gain=${band1Gain}`)
				self._cmdSendLine(`/processing/input/${ch}/ushaping/5/gain=${band5Gain}`)

				if (typeof self._applyInputUShaping === 'function') {
					self._applyInputUShaping(ch, 1, 'gain', band1Gain)
					self._applyInputUShaping(ch, 5, 'gain', band5Gain)
				}

				const name = self?.inputName?.[ch] ? ` (${self.inputName[ch]})` : ''
				self.log?.(
					'info',
					`Chingonizer: Input ${ch}${name} freq=${freq}Hz slope=${slopeValue} (bands 1-4) gain1=${band1Gain}dB gain5=${band5Gain}dB`,
				)
			}
		},
	}

	actions['input_ushaping_bypass'] = {
		name: 'Input: U-Shaping Bypass',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Input channel(s)',
				default: [],
				choices: inputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'dropdown',
				id: 'operation',
				label: 'Operation',
				default: 'toggle',
				choices: [
					{ id: 'on', label: 'Enabled' },
					{ id: 'off', label: 'Bypass' },
					{ id: 'toggle', label: 'Toggle' },
				],
			},
		],
		callback: (e) => {
			if (!self || typeof self._cmdSendLine !== 'function') return
			const chs = safeGetChannels(e.options, 'chs', NUM_INPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid input channels selected')
				return
			}

			const op = String(e.options.operation || 'toggle')

			for (const ch of chs) {
				let state
				if (op === 'toggle') {
					const current = self?.inputUShaping?.[ch]?.bypass
					const currentBool =
						typeof current === 'boolean' ? current : /^(true|1|on)$/i.test(String(current ?? '').trim())
					state = !currentBool
				} else {
					const enable = op === 'on'
					state = !enable
				}

				self._cmdSendLine(`/processing/input/${ch}/ushaping/bypass=${state ? 'true' : 'false'}`)

				if (typeof self._applyInputUShapingBypass === 'function') {
					self._applyInputUShapingBypass(ch, state)
				}

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`input_${ch}_ushaping_bypass`]: state ? 'ON' : 'OFF',
					})
				}

				self.log?.('info', `Input ch ${ch}: U-Shaping bypass ${state ? 'ON' : 'OFF'}`)
			}
		},
	}

	// U-Shaping Knob Control System - Selection Actions
	actions['input_ushaping_select_input'] = {
		name: 'Input: U-Shaping Select Input Channel(s)',
		description: 'Select which input channel(s) the U-Shaping knobs will control (can select multiple to link them)',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Input channel(s)',
				default: ['1'],
				choices: inputChoicesFriendly,
				minSelection: 0,
			},
		],
		callback: (e) => {
			if (!self) return
			const chs = safeGetChannels(e.options, 'chs', NUM_INPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid input channels selected')
				return
			}

			// Store the selected input channels (array)
			if (!self._ushapingKnobControl) self._ushapingKnobControl = {}
			self._ushapingKnobControl.selectedInputs = chs

			// Update variable
			if (typeof self.setVariableValues === 'function') {
				const names = chs
					.map((ch) => {
						const name = self?.inputName?.[ch]
						return name ? `${ch} (${name})` : `${ch}`
					})
					.join(', ')

				self.setVariableValues({
					ushaping_selected_input: names,
					ushaping_selected_input_num: chs.join(','),
				})

				// Update dynamic current value variables
				if (typeof self._updateUShapingCurrentValues === 'function') {
					self._updateUShapingCurrentValues()
				}
			}

			// Update feedbacks
			if (typeof self.checkFeedbacks === 'function') {
				self.checkFeedbacks('ushaping_input_selected')
			}

			const channelList = chs
				.map((ch) => {
					const name = self?.inputName?.[ch]
					return name ? `${ch} (${name})` : `${ch}`
				})
				.join(', ')

			self.log?.('info', `U-Shaping: Selected input(s): ${channelList}`)
		},
	}

	actions['input_ushaping_select_band'] = {
		name: 'Input: U-Shaping Select Band',
		description: 'Select which band (1-5) the U-Shaping knobs will control',
		options: [
			{
				type: 'dropdown',
				id: 'band',
				label: 'Band',
				default: '1',
				choices: [
					{ id: '1', label: 'Input U-Shaping Band 1' },
					{ id: '2', label: 'Input U-Shaping Band 2' },
					{ id: '3', label: 'Input U-Shaping Band 3' },
					{ id: '4', label: 'Input U-Shaping Band 4' },
					{ id: '5', label: 'Input U-Shaping Band 5' },
				],
			},
		],
		callback: (e) => {
			if (!self) return
			const band = Number(e.options.band)
			if (!Number.isFinite(band) || band < 1 || band > 5) {
				self.log?.('warn', `Invalid band: ${e.options.band}`)
				return
			}

			// Store the selected band
			if (!self._ushapingKnobControl) self._ushapingKnobControl = {}
			self._ushapingKnobControl.selectedBand = band

			// Update variable
			if (typeof self.setVariableValues === 'function') {
				const bandLabels = {
					1: 'Input U-Shaping Band 1',
					2: 'Input U-Shaping Band 2',
					3: 'Input U-Shaping Band 3',
					4: 'Input U-Shaping Band 4',
					5: 'Input U-Shaping Band 5',
				}
				self.setVariableValues({
					ushaping_selected_band: bandLabels[band],
					ushaping_selected_band_num: band,
				})

				// Update dynamic current value variables
				if (typeof self._updateUShapingCurrentValues === 'function') {
					self._updateUShapingCurrentValues()
				}
			}

			// Update feedbacks
			if (typeof self.checkFeedbacks === 'function') {
				self.checkFeedbacks('ushaping_band_selected')
			}

			const bandNames = ['', '20-2500 Hz', '40-5000 Hz', '80-10k Hz', '160-20k Hz', 'HF (no freq)']
			self.log?.('info', `U-Shaping: Selected Band ${band} (${bandNames[band]})`)
		},
	}

	// Chingonizer knob controls (mirrored gain + shared frequency for bands 1-4)
	actions['input_ushaping_chingonizer_knob_gain'] = {
		name: 'Input: Chingonizer Knob - Gain (Band1/Band5 mirrored)',
		description:
			'Adjust Band 1 gain and apply inverted gain to Band 5 for selected input(s). Supports fine/coarse mode when the rotary is pressed.',
		options: [
			{
				type: 'static-text',
				id: 'info',
				label: 'Selection',
				value: 'Uses currently selected input channel(s). Band 1 gain is mirrored (inverted) to Band 5.',
			},
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Input channel(s) (optional override)',
				default: [],
				choices: inputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'number',
				id: 'delta_fine',
				label: 'Gain delta fine (dB)',
				default: 0.1,
				min: -15,
				max: 15,
				step: 0.1,
			},
			{
				type: 'number',
				id: 'delta_coarse',
				label: 'Gain delta coarse (dB)',
				default: 0.5,
				min: -15,
				max: 15,
				step: 0.1,
			},
		],
		callback: (e) => {
			if (!self || typeof self._cmdSendLine !== 'function') return

			const overrideChs = safeGetChannels(e.options, 'chs', NUM_INPUTS)
			const chs = overrideChs.length > 0 ? overrideChs : self?._ushapingKnobControl?.selectedInputs || [1]
			const key = buildRotaryKey(e)
			const isCoarse = key && self._rotaryPressState?.[key]

			let base = Number(isCoarse ? e.options.delta_coarse : e.options.delta_fine)
			if (!Number.isFinite(base) || base === 0) base = 0.1

			let sign = base >= 0 ? 1 : -1
			if (typeof e?.encoder_delta === 'number' && e.encoder_delta !== 0) {
				sign = e.encoder_delta > 0 ? 1 : -1
			}
			const baseMag = Math.abs(base)
			let delta = baseMag * sign

			// Initialize storage if needed
			if (!self.inputUShaping) self.inputUShaping = {}

			for (const ch of chs) {
				if (!self.inputUShaping[ch]) self.inputUShaping[ch] = {}
				if (!self.inputUShaping[ch][1]) self.inputUShaping[ch][1] = {}
				if (!self.inputUShaping[ch][5]) self.inputUShaping[ch][5] = {}

				const currentGain = Number(self.inputUShaping[ch][1].gain ?? 0)
				const newGain = Math.max(-18, Math.min(18, currentGain + delta))
				const mirroredGain = Math.max(-18, Math.min(18, -newGain))

				self._cmdSendLine(`/processing/input/${ch}/ushaping/1/gain=${newGain}`)
				self._cmdSendLine(`/processing/input/${ch}/ushaping/5/gain=${mirroredGain}`)

				if (typeof self._applyInputUShaping === 'function') {
					self._applyInputUShaping(ch, 1, 'gain', newGain)
					self._applyInputUShaping(ch, 5, 'gain', mirroredGain)
				}

				const inputName = self?.inputName?.[ch] ? ` (${self.inputName[ch]})` : ''
				const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)
				const modeLabel = isCoarse ? 'coarse' : 'fine'
				self.log?.(
					'info',
					`Chingonizer (${modeLabel}): Input ${ch}${inputName} Band1 gain ${currentGain.toFixed(1)} ${deltaStr} = ${newGain.toFixed(1)} dB; Band5 gain ${mirroredGain.toFixed(1)} dB`,
				)
			}

			if (typeof self._updateUShapingCurrentValues === 'function') {
				self._updateUShapingCurrentValues()
			}
		},
	}

	actions['input_ushaping_chingonizer_knob_frequency'] = {
		name: 'Input: Chingonizer Knob - Frequency (Bands 1-4)',
		description:
			'Adjust shared center frequency for bands 1-4 (160-2500 Hz). Supports fine/coarse mode when the rotary is pressed.',
		options: [
			{
				type: 'static-text',
				id: 'info',
				label: 'Selection',
				value: 'Uses currently selected input channel(s). Band 5 has no frequency parameter.',
			},
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Input channel(s) (optional override)',
				default: [],
				choices: inputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'number',
				id: 'delta_fine',
				label: 'Frequency delta fine (Hz)',
				default: 10,
				min: -1000,
				max: 1000,
				step: 1,
			},
			{
				type: 'number',
				id: 'delta_coarse',
				label: 'Frequency delta coarse (Hz)',
				default: 50,
				min: -1000,
				max: 1000,
				step: 1,
			},
		],
		callback: (e) => {
			if (!self || typeof self._cmdSendLine !== 'function') return

			const overrideChs = safeGetChannels(e.options, 'chs', NUM_INPUTS)
			const chs = overrideChs.length > 0 ? overrideChs : self?._ushapingKnobControl?.selectedInputs || [1]
			const key = buildRotaryKey(e)
			const isCoarse = key && self._rotaryPressState?.[key]

			let base = Number(isCoarse ? e.options.delta_coarse : e.options.delta_fine)
			if (!Number.isFinite(base) || base === 0) base = 10

			let sign = base >= 0 ? 1 : -1
			if (typeof e?.encoder_delta === 'number' && e.encoder_delta !== 0) {
				sign = e.encoder_delta > 0 ? 1 : -1
			}
			const baseMag = Math.abs(base)
			let delta = baseMag * sign

			// Initialize storage if needed
			if (!self.inputUShaping) self.inputUShaping = {}

			for (const ch of chs) {
				if (!self.inputUShaping[ch]) self.inputUShaping[ch] = {}
				if (!self.inputUShaping[ch][1]) self.inputUShaping[ch][1] = {}

				const currentFreq = Number(self.inputUShaping[ch][1].frequency ?? 1000)
				const newFreq = Math.max(160, Math.min(2500, currentFreq + delta))

				for (let band = 1; band <= 4; band++) {
					if (!self.inputUShaping[ch][band]) self.inputUShaping[ch][band] = {}

					self._cmdSendLine(`/processing/input/${ch}/ushaping/${band}/frequency=${newFreq}`)

					if (typeof self._applyInputUShaping === 'function') {
						self._applyInputUShaping(ch, band, 'frequency', newFreq)
					}
				}

				const inputName = self?.inputName?.[ch] ? ` (${self.inputName[ch]})` : ''
				const deltaStr = delta >= 0 ? `+${delta}` : delta
				const modeLabel = isCoarse ? 'coarse' : 'fine'
				self.log?.(
					'info',
					`Chingonizer (${modeLabel}): Input ${ch}${inputName} bands 1-4 frequency ${currentFreq} ${deltaStr} = ${newFreq} Hz`,
				)
			}

			if (typeof self._updateUShapingCurrentValues === 'function') {
				self._updateUShapingCurrentValues()
			}
		},
	}

	actions['input_ushaping_chingonizer_freq_coarse_mode'] = {
		name: 'Input: Chingonizer Frequency Coarse Mode',
		description: 'Use with the Chingonizer frequency knob; press/hold/toggle to switch between fine and coarse steps.',
		options: [
			{
				type: 'dropdown',
				id: 'mode',
				label: 'Mode',
				default: 'toggle',
				choices: [
					{ id: 'press', label: 'Press (coarse ON)' },
					{ id: 'release', label: 'Release (coarse OFF)' },
					{ id: 'toggle', label: 'Toggle coarse' },
				],
			},
		],
		callback: (e) => {
			if (!self) return
			const key = buildRotaryKey(e)
			if (!key) {
				self.log?.('warn', 'Chingonizer freq coarse mode: no controlId/surfaceId available')
				return
			}
			if (!self._rotaryPressState) self._rotaryPressState = {}

			const op = e.options.mode
			if (op === 'press') {
				self._rotaryPressState[key] = true
			} else if (op === 'release') {
				delete self._rotaryPressState[key]
			} else {
				self._rotaryPressState[key] = !self._rotaryPressState[key]
				if (!self._rotaryPressState[key]) delete self._rotaryPressState[key]
			}
		},
	}

	actions['input_ushaping_chingonizer_gain_coarse_mode'] = {
		name: 'Input: Chingonizer Gain Coarse Mode',
		description: 'Use with the gain knob; press/hold/toggle to switch between fine and coarse steps.',
		options: [
			{
				type: 'dropdown',
				id: 'mode',
				label: 'Mode',
				default: 'toggle',
				choices: [
					{ id: 'press', label: 'Press (coarse ON)' },
					{ id: 'release', label: 'Release (coarse OFF)' },
					{ id: 'toggle', label: 'Toggle coarse' },
				],
			},
		],
		callback: (e) => {
			if (!self) return
			const key = buildRotaryKey(e)
			if (!key) {
				self.log?.('warn', 'Chingonizer coarse mode: no controlId/surfaceId available')
				return
			}
			if (!self._rotaryPressState) self._rotaryPressState = {}

			const op = e.options.mode
			if (op === 'press') {
				self._rotaryPressState[key] = true
			} else if (op === 'release') {
				delete self._rotaryPressState[key]
			} else {
				self._rotaryPressState[key] = !self._rotaryPressState[key]
				if (!self._rotaryPressState[key]) delete self._rotaryPressState[key]
			}
		},
	}

	actions['input_ushaping_chingonizer_knob_slope'] = {
		name: 'Input: Chingonizer Knob - Slope (Bands 1-4)',
		description: 'Adjust slope (1-6) for bands 1-4 together for the selected input(s).',
		options: [
			{
				type: 'static-text',
				id: 'info',
				label: 'Selection',
				value: 'Uses currently selected input channel(s). Band 5 has no slope in this mode.',
			},
			{
				type: 'dropdown',
				id: 'direction',
				label: 'Direction - for button press',
				default: 'up',
				choices: [
					{ id: 'up', label: 'Increase' },
					{ id: 'down', label: 'Decrease' },
				],
			},
		],
		callback: (e) => {
			if (!self || typeof self._cmdSendLine !== 'function') return

			const chs = self?._ushapingKnobControl?.selectedInputs || [1]
			let direction = e.options.direction || 'up'
			let stepCount = 1

			// Try to honor encoder direction if provided by Companion
			if (typeof e?.encoder_delta === 'number' && e.encoder_delta < 0) direction = 'down'
			if (typeof e?.encoder_delta === 'number' && e.encoder_delta > 0) direction = 'up'

			// Time-based acceleration for rotary encoders
			if (e.surfaceId !== undefined) {
				const now = Date.now()
				const accelKey = `chingonizer_slope_${e.surfaceId || 'default'}`

				if (!self._rotaryAccel) self._rotaryAccel = {}

				const lastRotation = self._rotaryAccel[accelKey] || { time: 0, count: 0 }
				const timeDiff = now - lastRotation.time

				let speedTier = 0
				if (timeDiff < 100) {
					speedTier = Math.min(lastRotation.count + 1, 3)
				}

				self._rotaryAccel[accelKey] = { time: now, count: speedTier }

				// Gentle acceleration across the small 1-4 range
				const stepTiers = [1, 1, 2, 3]
				stepCount = stepTiers[speedTier]
			}

			// Initialize storage if needed
			if (!self.inputUShaping) self.inputUShaping = {}

			for (const ch of chs) {
				if (!self.inputUShaping[ch]) self.inputUShaping[ch] = {}
				if (!self.inputUShaping[ch][1]) self.inputUShaping[ch][1] = {}

				const currentSlope = Math.max(1, Math.min(6, Number(self.inputUShaping[ch][1].slope ?? 1)))
				let newSlope =
					direction === 'up' ? Math.min(6, currentSlope + stepCount) : Math.max(1, currentSlope - stepCount)

				for (let band = 1; band <= 4; band++) {
					if (!self.inputUShaping[ch][band]) self.inputUShaping[ch][band] = {}

					self._cmdSendLine(`/processing/input/${ch}/ushaping/${band}/slope=${newSlope}`)

					if (typeof self._applyInputUShaping === 'function') {
						self._applyInputUShaping(ch, band, 'slope', newSlope)
					}
				}

				const inputName = self?.inputName?.[ch] ? ` (${self.inputName[ch]})` : ''
				self.log?.(
					'info',
					`Chingonizer: Input ${ch}${inputName} bands 1-4 slope ${currentSlope} -> ${newSlope}`,
				)
			}

			if (typeof self._updateUShapingCurrentValues === 'function') {
				self._updateUShapingCurrentValues()
			}
		},
	}

	// U-Shaping Knob Control System - Knob Actions
	actions['input_ushaping_knob_gain'] = {
		name: 'Input: U-Shaping Knob - Gain',
		description: 'Adjust gain for the selected input(s) and band. Acceleration (3 tiers): 0.1 → 0.3 → 0.5 dB.',
		options: [
			{
				type: 'static-text',
				id: 'info',
				label: 'Selection',
				value: 'Uses currently selected input channel(s) and band. Use selection buttons to choose.',
			},
			{
				type: 'number',
				id: 'delta',
				label: 'Gain delta (dB) - for button press',
				default: 0.5,
				min: -15,
				max: 15,
				step: 0.1,
			},
		],
		callback: (e) => {
			if (!self || typeof self._cmdSendLine !== 'function') return

			const chs = self?._ushapingKnobControl?.selectedInputs || [1]
			const band = self?._ushapingKnobControl?.selectedBand || 1
			let delta = Number(e.options.delta ?? 0)

			// Time-based acceleration for rotary encoders
			if (e.surfaceId !== undefined) {
				const now = Date.now()
				const accelKey = `ushaping_gain_${e.surfaceId || 'default'}`

				if (!self._rotaryAccel) self._rotaryAccel = {}

				const lastRotation = self._rotaryAccel[accelKey] || { time: 0, count: 0 }
				const timeDiff = now - lastRotation.time

				// 4-tier acceleration based on rotation speed
				let speedTier = 0
				if (timeDiff < 100) {
					speedTier = Math.min(lastRotation.count + 1, 3)
				}

				self._rotaryAccel[accelKey] = { time: now, count: speedTier }

				// Acceleration tiers: 0 = 0.1dB, 1 = 0.5dB, 2 = 1dB, 3 = 2dB (faster)
				const deltaTiers = [0.1, 0.5, 1.0, 2.0]
				delta = deltaTiers[speedTier] * (delta >= 0 ? 1 : -1)
			}

			// Initialize storage if needed
			if (!self.inputUShaping) self.inputUShaping = {}

			for (const ch of chs) {
				if (!self.inputUShaping[ch]) self.inputUShaping[ch] = {}
				if (!self.inputUShaping[ch][band]) self.inputUShaping[ch][band] = {}

				const currentValue = Number(self.inputUShaping[ch][band].gain ?? 0)
				const newValue = currentValue + delta
				const finalValue = Math.max(-15, Math.min(15, newValue))

				// Update internal state
				self.inputUShaping[ch][band].gain = finalValue

				self._cmdSendLine(`/processing/input/${ch}/ushaping/${band}/gain=${finalValue}`)

				if (typeof self._applyInputUShaping === 'function') {
					self._applyInputUShaping(ch, band, 'gain', finalValue)
				}

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`input_${ch}_ushaping_band${band}_gain`]: finalValue.toFixed(1),
					})
				}

				const inputName = self?.inputName?.[ch] ? ` (${self.inputName[ch]})` : ''
				const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)
				self.log?.(
					'info',
					`U-Shaping: Input ${ch}${inputName} Band ${band} gain ${currentValue.toFixed(1)} ${deltaStr} = ${finalValue.toFixed(1)} dB`,
				)
			}

			// Immediately update dynamic current value display
			if (typeof self._updateUShapingCurrentValues === 'function') {
				self._updateUShapingCurrentValues()
			}
		},
	}

	actions['input_ushaping_knob_frequency'] = {
		name: 'Input: U-Shaping Knob - Frequency',
		description:
			'Adjust frequency for the selected input(s) and band (B1: 20-2500Hz, B2: 40-5000Hz, B3: 80-10kHz, B4: 160-20kHz). Octave-based acceleration adapts to current frequency for natural control.',
		options: [
			{
				type: 'static-text',
				id: 'info',
				label: 'Selection',
				value: 'Uses currently selected input channel(s) and band. Band 5 (HF) does not have frequency.',
			},
			{
				type: 'number',
				id: 'delta',
				label: 'Frequency delta (Hz) - for button press',
				default: 10,
				min: -1000,
				max: 1000,
				step: 1,
			},
		],
		callback: (e) => {
			if (!self || typeof self._cmdSendLine !== 'function') return

			const chs = self?._ushapingKnobControl?.selectedInputs || [1]
			const band = self?._ushapingKnobControl?.selectedBand || 1

			// Band 5 doesn't have frequency
			if (band === 5) {
				self.log?.('warn', 'U-Shaping: Band 5 (HF) does not have frequency parameter')
				return
			}

			// Band-specific frequency ranges
			const freqRanges = {
				1: { min: 20, max: 2500, default: 62 },
				2: { min: 40, max: 5000, default: 250 },
				3: { min: 80, max: 10000, default: 1000 },
				4: { min: 160, max: 20000, default: 4000 },
			}
			const range = freqRanges[band] || { min: 20, max: 20000, default: 1000 }

			// Initialize storage if needed
			if (!self.inputUShaping) self.inputUShaping = {}

			for (const ch of chs) {
				if (!self.inputUShaping[ch]) self.inputUShaping[ch] = {}
				if (!self.inputUShaping[ch][band]) self.inputUShaping[ch][band] = {}

				const currentValue = Number(self.inputUShaping[ch][band].frequency ?? range.default)
				let delta = Number(e.options.delta ?? 0)

				// Time-based acceleration for rotary encoders with range-based tiers
				if (e.surfaceId !== undefined) {
					const now = Date.now()
					const accelKey = `ushaping_freq_${e.surfaceId || 'default'}`

					if (!self._rotaryAccel) self._rotaryAccel = {}

					const lastRotation = self._rotaryAccel[accelKey] || { time: 0, count: 0 }
					const timeDiff = now - lastRotation.time

					// 4-tier acceleration based on rotation speed
					let speedTier = 0
					if (timeDiff < 100) {
						speedTier = Math.min(lastRotation.count + 1, 3)
					}

					self._rotaryAccel[accelKey] = { time: now, count: speedTier }

					// Octave-based acceleration tiers based on CURRENT frequency (4 tiers: 0, 1, 2, 3)
					// Organized by octave ranges for better musical/logarithmic control
					let deltaTiers
					if (currentValue < 31) {
						// 10-31 Hz (sub-bass): 0.5, 1, 2, 4 (faster)
						deltaTiers = [0.5, 1, 2, 4]
					} else if (currentValue < 63) {
						// 31-63 Hz: 1, 2, 5, 10 (faster)
						deltaTiers = [1, 2, 5, 10]
					} else if (currentValue < 125) {
						// 63-125 Hz: 2, 5, 10, 20 (faster)
						deltaTiers = [2, 5, 10, 20]
					} else if (currentValue < 250) {
						// 125-250 Hz: 5, 10, 20, 40 (faster)
						deltaTiers = [5, 10, 20, 40]
					} else if (currentValue < 500) {
						// 250-500 Hz: 10, 20, 50, 100 (faster)
						deltaTiers = [10, 20, 50, 100]
					} else if (currentValue < 1000) {
						// 500-1000 Hz: 20, 50, 100, 200 (faster)
						deltaTiers = [20, 50, 100, 200]
					} else if (currentValue < 2000) {
						// 1k-2k Hz: 50, 100, 200, 500 (faster)
						deltaTiers = [50, 100, 200, 500]
					} else if (currentValue < 4000) {
						// 2k-4k Hz: 100, 200, 500, 1000 (faster)
						deltaTiers = [100, 200, 500, 1000]
					} else if (currentValue < 8000) {
						// 4k-8k Hz: 200, 500, 1000, 2000 (faster)
						deltaTiers = [200, 500, 1000, 2000]
					} else if (currentValue < 16000) {
						// 8k-16k Hz: 500, 1000, 2000, 4000 (faster)
						deltaTiers = [500, 1000, 2000, 4000]
					} else {
						// 16k-20k Hz: 1000, 2000, 3000, 5000 (faster)
						deltaTiers = [1000, 2000, 3000, 5000]
					}
					delta = deltaTiers[speedTier] * (delta >= 0 ? 1 : -1)
				}
				const newValue = currentValue + delta
				const finalValue = Math.max(range.min, Math.min(range.max, newValue))

				// Update internal state
				self.inputUShaping[ch][band].frequency = finalValue

				self._cmdSendLine(`/processing/input/${ch}/ushaping/${band}/frequency=${finalValue}`)

				if (typeof self._applyInputUShaping === 'function') {
					self._applyInputUShaping(ch, band, 'frequency', finalValue)
				}

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`input_${ch}_ushaping_band${band}_frequency`]: Math.round(finalValue).toString(),
					})
				}

				const inputName = self?.inputName?.[ch] ? ` (${self.inputName[ch]})` : ''
				const deltaStr = delta >= 0 ? `+${delta}` : delta
				self.log?.(
					'info',
					`U-Shaping: Input ${ch}${inputName} Band ${band} frequency ${currentValue} ${deltaStr} = ${finalValue} Hz`,
				)
			}

			// Immediately update dynamic current value display
			if (typeof self._updateUShapingCurrentValues === 'function') {
				self._updateUShapingCurrentValues()
			}
		},
	}

	actions['input_ushaping_knob_slope'] = {
		name: 'Input: U-Shaping Knob - Slope (dB/oct)',
		description:
			'Cycle through slope values for the selected input(s) and band (6, 12, 18, 24, 30, 36, 42, 48 dB/oct). Acceleration (3 tiers): 1 → 2 → 3 steps.',
		options: [
			{
				type: 'static-text',
				id: 'info',
				label: 'Selection',
				value: 'Uses currently selected input channel(s) and band (all bands including Band 5).',
			},
			{
				type: 'dropdown',
				id: 'direction',
				label: 'Direction - for button press',
				default: 'up',
				choices: [
					{ id: 'up', label: 'Cycle Up (6→12→18→...)' },
					{ id: 'down', label: 'Cycle Down (...→18→12→6)' },
				],
			},
		],
		callback: (e) => {
			if (!self || typeof self._cmdSendLine !== 'function') return

			const chs = self?._ushapingKnobControl?.selectedInputs || [1]
			const band = self?._ushapingKnobControl?.selectedBand || 1

			// Determine direction and step count
			let direction = e.options.direction || 'up'
			let stepCount = 1

			// Time-based acceleration for rotary encoders
			if (e.surfaceId !== undefined) {
				const now = Date.now()
				const accelKey = `ushaping_slope_${e.surfaceId || 'default'}`

				if (!self._rotaryAccel) self._rotaryAccel = {}

				const lastRotation = self._rotaryAccel[accelKey] || { time: 0, count: 0 }
				const timeDiff = now - lastRotation.time

				// 4-tier acceleration based on rotation speed
				let speedTier = 0
				if (timeDiff < 100) {
					speedTier = Math.min(lastRotation.count + 1, 3)
				}

				self._rotaryAccel[accelKey] = { time: now, count: speedTier }

				// Acceleration tiers: 0 = 1 step, 1 = 2 steps, 2 = 3 steps, 3 = 4 steps
				const stepTiers = [1, 2, 3, 4]
				stepCount = stepTiers[speedTier]
			}

			// Available slope values: 6, 12, 18, 24, 30, 36, 42, 48 dB/oct
			const slopeValues = [6, 12, 18, 24, 30, 36, 42, 48]

			// Initialize storage if needed
			if (!self.inputUShaping) self.inputUShaping = {}

			for (const ch of chs) {
				if (!self.inputUShaping[ch]) self.inputUShaping[ch] = {}
				if (!self.inputUShaping[ch][band]) self.inputUShaping[ch][band] = {}

				const currentValue = Number(self.inputUShaping[ch][band].slope ?? 12)

				// Find closest slope value to current
				let currentIndex = 0
				let minDiff = Math.abs(slopeValues[0] - currentValue)
				for (let i = 1; i < slopeValues.length; i++) {
					const diff = Math.abs(slopeValues[i] - currentValue)
					if (diff < minDiff) {
						minDiff = diff
						currentIndex = i
					}
				}

				// Move to next or previous value by stepCount
				let newIndex
				if (direction === 'up') {
					newIndex = (currentIndex + stepCount) % slopeValues.length
				} else {
					newIndex = (currentIndex - stepCount + slopeValues.length) % slopeValues.length
				}
				const finalValue = slopeValues[newIndex]

				// Update internal state
				self.inputUShaping[ch][band].slope = finalValue

				self._cmdSendLine(`/processing/input/${ch}/ushaping/${band}/slope=${finalValue}`)

				if (typeof self._applyInputUShaping === 'function') {
					self._applyInputUShaping(ch, band, 'slope', finalValue)
				}

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`input_${ch}_ushaping_band${band}_slope`]: Math.round(finalValue).toString(),
					})
				}

				const inputName = self?.inputName?.[ch] ? ` (${self.inputName[ch]})` : ''
				self.log?.(
					'info',
					`U-Shaping: Input ${ch}${inputName} Band ${band} slope ${currentValue} dB/oct → ${finalValue} dB/oct`,
				)
			}

			// Immediately update dynamic current value display
			if (typeof self._updateUShapingCurrentValues === 'function') {
				self._updateUShapingCurrentValues()
			}
		},
	}

	actions['input_ushaping_knob_band_bypass'] = {
		name: 'Input: U-Shaping Band Bypass (Rotary)',
		description: 'Toggle U-Shaping band bypass for selected input(s) and selected band. Push button action.',
		options: [],
		callback: () => {
			if (!self._ushapingKnobControl) return

			const chs = self._ushapingKnobControl.selectedInputs || [1]
			const band = self._ushapingKnobControl.selectedBand || 1

			// U-Shaping has 5 bands
			if (band < 1 || band > 5) return

			for (const ch of chs) {
				if (ch < 1 || ch > NUM_INPUTS) continue

				// Initialize state if needed
				if (!self.inputUShaping) self.inputUShaping = {}
				if (!self.inputUShaping[ch]) self.inputUShaping[ch] = {}
				if (!self.inputUShaping[ch][band]) self.inputUShaping[ch][band] = {}

				// Get current bypass state (default to false if unknown)
				const currentBypass = self.inputUShaping[ch][band].band_bypass || false
				const newBypass = !currentBypass

				// Send command to device
				self._cmdSendLine(`/processing/input/${ch}/ushaping/${band}/band_bypass=${newBypass}`)

				// Update internal state
				self.inputUShaping[ch][band].band_bypass = newBypass

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`input_${ch}_ushaping_band${band}_bypass`]: newBypass ? 'ON' : 'OFF',
					})
				}

				const inputName = self?.inputName?.[ch] ? ` (${self.inputName[ch]})` : ''
				self.log?.(
					'info',
					`U-Shaping: Input ${ch}${inputName} Band ${band} bypass ${currentBypass ? 'ON' : 'OFF'} → ${newBypass ? 'ON' : 'OFF'}`,
				)
			}
		},
	}

	// ============================
	// == PARAMETRIC EQ ===========
	// ============================

	actions['input_eq_select_input'] = {
		name: 'Input: Parametric EQ Select Input Channel(s)',
		description:
			'Select which input channel(s) the Parametric EQ knobs will control. Multiple channels can be linked together.',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Input channel(s)',
				default: ['1'],
				choices: inputChoicesFriendly,
				minSelection: 0,
			},
		],
		callback: (e) => {
			const chs = safeGetChannels(e.options, 'chs', NUM_INPUTS)
			if (!self._eqKnobControl) self._eqKnobControl = {}
			self._eqKnobControl.selectedInputs = chs

			// Update variables to show selected inputs
			const names = chs
				.map((ch) => {
					const nm = self?.inputName?.[ch]
					return nm ? `Input ${ch} (${nm})` : `Input ${ch}`
				})
				.join(', ')

			if (typeof self.setVariableValues === 'function') {
				self.setVariableValues({
					eq_selected_input: names,
					eq_selected_input_num: chs.join(','),
				})

				// Update dynamic current value variables
				if (typeof self._updateEQCurrentValues === 'function') {
					self._updateEQCurrentValues()
				}
			}

			// Update feedbacks if they exist
			if (typeof self.checkFeedbacks === 'function') {
				self.checkFeedbacks('eq_input_selected')
			}
		},
	}

	actions['input_eq_select_band'] = {
		name: 'Input: Parametric EQ Select Band',
		description: 'Select which band (1-5) the Parametric EQ knobs will control.',
		options: [
			{
				type: 'dropdown',
				id: 'band',
				label: 'Band',
				default: 1,
				choices: [
					{ id: 1, label: 'Input PEQ Band 1' },
					{ id: 2, label: 'Input PEQ Band 2' },
					{ id: 3, label: 'Input PEQ Band 3' },
					{ id: 4, label: 'Input PEQ Band 4' },
					{ id: 5, label: 'Input PEQ Band 5' },
				],
			},
		],
		callback: (e) => {
			const band = Number(e.options.band ?? 1)
			if (!self._eqKnobControl) self._eqKnobControl = {}
			self._eqKnobControl.selectedBand = band

			const bandLabels = {
				1: 'Input PEQ Band 1',
				2: 'Input PEQ Band 2',
				3: 'Input PEQ Band 3',
				4: 'Input PEQ Band 4',
				5: 'Input PEQ Band 5',
			}

			if (typeof self.setVariableValues === 'function') {
				self.setVariableValues({
					eq_selected_band: bandLabels[band],
					eq_selected_band_num: band,
				})

				// Update dynamic current value variables
				if (typeof self._updateEQCurrentValues === 'function') {
					self._updateEQCurrentValues()
				}
			}

			// Update feedbacks if they exist
			if (typeof self.checkFeedbacks === 'function') {
				self.checkFeedbacks('eq_band_selected')
			}
		},
	}

	actions['input_eq_knob_gain'] = {
		name: 'Input: Parametric EQ Knob - Gain',
		description:
			'Adjust gain for the selected input(s) and band. Range: -18 to +18 dB. Acceleration (3 tiers): 0.1 → 0.5 → 1 dB.',
		options: [
			{
				type: 'number',
				id: 'delta',
				label: 'Delta (dB) - for button press',
				default: 0.1,
				min: -18,
				max: 18,
				step: 0.1,
			},
		],
		callback: (e) => {
			const chs = self?._eqKnobControl?.selectedInputs || [1]
			const band = self?._eqKnobControl?.selectedBand || 1
			let delta = Number(e.options.delta ?? 0)

			// Time-based acceleration for rotary encoders
			if (e.surfaceId !== undefined) {
				const now = Date.now()
				const accelKey = `eq_gain_${e.surfaceId || 'default'}`

				if (!self._rotaryAccel) self._rotaryAccel = {}

				const lastRotation = self._rotaryAccel[accelKey] || { time: 0, count: 0 }
				const timeDiff = now - lastRotation.time

				// 4-tier acceleration based on rotation speed
				let speedTier = 0
				if (timeDiff < 100) {
					speedTier = Math.min(lastRotation.count + 1, 3)
				}

				self._rotaryAccel[accelKey] = { time: now, count: speedTier }

				// Acceleration tiers: 0 = 0.1dB, 1 = 0.5dB, 2 = 1dB, 3 = 2dB (faster)
				const deltaTiers = [0.1, 0.5, 1.0, 2.0]
				delta = deltaTiers[speedTier] * (delta >= 0 ? 1 : -1)
			}

			if (!self.inputEQ) self.inputEQ = {}

			for (const ch of chs) {
				if (!self.inputEQ[ch]) self.inputEQ[ch] = {}
				if (!self.inputEQ[ch][band]) self.inputEQ[ch][band] = {}

				const currentValue = Number(self.inputEQ[ch][band].gain ?? 0)
				const newValue = currentValue + delta
				const finalValue = Math.max(-18, Math.min(18, newValue))

				self.inputEQ[ch][band].gain = finalValue

				self._cmdSendLine(`/processing/input/${ch}/eq/${band}/gain=${finalValue}`)

				if (typeof self._applyInputEQ === 'function') {
					self._applyInputEQ(ch, band, 'gain', finalValue)
				}

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`input_${ch}_eq_band${band}_gain`]: finalValue.toFixed(1),
					})
				}

				const inputName = self?.inputName?.[ch] ? ` (${self.inputName[ch]})` : ''
				self.log?.(
					'info',
					`Parametric EQ: Input ${ch}${inputName} Band ${band} gain ${currentValue.toFixed(1)} + ${delta.toFixed(1)} = ${finalValue.toFixed(1)} dB`,
				)
			}

			// Immediately update dynamic current value display
			if (typeof self._updateEQCurrentValues === 'function') {
				self._updateEQCurrentValues()
			}
		},
	}

	actions['input_eq_knob_frequency'] = {
		name: 'Input: Parametric EQ Knob - Frequency',
		description:
			'Adjust frequency for the selected input(s) and band. Range: 10 Hz to 20 kHz. Octave-based acceleration adapts to current frequency for natural control.',
		options: [
			{
				type: 'number',
				id: 'delta',
				label: 'Delta (Hz) - for button press',
				default: 1,
				min: -20000,
				max: 20000,
				step: 0.01,
			},
		],
		callback: (e) => {
			const chs = self?._eqKnobControl?.selectedInputs || [1]
			const band = self?._eqKnobControl?.selectedBand || 1
			const defaultFreqs = { 1: 32, 2: 125, 3: 500, 4: 2000, 5: 8000 }
			let delta = Number(e.options.delta ?? 0)

			if (!self.inputEQ) self.inputEQ = {}

			for (const ch of chs) {
				if (!self.inputEQ[ch]) self.inputEQ[ch] = {}
				if (!self.inputEQ[ch][band]) self.inputEQ[ch][band] = {}

				const currentValue = Number(self.inputEQ[ch][band].frequency ?? defaultFreqs[band])

				// Time-based acceleration for rotary encoders with range-based tiers
				if (e.surfaceId !== undefined) {
					const now = Date.now()
					const accelKey = `eq_freq_${e.surfaceId || 'default'}`

					if (!self._rotaryAccel) self._rotaryAccel = {}

					const lastRotation = self._rotaryAccel[accelKey] || { time: 0, count: 0 }
					const timeDiff = now - lastRotation.time

					// 4-tier acceleration based on rotation speed
					let speedTier = 0
					if (timeDiff < 100) {
						speedTier = Math.min(lastRotation.count + 1, 3)
					}

					self._rotaryAccel[accelKey] = { time: now, count: speedTier }

					// Octave-based acceleration tiers based on CURRENT frequency (4 tiers: 0, 1, 2, 3)
					// Organized by octave ranges for better musical/logarithmic control
					let deltaTiers
					if (currentValue < 31) {
						// 10-31 Hz (sub-bass): 0.5, 1, 2, 4 (faster)
						deltaTiers = [0.5, 1, 2, 4]
					} else if (currentValue < 63) {
						// 31-63 Hz: 1, 2, 5, 10 (faster)
						deltaTiers = [1, 2, 5, 10]
					} else if (currentValue < 125) {
						// 63-125 Hz: 2, 5, 10, 20 (faster)
						deltaTiers = [2, 5, 10, 20]
					} else if (currentValue < 250) {
						// 125-250 Hz: 5, 10, 20, 40 (faster)
						deltaTiers = [5, 10, 20, 40]
					} else if (currentValue < 500) {
						// 250-500 Hz: 10, 20, 50, 100 (faster)
						deltaTiers = [10, 20, 50, 100]
					} else if (currentValue < 1000) {
						// 500-1000 Hz: 20, 50, 100, 200 (faster)
						deltaTiers = [20, 50, 100, 200]
					} else if (currentValue < 2000) {
						// 1k-2k Hz: 50, 100, 200, 500 (faster)
						deltaTiers = [50, 100, 200, 500]
					} else if (currentValue < 4000) {
						// 2k-4k Hz: 100, 200, 500, 1000 (faster)
						deltaTiers = [100, 200, 500, 1000]
					} else if (currentValue < 8000) {
						// 4k-8k Hz: 200, 500, 1000, 2000 (faster)
						deltaTiers = [200, 500, 1000, 2000]
					} else if (currentValue < 16000) {
						// 8k-16k Hz: 500, 1000, 2000, 4000 (faster)
						deltaTiers = [500, 1000, 2000, 4000]
					} else {
						// 16k-20k Hz: 1000, 2000, 3000, 5000 (faster)
						deltaTiers = [1000, 2000, 3000, 5000]
					}
					delta = deltaTiers[speedTier] * (delta >= 0 ? 1 : -1)
				}
				let newValue = currentValue + delta

				// Apply precision rules: 0.01 Hz below 100 Hz, 1 Hz above
				if (newValue < 100) {
					newValue = Math.round(newValue * 100) / 100 // 0.01 Hz precision
				} else {
					newValue = Math.round(newValue) // 1 Hz precision
				}

				const finalValue = Math.max(10, Math.min(20000, newValue))

				self.inputEQ[ch][band].frequency = finalValue

				self._cmdSendLine(`/processing/input/${ch}/eq/${band}/frequency=${finalValue}`)

				if (typeof self._applyInputEQ === 'function') {
					self._applyInputEQ(ch, band, 'frequency', finalValue)
				}

				// Update variable with appropriate precision
				if (typeof self.setVariableValues === 'function') {
					const freqStr = finalValue < 100 ? finalValue.toFixed(2) : Math.round(finalValue).toString()
					self.setVariableValues({
						[`input_${ch}_eq_band${band}_frequency`]: freqStr,
					})
				}

				const inputName = self?.inputName?.[ch] ? ` (${self.inputName[ch]})` : ''
				const currentStr = currentValue < 100 ? currentValue.toFixed(2) : Math.round(currentValue).toString()
				const finalStr = finalValue < 100 ? finalValue.toFixed(2) : Math.round(finalValue).toString()
				self.log?.(
					'info',
					`Parametric EQ: Input ${ch}${inputName} Band ${band} frequency ${currentStr} + ${delta} = ${finalStr} Hz`,
				)
			}

			// Immediately update dynamic current value display
			if (typeof self._updateEQCurrentValues === 'function') {
				self._updateEQCurrentValues()
			}
		},
	}

	actions['input_eq_knob_bandwidth'] = {
		name: 'Input: Parametric EQ Knob - Bandwidth (Q)',
		description:
			'Adjust bandwidth/Q for the selected input(s) and band. Range: 0.1 to 2. Acceleration (3 tiers): 0.01 → 0.05 → 0.1 (precise).',
		options: [
			{
				type: 'number',
				id: 'delta',
				label: 'Delta - for button press',
				default: 0.01,
				min: -2,
				max: 2,
				step: 0.01,
			},
		],
		callback: (e) => {
			const chs = self?._eqKnobControl?.selectedInputs || [1]
			const band = self?._eqKnobControl?.selectedBand || 1
			let delta = Number(e.options.delta ?? 0)

			// Time-based acceleration for rotary encoders
			if (e.surfaceId !== undefined) {
				const now = Date.now()
				const accelKey = `eq_bw_${e.surfaceId || 'default'}`

				if (!self._rotaryAccel) self._rotaryAccel = {}

				const lastRotation = self._rotaryAccel[accelKey] || { time: 0, count: 0 }
				const timeDiff = now - lastRotation.time

				// 4-tier acceleration based on rotation speed
				let speedTier = 0
				if (timeDiff < 100) {
					speedTier = Math.min(lastRotation.count + 1, 3)
				}

				self._rotaryAccel[accelKey] = { time: now, count: speedTier }

				// Acceleration tiers: 0 = 0.01, 1 = 0.05, 2 = 0.1, 3 = 0.2 (more precise)
				const deltaTiers = [0.01, 0.05, 0.1, 0.2]
				delta = deltaTiers[speedTier] * (delta >= 0 ? 1 : -1)
			}

			if (!self.inputEQ) self.inputEQ = {}

			for (const ch of chs) {
				if (!self.inputEQ[ch]) self.inputEQ[ch] = {}
				if (!self.inputEQ[ch][band]) self.inputEQ[ch][band] = {}

				const currentValue = Number(self.inputEQ[ch][band].bandwidth ?? 1)
				const newValue = currentValue + delta
				const finalValue = Math.max(0.1, Math.min(2, Math.round(newValue * 100) / 100))

				self.inputEQ[ch][band].bandwidth = finalValue

				self._cmdSendLine(`/processing/input/${ch}/eq/${band}/bandwidth=${finalValue}`)

				if (typeof self._applyInputEQ === 'function') {
					self._applyInputEQ(ch, band, 'bandwidth', finalValue)
				}

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`input_${ch}_eq_band${band}_bandwidth`]: finalValue.toFixed(1),
					})
				}

				const inputName = self?.inputName?.[ch] ? ` (${self.inputName[ch]})` : ''
				self.log?.(
					'info',
					`Parametric EQ: Input ${ch}${inputName} Band ${band} bandwidth ${currentValue.toFixed(1)} + ${delta.toFixed(1)} = ${finalValue.toFixed(1)}`,
				)
			}

			// Immediately update dynamic current value display
			if (typeof self._updateEQCurrentValues === 'function') {
				self._updateEQCurrentValues()
			}
		},
	}

	actions['input_eq_bypass'] = {
		name: 'Input: Parametric EQ Bypass (Master)',
		description: 'Bypass all parametric EQ bands for selected input(s).',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Input channel(s)',
				default: [],
				choices: inputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'dropdown',
				id: 'mode',
				label: 'Mode',
				default: 'set',
				choices: [
					{ id: 'set', label: 'Set bypass state' },
					{ id: 'toggle', label: 'Toggle bypass' },
				],
			},
			{
				type: 'dropdown',
				id: 'state',
				label: 'Bypass state',
				default: 'true',
				choices: [
					{ id: 'true', label: 'Bypass ON' },
					{ id: 'false', label: 'Bypass OFF' },
				],
				isVisible: (o) => o.mode === 'set',
			},
		],
		callback: (e) => {
			const chs = safeGetChannels(e.options, 'chs', NUM_INPUTS)
			const mode = e.options.mode ?? 'set'

			for (const ch of chs) {
				let state
				if (mode === 'toggle') {
					const current = self?.inputEQ?.[ch]?.bypass
					state = !current
				} else {
					state = e.options.state === 'true'
				}

				self._cmdSendLine(`/processing/input/${ch}/eq/bypass=${state ? 'true' : 'false'}`)

				if (typeof self._applyInputEQBypass === 'function') {
					self._applyInputEQBypass(ch, state)
				}

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`input_${ch}_eq_bypass`]: state ? 'ON' : 'OFF',
					})
				}

				const inputName = self?.inputName?.[ch] ? ` (${self.inputName[ch]})` : ''
				self.log?.('info', `Parametric EQ: Input ${ch}${inputName} bypass ${state ? 'ON' : 'OFF'}`)
			}
		},
	}

	actions['input_eq_band_bypass'] = {
		name: 'Input: Parametric EQ Band Bypass',
		description: 'Bypass individual EQ band for selected input(s).',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Input channel(s)',
				default: [],
				choices: inputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'dropdown',
				id: 'band',
				label: 'Band',
				default: 1,
				choices: [
					{ id: 1, label: 'Band 1' },
					{ id: 2, label: 'Band 2' },
					{ id: 3, label: 'Band 3' },
					{ id: 4, label: 'Band 4' },
					{ id: 5, label: 'Band 5' },
				],
			},
			{
				type: 'dropdown',
				id: 'mode',
				label: 'Mode',
				default: 'set',
				choices: [
					{ id: 'set', label: 'Set bypass state' },
					{ id: 'toggle', label: 'Toggle bypass' },
				],
			},
			{
				type: 'dropdown',
				id: 'state',
				label: 'Bypass state',
				default: 'true',
				choices: [
					{ id: 'true', label: 'Bypassed' },
					{ id: 'false', label: 'Enabled' },
				],
				isVisible: (o) => o.mode === 'set',
			},
		],
		callback: (e) => {
			const chs = safeGetChannels(e.options, 'chs', NUM_INPUTS)
			const band = Number(e.options.band ?? 1)
			const mode = e.options.mode ?? 'set'

			for (const ch of chs) {
				let state
				if (mode === 'toggle') {
					const current = self?.inputEQ?.[ch]?.[band]?.band_bypass
					state = !current
				} else {
					state = e.options.state === 'true'
				}

				self._cmdSendLine(`/processing/input/${ch}/eq/${band}/band_bypass=${state ? 'true' : 'false'}`)

				if (typeof self._applyInputEQ === 'function') {
					self._applyInputEQ(ch, band, 'band_bypass', state)
				}

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`input_${ch}_eq_band${band}_bypass`]: state ? 'ON' : 'OFF',
					})
				}

				const inputName = self?.inputName?.[ch] ? ` (${self.inputName[ch]})` : ''
				self.log?.('info', `Parametric EQ: Input ${ch}${inputName} Band ${band} bypass ${state ? 'ON' : 'OFF'}`)
			}
		},
	}

	actions['input_eq_knob_band_bypass'] = {
		name: 'Input: Parametric EQ Band Bypass (Rotary)',
		description: 'Toggle Parametric EQ band bypass for selected input(s) and selected band. Push button action.',
		options: [],
		callback: () => {
			if (!self._eqKnobControl) return

			const chs = self._eqKnobControl.selectedInputs || [1]
			const band = self._eqKnobControl.selectedBand || 1

			// Parametric EQ has 5 bands for inputs
			if (band < 1 || band > 5) return

			for (const ch of chs) {
				if (ch < 1 || ch > NUM_INPUTS) continue

				// Initialize state if needed
				if (!self.inputEQ) self.inputEQ = {}
				if (!self.inputEQ[ch]) self.inputEQ[ch] = {}
				if (!self.inputEQ[ch][band]) self.inputEQ[ch][band] = {}

				// Get current bypass state (default to false if unknown)
				const currentBypass = self.inputEQ[ch][band].band_bypass || false
				const newBypass = !currentBypass

				// Send command to device
				self._cmdSendLine(`/processing/input/${ch}/eq/${band}/band_bypass=${newBypass}`)

				// Update internal state
				if (typeof self._applyInputEQ === 'function') {
					self._applyInputEQ(ch, band, 'band_bypass', newBypass)
				}

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`input_${ch}_eq_band${band}_bypass`]: newBypass ? 'ON' : 'OFF',
					})
				}

				const inputName = self?.inputName?.[ch] ? ` (${self.inputName[ch]})` : ''
				self.log?.(
					'info',
					`Parametric EQ: Input ${ch}${inputName} Band ${band} bypass ${currentBypass ? 'ON' : 'OFF'} → ${newBypass ? 'ON' : 'OFF'}`,
				)
			}
		},
	}
}

module.exports = { registerInputActions }
