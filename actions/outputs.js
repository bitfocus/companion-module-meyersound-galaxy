// actions/outputs.js
// Output-related actions: mutes, gains, polarity, filters, U-Shaping, Parametric EQ

const { rangeChoices, buildOutputChoices, nn } = require('../helpers')
const { safeGetChannels, speedOfSound_mps } = require('../actions-helpers')

/**
 * Register output-related actions
 * @param {Object} actions - Actions object to populate
 * @param {Object} self - Module instance
 * @param {number} NUM_INPUTS - Number of input channels
 * @param {number} NUM_OUTPUTS - Number of output channels
 */
function registerOutputActions(actions, self, NUM_INPUTS, NUM_OUTPUTS) {
	const outputChoicesNum = rangeChoices(NUM_OUTPUTS, 'Output ')
	const outputChoicesFriendly = buildOutputChoices(self, NUM_OUTPUTS)
	const buildRotaryKey = (ev) => {
		const surf = ev?.surfaceId || ev?.event?.surfaceId || 'default'
		const ctrl = ev?.controlId || ev?.event?.controlId || null
		return ctrl ? `${surf}::${ctrl}` : null
	}

	// =========================
	// ===== MUTES & SOLO ======
	// =========================

	actions['output_mute_control'] = {
		name: 'Outputs: Mute',
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
				label: 'Select output(s)',
				default: [],
				choices: outputChoicesFriendly,
				minSelection: 0,
			},
		],
		callback: (e) => {
			if (!self) return
			const op = e.options.operation
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid output channels selected')
				return
			}
			for (const ch of chs) {
				if (op === 'on' && typeof self._setMute === 'function') self._setMute('output', ch, true)
				else if (op === 'off' && typeof self._setMute === 'function') self._setMute('output', ch, false)
				else if (typeof self._toggleMute === 'function') self._toggleMute('output', ch)
			}
		},
	}

	actions['output_solo'] = {
		name: 'Outputs: Solo',
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
				label: 'Output(s) to solo',
				default: [],
				choices: outputChoicesFriendly,
				minSelection: 0,
			},
		],
		callback: (e) => {
			if (!self) return
			const op = e.options.operation
			const soloChannels = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (soloChannels.length === 0) {
				self.log?.('warn', 'No valid output channels selected for solo')
				return
			}

			const soloSet = new Set(soloChannels)
			const currentSoloState = self.outputSoloState

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
				const prevMute =
					(currentSoloState && currentSoloState.prevMute) ||
					(() => {
						const snap = {}
						for (let ch = 1; ch <= NUM_OUTPUTS; ch++) {
							snap[ch] = !!self?.outMute?.[ch]
						}
						return snap
					})()

				for (let ch = 1; ch <= NUM_OUTPUTS; ch++) {
					if (soloSet.has(ch)) {
						if (typeof self._setMute === 'function') {
							self._setMute('output', ch, false)
						}
					} else {
						if (typeof self._setMute === 'function') {
							self._setMute('output', ch, true)
						}
					}
				}
				self.outputSoloState = { soloChannels: soloSet, prevMute }
				self.log?.('info', `Soloed output channels: ${soloChannels.join(', ')}`)
			} else {
				// Unsolo: restore previous mute states if known
				const prevMute = currentSoloState?.prevMute || {}
				for (let ch = 1; ch <= NUM_OUTPUTS; ch++) {
					const shouldMute = prevMute[ch] ?? false
					if (typeof self._setMute === 'function') {
						self._setMute('output', ch, shouldMute)
					}
				}
				self.outputSoloState = null
				self.log?.('info', `Unsolo - restored previous mute states`)
			}

			// Update feedbacks
			if (typeof self.checkFeedbacks === 'function') {
				self.checkFeedbacks('output_muted', 'output_soloed')
			}
		},
	}

	// =========================
	// ===== LINK GROUPS =======
	// =========================
	// NOTE: Outputs support 8 link groups (1-8)

	actions['output_link_group_bypass'] = {
		name: 'Output: Link Group Bypass',
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
					{ id: '5', label: 'Link Group 5' },
					{ id: '6', label: 'Link Group 6' },
					{ id: '7', label: 'Link Group 7' },
					{ id: '8', label: 'Link Group 8' },
				],
				minSelection: 0,
			},
		],
		callback: (e) => {
			if (!self) return
			const op = e.options.operation
			const groups = Array.isArray(e.options.groups)
				? e.options.groups.map((g) => Number(g)).filter((g) => g >= 1 && g <= 8)
				: []

			if (groups.length === 0) {
				self.log?.('warn', 'No valid output link groups selected')
				return
			}

			for (const group of groups) {
				const currentBypass = self?.outputLinkGroupBypass?.[group]
				let targetBypass = false

				if (op === 'on') {
					targetBypass = true
				} else if (op === 'off') {
					targetBypass = false
				} else {
					targetBypass = currentBypass !== true
				}

				const value = targetBypass ? 'true' : 'false'
				self._cmdSendLine(`/device/output_link_group/${group}/bypass='${value}'`)

				// Update local state
				if (!self.outputLinkGroupBypass) self.outputLinkGroupBypass = {}
				self.outputLinkGroupBypass[group] = targetBypass

				self.log?.('info', `Output Link Group ${group} bypass: ${value}`)
			}

			if (typeof self.checkFeedbacks === 'function') {
				self.checkFeedbacks('output_link_group_bypassed')
			}
		},
	}

	actions['output_link_group_assign'] = {
		name: 'Output: Assign to Link Group',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output Channel(s)',
				default: [],
				choices: outputChoicesFriendly,
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
					{ id: '5', label: 'Link Group 5' },
					{ id: '6', label: 'Link Group 6' },
					{ id: '7', label: 'Link Group 7' },
					{ id: '8', label: 'Link Group 8' },
				],
			},
		],
		callback: (e) => {
			if (!self) return

			const channels = e.options.chs || []
			const linkGroup = String(e.options.link_group || '0')

			for (const ch of channels) {
				const chNum = Number(ch)
				if (chNum < 1 || chNum > NUM_OUTPUTS) continue

				self._cmdSendLine(`/device/output/${chNum}/output_link_group='${linkGroup}'`)

				// Update local state
				if (!self.outputLinkGroupAssign) self.outputLinkGroupAssign = {}
				self.outputLinkGroupAssign[chNum] = Number(linkGroup)

				const groupLabel = linkGroup === '0' ? 'Unassigned' : `Link Group ${linkGroup}`
				self.log?.('info', `Output ${chNum} assigned to: ${groupLabel}`)
			}

			if (typeof self.checkFeedbacks === 'function') {
				self.checkFeedbacks('output_link_group_assigned')
			}
		},
	}

	// ===============================
	// ===== U-SHAPING EQ ============
	// ===============================

	// U-Shaping - Selection Actions

	actions['output_ushaping_select_output'] = {
		name: 'Output: U-Shaping Select Output Channel(s)',
		description: 'Select which output channel(s) the U-Shaping knobs will control (can select multiple to link them)',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: ['1'],
				choices: outputChoicesFriendly,
				minSelection: 0,
			},
		],
		callback: (e) => {
			if (!self) return
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid output channels selected')
				return
			}

			// Store the selected output channels (array)
			if (!self._ushapingKnobControlOutput) self._ushapingKnobControlOutput = {}
			self._ushapingKnobControlOutput.selectedOutputs = chs

			// Update variable
			if (typeof self.setVariableValues === 'function') {
				const names = chs
					.map((ch) => {
						const name = self?.outputName?.[ch]
						return name ? `${ch} (${name})` : `${ch}`
					})
					.join(', ')

				self.setVariableValues({
					ushaping_selected_output: names,
					ushaping_selected_output_num: chs.join(','),
				})

				// Update dynamic current value variables
				if (typeof self._updateUShapingCurrentValues === 'function') {
					self._updateUShapingCurrentValues()
				}
			}

			// Update feedbacks
			if (typeof self.checkFeedbacks === 'function') {
				self.checkFeedbacks('ushaping_output_selected')
			}

			const channelList = chs
				.map((ch) => {
					const name = self?.outputName?.[ch]
					return name ? `${ch} (${name})` : `${ch}`
				})
				.join(', ')

			self.log?.('info', `U-Shaping: Selected output(s): ${channelList}`)
		},
	}

	actions['output_ushaping_select_band'] = {
		name: 'Output: U-Shaping Select Band',
		description: 'Select which band (1-5) the U-Shaping knobs will control',
		options: [
			{
				type: 'dropdown',
				id: 'band',
				label: 'Band',
				default: '1',
				choices: [
					{ id: '1', label: 'Output U-Shaping Band 1' },
					{ id: '2', label: 'Output U-Shaping Band 2' },
					{ id: '3', label: 'Output U-Shaping Band 3' },
					{ id: '4', label: 'Output U-Shaping Band 4' },
					{ id: '5', label: 'Output U-Shaping Band 5' },
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
			if (!self._ushapingKnobControlOutput) self._ushapingKnobControlOutput = {}
			self._ushapingKnobControlOutput.selectedBand = band

			// Update variable
			if (typeof self.setVariableValues === 'function') {
				const bandLabels = {
					1: 'Output U-Shaping Band 1',
					2: 'Output U-Shaping Band 2',
					3: 'Output U-Shaping Band 3',
					4: 'Output U-Shaping Band 4',
					5: 'Output U-Shaping Band 5',
				}
				self.setVariableValues({
					ushaping_selected_output_band: bandLabels[band],
					ushaping_selected_output_band_num: band,
				})

				// Update dynamic current value variables
				if (typeof self._updateUShapingOutputCurrentValues === 'function') {
					self._updateUShapingOutputCurrentValues()
				}
			}

			// Update feedbacks
			if (typeof self.checkFeedbacks === 'function') {
				self.checkFeedbacks('ushaping_output_band_selected')
			}

			self.log?.('info', `U-Shaping: Selected Output Band ${band}`)
		},
	}

	actions['output_ushaping_gain_coarse_mode'] = {
		name: 'Output: U-Shaping Gain Coarse Mode',
		description: 'Use with the U-Shaping gain knob; press/hold/toggle to switch between fine and coarse steps.',
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
				self.log?.('warn', 'U-Shaping coarse mode: no controlId/surfaceId available')
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

	actions['output_ushaping_bypass'] = {
		name: 'Output: U-Shaping Bypass',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: [],
				choices: outputChoicesFriendly,
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
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid output channels selected')
				return
			}
			const op = String(e.options.operation || 'toggle')
			for (const ch of chs) {
				let state
				if (op === 'toggle') {
					const current = self?.outputUShaping?.[ch]?.bypass
					const currentBool =
						typeof current === 'boolean' ? current : /^(true|1|on)$/i.test(String(current ?? '').trim())
					state = !currentBool
				} else {
					const enable = op === 'on'
					state = !enable
				}
				self._cmdSendLine(`/processing/output/${ch}/ushaping/bypass=${state ? 'true' : 'false'}`)
				if (typeof self._applyOutputUShapingBypass === 'function') {
					self._applyOutputUShapingBypass(ch, state)
				}
				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`output_${ch}_ushaping_bypass`]: state ? 'ON' : 'OFF',
					})
				}
				self.log?.('info', `Output ch ${ch}: U-Shaping bypass ${state ? 'ON' : 'OFF'}`)
			}
		},
	}

	// U-Shaping - Knob Actions

	actions['output_ushaping_knob_gain'] = {
		name: 'Output: U-Shaping Knob - Gain',
		description:
			'Adjust gain for the selected output(s) and band. Fine/Coarse steps, coarse when the rotary/button is pressed via the coarse-mode action.',
		options: [
			{
				type: 'static-text',
				id: 'info',
				label: 'Selection',
				value: 'Uses currently selected output channel(s) and band. Use selection buttons to choose.',
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

			const chs = self?._ushapingKnobControlOutput?.selectedOutputs || [1]
			const band = self?._ushapingKnobControlOutput?.selectedBand || 1
			const key = buildRotaryKey(e)
			const isCoarse = key && self?._rotaryPressState?.[key]

			let base = Number(isCoarse ? e.options.delta_coarse : e.options.delta_fine)
			if (!Number.isFinite(base) || base === 0) base = isCoarse ? 0.5 : 0.1

			let sign = base >= 0 ? 1 : -1
			if (typeof e?.encoder_delta === 'number' && e.encoder_delta !== 0) {
				sign = e.encoder_delta > 0 ? 1 : -1
			}
			const delta = Math.abs(base) * sign

			// Initialize storage if needed
			if (!self.outputUShaping) self.outputUShaping = {}

			for (const ch of chs) {
				if (!self.outputUShaping[ch]) self.outputUShaping[ch] = {}
				if (!self.outputUShaping[ch][band]) self.outputUShaping[ch][band] = {}

				const currentValue = Number(self.outputUShaping[ch][band].gain ?? 0)
				const newValue = currentValue + delta
				const finalValue = Math.max(-15, Math.min(15, newValue))

				// Update internal state
				self.outputUShaping[ch][band].gain = finalValue

				self._cmdSendLine(`/processing/output/${ch}/ushaping/${band}/gain=${finalValue}`)

				if (typeof self._applyOutputUShaping === 'function') {
					self._applyOutputUShaping(ch, band, 'gain', finalValue)
				}

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`output_${ch}_ushaping_band${band}_gain`]: finalValue.toFixed(1),
					})
				}

				const outputName = self?.outputName?.[ch] ? ` (${self.outputName[ch]})` : ''
				const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)
				const modeLabel = isCoarse ? 'coarse' : 'fine'
				self.log?.(
					'info',
					`U-Shaping (${modeLabel}): Output ${ch}${outputName} Band ${band} gain ${currentValue.toFixed(1)} ${deltaStr} = ${finalValue.toFixed(1)} dB`,
				)
			}

			// Immediately update dynamic current value display
			if (typeof self._updateUShapingOutputCurrentValues === 'function') {
				self._updateUShapingOutputCurrentValues()
			}
		},
	}

	actions['output_ushaping_knob_frequency'] = {
		name: 'Output: U-Shaping Knob - Frequency',
		description:
			'Adjust frequency for the selected output(s) and band (B1: 20-2500Hz, B2: 40-5000Hz, B3: 80-10kHz, B4: 160-20kHz). Octave-based acceleration adapts to current frequency for natural control.',
		options: [
			{
				type: 'static-text',
				id: 'info',
				label: 'Selection',
				value: 'Uses currently selected output channel(s) and band. Band 5 (HF) does not have frequency.',
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

			const chs = self?._ushapingKnobControlOutput?.selectedOutputs || [1]
			const band = self?._ushapingKnobControlOutput?.selectedBand || 1

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
			if (!self.outputUShaping) self.outputUShaping = {}

			for (const ch of chs) {
				if (!self.outputUShaping[ch]) self.outputUShaping[ch] = {}
				if (!self.outputUShaping[ch][band]) self.outputUShaping[ch][band] = {}

				const currentValue = Number(self.outputUShaping[ch][band].frequency ?? range.default)
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
				self.outputUShaping[ch][band].frequency = finalValue

				self._cmdSendLine(`/processing/output/${ch}/ushaping/${band}/frequency=${finalValue}`)

				if (typeof self._applyOutputUShaping === 'function') {
					self._applyOutputUShaping(ch, band, 'frequency', finalValue)
				}

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`output_${ch}_ushaping_band${band}_frequency`]: Math.round(finalValue).toString(),
					})
				}

				const outputName = self?.outputName?.[ch] ? ` (${self.outputName[ch]})` : ''
				const deltaStr = delta >= 0 ? `+${delta}` : delta
				self.log?.(
					'info',
					`U-Shaping: Output ${ch}${outputName} Band ${band} frequency ${currentValue} ${deltaStr} = ${finalValue} Hz`,
				)
			}

			// Immediately update dynamic current value display
			if (typeof self._updateUShapingOutputCurrentValues === 'function') {
				self._updateUShapingOutputCurrentValues()
			}
		},
	}

	actions['output_ushaping_knob_slope'] = {
		name: 'Output: U-Shaping Knob - Slope (dB/oct)',
		description:
			'Cycle through slope values for the selected output(s) and band (6, 12, 18, 24, 30, 36, 42, 48 dB/oct). Acceleration (3 tiers): 1 → 2 → 3 steps.',
		options: [
			{
				type: 'static-text',
				id: 'info',
				label: 'Selection',
				value: 'Uses currently selected output channel(s) and band (all bands including Band 5).',
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

			const chs = self?._ushapingKnobControlOutput?.selectedOutputs || [1]
			const band = self?._ushapingKnobControlOutput?.selectedBand || 1

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
			if (!self.outputUShaping) self.outputUShaping = {}

			for (const ch of chs) {
				if (!self.outputUShaping[ch]) self.outputUShaping[ch] = {}
				if (!self.outputUShaping[ch][band]) self.outputUShaping[ch][band] = {}

				const currentValue = Number(self.outputUShaping[ch][band].slope ?? 12)

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
				self.outputUShaping[ch][band].slope = finalValue

				self._cmdSendLine(`/processing/output/${ch}/ushaping/${band}/slope=${finalValue}`)

				if (typeof self._applyOutputUShaping === 'function') {
					self._applyOutputUShaping(ch, band, 'slope', finalValue)
				}

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`output_${ch}_ushaping_band${band}_slope`]: Math.round(finalValue).toString(),
					})
				}

				const outputName = self?.outputName?.[ch] ? ` (${self.outputName[ch]})` : ''
				self.log?.(
					'info',
					`U-Shaping: Output ${ch}${outputName} Band ${band} slope ${currentValue} dB/oct → ${finalValue} dB/oct`,
				)
			}

			// Immediately update dynamic current value display
			if (typeof self._updateUShapingOutputCurrentValues === 'function') {
				self._updateUShapingOutputCurrentValues()
			}
		},
	}

	actions['output_ushaping_knob_band_bypass'] = {
		name: 'Output: U-Shaping Band Bypass (Rotary)',
		description: 'Toggle U-Shaping band bypass for selected output(s) and selected band. Push button action.',
		options: [],
		callback: () => {
			if (!self._ushapingKnobControlOutput) return

			const chs = self._ushapingKnobControlOutput.selectedOutputs || [1]
			const band = self._ushapingKnobControlOutput.selectedBand || 1

			// U-Shaping has 5 bands
			if (band < 1 || band > 5) return

			for (const ch of chs) {
				if (ch < 1 || ch > NUM_OUTPUTS) continue

				// Initialize state if needed
				if (!self.outputUShaping) self.outputUShaping = {}
				if (!self.outputUShaping[ch]) self.outputUShaping[ch] = {}
				if (!self.outputUShaping[ch][band]) self.outputUShaping[ch][band] = {}

				// Get current bypass state (default to false if unknown)
				const currentBypass = self.outputUShaping[ch][band].band_bypass || false
				const newBypass = !currentBypass

				// Send command to device
				self._cmdSendLine(`/processing/output/${ch}/ushaping/${band}/band_bypass=${newBypass}`)

				// Update internal state
				self.outputUShaping[ch][band].band_bypass = newBypass

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`output_${ch}_ushaping_band${band}_bypass`]: newBypass ? 'ON' : 'OFF',
					})
				}

				const outputName = self?.outputName?.[ch] ? ` (${self.outputName[ch]})` : ''
				self.log?.(
					'info',
					`U-Shaping: Output ${ch}${outputName} Band ${band} bypass ${currentBypass ? 'ON' : 'OFF'} → ${newBypass ? 'ON' : 'OFF'}`,
				)
			}
		},
	}

	// ===============================
	// ===== PARAMETRIC EQ ===========
	// ===============================

	// Parametric EQ - Selection Actions

	actions['output_eq_select_output'] = {
		name: 'Output: Parametric EQ Select Output Channel(s)',
		description:
			'Select which output channel(s) the Parametric EQ knobs will control. Multiple channels can be linked together.',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: ['1'],
				choices: outputChoicesFriendly,
				minSelection: 0,
			},
		],
		callback: (e) => {
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (!self._eqKnobControlOutput) self._eqKnobControlOutput = {}
			self._eqKnobControlOutput.selectedOutputs = chs

			// Update variables to show selected outputs
			const names = chs
				.map((ch) => {
					const nm = self?.outputName?.[ch]
					return nm ? `Output ${ch} (${nm})` : `Output ${ch}`
				})
				.join(', ')

			if (typeof self.setVariableValues === 'function') {
				self.setVariableValues({
					eq_selected_output: names,
					eq_selected_output_num: chs.join(','),
				})

				// Update dynamic current value variables
				if (typeof self._updateEQCurrentValues === 'function') {
					self._updateEQCurrentValues()
				}
			}

			// Update feedbacks if they exist
			if (typeof self.checkFeedbacks === 'function') {
				self.checkFeedbacks('eq_output_selected')
			}
		},
	}

	actions['output_eq_select_band'] = {
		name: 'Output: Parametric EQ Select Band',
		description: 'Select which band (1-10) the Parametric EQ knobs will control.',
		options: [
			{
				type: 'dropdown',
				id: 'band',
				label: 'Band',
				default: 1,
				choices: [
					{ id: 1, label: 'Output PEQ Band 1' },
					{ id: 2, label: 'Output PEQ Band 2' },
					{ id: 3, label: 'Output PEQ Band 3' },
					{ id: 4, label: 'Output PEQ Band 4' },
					{ id: 5, label: 'Output PEQ Band 5' },
					{ id: 6, label: 'Output PEQ Band 6' },
					{ id: 7, label: 'Output PEQ Band 7' },
					{ id: 8, label: 'Output PEQ Band 8' },
					{ id: 9, label: 'Output PEQ Band 9' },
					{ id: 10, label: 'Output PEQ Band 10' },
				],
			},
		],
		callback: (e) => {
			const band = Number(e.options.band ?? 1)
			if (!self._eqKnobControlOutput) self._eqKnobControlOutput = {}
			self._eqKnobControlOutput.selectedBand = band

			const bandLabels = {
				1: 'Output PEQ Band 1',
				2: 'Output PEQ Band 2',
				3: 'Output PEQ Band 3',
				4: 'Output PEQ Band 4',
				5: 'Output PEQ Band 5',
				6: 'Output PEQ Band 6',
				7: 'Output PEQ Band 7',
				8: 'Output PEQ Band 8',
				9: 'Output PEQ Band 9',
				10: 'Output PEQ Band 10',
			}

			if (typeof self.setVariableValues === 'function') {
				self.setVariableValues({
					eq_selected_output_band: bandLabels[band],
					eq_selected_output_band_num: band,
				})

				// Update dynamic current value variables
				if (typeof self._updateEQOutputCurrentValues === 'function') {
					self._updateEQOutputCurrentValues()
				}
			}

			// Update feedbacks if they exist
			if (typeof self.checkFeedbacks === 'function') {
				self.checkFeedbacks('eq_output_band_selected')
			}
		},
	}

	actions['output_eq_gain_coarse_mode'] = {
		name: 'Output: Parametric EQ Gain Coarse Mode',
		description: 'Use with the output PEQ gain knob; press/hold/toggle to switch between fine and coarse steps.',
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
				self.log?.('warn', 'Output PEQ coarse mode: no controlId/surfaceId available')
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

	// Parametric EQ - Knob Actions

	actions['output_eq_knob_gain'] = {
		name: 'Output: Parametric EQ Knob - Gain',
		description:
			'Adjust gain for the selected output(s) and band. Range: -18 to +18 dB. Fine/Coarse steps, coarse when the rotary/button is pressed via the coarse-mode action.',
		options: [
			{
				type: 'number',
				id: 'delta_fine',
				label: 'Gain delta fine (dB)',
				default: 0.1,
				min: -18,
				max: 18,
				step: 0.1,
			},
			{
				type: 'number',
				id: 'delta_coarse',
				label: 'Gain delta coarse (dB)',
				default: 0.5,
				min: -18,
				max: 18,
				step: 0.1,
			},
		],
		callback: (e) => {
			const chs = self?._eqKnobControlOutput?.selectedOutputs || [1]
			const band = self?._eqKnobControlOutput?.selectedBand || 1
			const key = buildRotaryKey(e)
			const isCoarse = key && self?._rotaryPressState?.[key]

			let base = Number(isCoarse ? e.options.delta_coarse : e.options.delta_fine)
			if (!Number.isFinite(base) || base === 0) base = isCoarse ? 0.5 : 0.1

			let sign = base >= 0 ? 1 : -1
			if (typeof e?.encoder_delta === 'number' && e.encoder_delta !== 0) {
				sign = e.encoder_delta > 0 ? 1 : -1
			}
			const delta = Math.abs(base) * sign

			if (!self.outputEQ) self.outputEQ = {}

			for (const ch of chs) {
				if (!self.outputEQ[ch]) self.outputEQ[ch] = {}
				if (!self.outputEQ[ch][band]) self.outputEQ[ch][band] = {}

				const currentValue = Number(self.outputEQ[ch][band].gain ?? 0)
				const newValue = currentValue + delta
				const finalValue = Math.max(-18, Math.min(18, newValue))

				self.outputEQ[ch][band].gain = finalValue

				self._cmdSendLine(`/processing/output/${ch}/eq/${band}/gain=${finalValue}`)

				if (typeof self._applyOutputEQ === 'function') {
					self._applyOutputEQ(ch, band, 'gain', finalValue)
				}

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`output_${ch}_eq_band${band}_gain`]: finalValue.toFixed(1),
					})
				}

				const outputName = self?.outputName?.[ch] ? ` (${self.outputName[ch]})` : ''
				const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)
				const modeLabel = isCoarse ? 'coarse' : 'fine'
				self.log?.(
					'info',
					`Parametric EQ (${modeLabel}): Output ${ch}${outputName} Band ${band} gain ${currentValue.toFixed(1)} ${deltaStr} = ${finalValue.toFixed(1)} dB`,
				)
			}

			// Immediately update dynamic current value display
			if (typeof self._updateEQOutputCurrentValues === 'function') {
				self._updateEQOutputCurrentValues()
			}
		},
	}

	actions['output_eq_knob_frequency'] = {
		name: 'Output: Parametric EQ Knob - Frequency',
		description:
			'Adjust frequency for the selected output(s) and band. Range: 10 Hz to 20 kHz. Octave-based acceleration adapts to current frequency for natural control.',
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
			const chs = self?._eqKnobControlOutput?.selectedOutputs || [1]
			const band = self?._eqKnobControlOutput?.selectedBand || 1
			const defaultFreqs = { 1: 32, 2: 125, 3: 500, 4: 2000, 5: 8000, 6: 63, 7: 250, 8: 1000, 9: 4000, 10: 16000 }
			let delta = Number(e.options.delta ?? 0)

			if (!self.outputEQ) self.outputEQ = {}

			for (const ch of chs) {
				if (!self.outputEQ[ch]) self.outputEQ[ch] = {}
				if (!self.outputEQ[ch][band]) self.outputEQ[ch][band] = {}

				const currentValue = Number(self.outputEQ[ch][band].frequency ?? defaultFreqs[band])

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

				self.outputEQ[ch][band].frequency = finalValue

				self._cmdSendLine(`/processing/output/${ch}/eq/${band}/frequency=${finalValue}`)

				if (typeof self._applyOutputEQ === 'function') {
					self._applyOutputEQ(ch, band, 'frequency', finalValue)
				}

				// Update variable with appropriate precision
				if (typeof self.setVariableValues === 'function') {
					const freqStr = finalValue < 100 ? finalValue.toFixed(2) : Math.round(finalValue).toString()
					self.setVariableValues({
						[`output_${ch}_eq_band${band}_frequency`]: freqStr,
					})
				}

				const outputName = self?.outputName?.[ch] ? ` (${self.outputName[ch]})` : ''
				const currentStr = currentValue < 100 ? currentValue.toFixed(2) : Math.round(currentValue).toString()
				const finalStr = finalValue < 100 ? finalValue.toFixed(2) : Math.round(finalValue).toString()
				self.log?.(
					'info',
					`Parametric EQ: Output ${ch}${outputName} Band ${band} frequency ${currentStr} + ${delta} = ${finalStr} Hz`,
				)
			}

			// Immediately update dynamic current value display
			if (typeof self._updateEQOutputCurrentValues === 'function') {
				self._updateEQOutputCurrentValues()
			}
		},
	}

	actions['output_eq_knob_bandwidth'] = {
		name: 'Output: Parametric EQ Knob - Bandwidth (Q)',
		description:
			'Adjust bandwidth/Q for the selected output(s) and band. Range: 0.1 to 2. Acceleration (3 tiers): 0.01 → 0.05 → 0.1 (precise).',
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
			const chs = self?._eqKnobControlOutput?.selectedOutputs || [1]
			const band = self?._eqKnobControlOutput?.selectedBand || 1
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

			if (!self.outputEQ) self.outputEQ = {}

			for (const ch of chs) {
				if (!self.outputEQ[ch]) self.outputEQ[ch] = {}
				if (!self.outputEQ[ch][band]) self.outputEQ[ch][band] = {}

				const currentValue = Number(self.outputEQ[ch][band].bandwidth ?? 1)
				const newValue = currentValue + delta
				const finalValue = Math.max(0.1, Math.min(2, Math.round(newValue * 100) / 100))

				self.outputEQ[ch][band].bandwidth = finalValue

				self._cmdSendLine(`/processing/output/${ch}/eq/${band}/bandwidth=${finalValue}`)

				if (typeof self._applyOutputEQ === 'function') {
					self._applyOutputEQ(ch, band, 'bandwidth', finalValue)
				}

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`output_${ch}_eq_band${band}_bandwidth`]: finalValue.toFixed(1),
					})
				}

				const outputName = self?.outputName?.[ch] ? ` (${self.outputName[ch]})` : ''
				self.log?.(
					'info',
					`Parametric EQ: Output ${ch}${outputName} Band ${band} bandwidth ${currentValue.toFixed(1)} + ${delta.toFixed(1)} = ${finalValue.toFixed(1)}`,
				)
			}

			// Immediately update dynamic current value display
			if (typeof self._updateEQOutputCurrentValues === 'function') {
				self._updateEQOutputCurrentValues()
			}
		},
	}

	// Parametric EQ - Bypass Actions

	actions['output_eq_bypass'] = {
		name: 'Output: Parametric EQ Bypass (Master)',
		description: 'Bypass all parametric EQ bands for selected output(s).',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: [],
				choices: outputChoicesFriendly,
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
					{ id: 'true', label: 'Bypassed' },
					{ id: 'false', label: 'Enabled' },
				],
				isVisible: (o) => o.mode === 'set',
			},
		],
		callback: (e) => {
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			const mode = e.options.mode ?? 'set'

			for (const ch of chs) {
				let state
				if (mode === 'toggle') {
					const current = self?.outputEQ?.[ch]?.bypass
					state = !current
				} else {
					state = e.options.state === 'true'
				}

				self._cmdSendLine(`/processing/output/${ch}/eq/bypass=${state ? 'true' : 'false'}`)

				if (typeof self._applyOutputEQBypass === 'function') {
					self._applyOutputEQBypass(ch, state)
				}

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`output_${ch}_eq_bypass`]: state ? 'ON' : 'OFF',
					})
				}

				const outputName = self?.outputName?.[ch] ? ` (${self.outputName[ch]})` : ''
				self.log?.('info', `Parametric EQ: Output ${ch}${outputName} bypass ${state ? 'ON' : 'OFF'}`)
			}
		},
	}

	actions['output_eq_band_bypass'] = {
		name: 'Output: Parametric EQ Band Bypass',
		description: 'Bypass individual EQ band for selected output(s).',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: [],
				choices: outputChoicesFriendly,
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
					{ id: 6, label: 'Band 6' },
					{ id: 7, label: 'Band 7' },
					{ id: 8, label: 'Band 8' },
					{ id: 9, label: 'Band 9' },
					{ id: 10, label: 'Band 10' },
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
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			const band = Number(e.options.band ?? 1)
			const mode = e.options.mode ?? 'set'

			for (const ch of chs) {
				let state
				if (mode === 'toggle') {
					const current = self?.outputEQ?.[ch]?.[band]?.band_bypass
					state = !current
				} else {
					state = e.options.state === 'true'
				}

				self._cmdSendLine(`/processing/output/${ch}/eq/${band}/band_bypass=${state ? 'true' : 'false'}`)

				if (typeof self._applyOutputEQ === 'function') {
					self._applyOutputEQ(ch, band, 'band_bypass', state)
				}

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`output_${ch}_eq_band${band}_bypass`]: state ? 'ON' : 'OFF',
					})
				}

				const outputName = self?.outputName?.[ch] ? ` (${self.outputName[ch]})` : ''
				self.log?.('info', `Parametric EQ: Output ${ch}${outputName} Band ${band} bypass ${state ? 'ON' : 'OFF'}`)
			}
		},
	}

	actions['output_eq_knob_band_bypass'] = {
		name: 'Output: Parametric EQ Band Bypass (Rotary)',
		description: 'Toggle Parametric EQ band bypass for selected output(s) and selected band. Push button action.',
		options: [],
		callback: () => {
			if (!self._eqKnobControlOutput) return

			const chs = self._eqKnobControlOutput.selectedOutputs || [1]
			const band = self._eqKnobControlOutput.selectedBand || 1

			// Parametric EQ has 10 bands for outputs
			if (band < 1 || band > 10) return

			for (const ch of chs) {
				if (ch < 1 || ch > NUM_OUTPUTS) continue

				// Initialize state if needed
				if (!self.outputEQ) self.outputEQ = {}
				if (!self.outputEQ[ch]) self.outputEQ[ch] = {}
				if (!self.outputEQ[ch][band]) self.outputEQ[ch][band] = {}

				// Get current bypass state (default to false if unknown)
				const currentBypass = self.outputEQ[ch][band].band_bypass || false
				const newBypass = !currentBypass

				// Send command to device
				self._cmdSendLine(`/processing/output/${ch}/eq/${band}/band_bypass=${newBypass}`)

				// Update internal state
				if (typeof self._applyOutputEQ === 'function') {
					self._applyOutputEQ(ch, band, 'band_bypass', newBypass)
				}

				// Update variable
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`output_${ch}_eq_band${band}_bypass`]: newBypass ? 'ON' : 'OFF',
					})
				}

				const outputName = self?.outputName?.[ch] ? ` (${self.outputName[ch]})` : ''
				self.log?.(
					'info',
					`Parametric EQ: Output ${ch}${outputName} Band ${band} bypass ${currentBypass ? 'ON' : 'OFF'} → ${newBypass ? 'ON' : 'OFF'}`,
				)
			}
		},
	}

	// =========================
	// ===== GAIN ==============
	// =========================

	actions['output_gain_set'] = {
		name: 'Output: Gain',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: [],
				choices: outputChoicesFriendly,
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
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid output channels selected')
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
					const prev = typeof self._getPrevOutputGain === 'function' ? self._getPrevOutputGain(ch, btnId) : null
					if (prev == null) {
						self.log?.('debug', `Output ch ${ch}: no last dB stored`)
						continue
					}
					if (dur > 0 && typeof self._startOutputGainFade === 'function') {
						self._startOutputGainFade(ch, prev, dur, curve)
					} else if (typeof self._setOutputGain === 'function') {
						self._setOutputGain(ch, prev)
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
						self._subWrite(`/processing/output/${ch}/gain`)
					}
					if (typeof self._beginPrevCaptureWindow === 'function') {
						self._beginPrevCaptureWindow('output', ch, btnId, 300)
					}
					if (typeof self._rememberPrevOutputGain === 'function') {
						self._rememberPrevOutputGain(ch, btnId)
					}

					const cur = Number(self?.outputGain?.[ch])
					const base = Number.isFinite(cur) ? cur : 0
					const target = base + (Number.isFinite(d) ? d : 0)

					if (durNudge > 0 && typeof self._startOutputGainFade === 'function') {
						self._startOutputGainFade(ch, target, durNudge, curveNudge)
					} else if (typeof self._setOutputGain === 'function') {
						self._setOutputGain(ch, target)
					}
				}
				return
			}

			if (mode === 'pair') {
				const gA = Number(e.options.gain_a)
				const gB = Number(e.options.gain_b)
				for (const ch of chs) {
					if (typeof self._subWrite === 'function') {
						self._subWrite(`/processing/output/${ch}/gain`)
					}
					if (!self._outputGainToggle) self._outputGainToggle = {}
					const lastWasA = self._outputGainToggle[ch] === 'A'
					const targetGain = lastWasA ? gB : gA
					self._outputGainToggle[ch] = lastWasA ? 'B' : 'A'

					if (typeof self._beginPrevCaptureWindow === 'function') {
						self._beginPrevCaptureWindow('output', ch, btnId, 300)
					}
					if (typeof self._rememberPrevOutputGain === 'function') {
						self._rememberPrevOutputGain(ch, btnId)
					}

					if (dur > 0 && typeof self._startOutputGainFade === 'function') {
						self._startOutputGainFade(ch, targetGain, dur, curve)
					} else if (typeof self._setOutputGain === 'function') {
						self._setOutputGain(ch, targetGain)
					}
				}
				return
			}

			const g = Number(e.options.gain)
			for (const ch of chs) {
				if (typeof self._subWrite === 'function') {
					self._subWrite(`/processing/output/${ch}/gain`)
				}
				if (typeof self._beginPrevCaptureWindow === 'function') {
					self._beginPrevCaptureWindow('output', ch, btnId, 300)
				}
				if (typeof self._rememberPrevOutputGain === 'function') {
					self._rememberPrevOutputGain(ch, btnId)
				}
				if (dur > 0 && typeof self._startOutputGainFade === 'function') {
					self._startOutputGainFade(ch, g, dur, curve)
				} else if (typeof self._setOutputGain === 'function') {
					self._setOutputGain(ch, g)
				}
			}
		},
	}

	// =========================
	// ===== POLARITY ==========
	// =========================

	actions['output_polarity_control'] = {
		name: 'Output: Polarity',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: [],
				choices: outputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'dropdown',
				id: 'operation',
				label: 'Operation',
				default: 'toggle',
				choices: [
					{ id: 'on', label: 'Set to Reversed' },
					{ id: 'off', label: 'Set to Normal' },
					{ id: 'toggle', label: 'Toggle' },
				],
			},
		],
		callback: (e) => {
			if (!self) return
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid output channels selected')
				return
			}

			const op = e.options?.operation || 'toggle'

			for (const ch of chs) {
				if (op === 'toggle') {
					if (typeof self._toggleOutputPolarity === 'function') {
						self._toggleOutputPolarity(ch)
					} else {
						const current = !!self?.outputPolarity?.[ch]
						const next = !current
						if (typeof self._cmdSendLine === 'function') {
							self._cmdSendLine(`/processing/output/${ch}/polarity_reversal=${next ? 'true' : 'false'}`)
						}
						if (typeof self._applyOutputPolarity === 'function') {
							self._applyOutputPolarity(ch, next)
						} else if (self?.outputPolarity) {
							self.outputPolarity[ch] = next
							if (typeof self.setVariableValues === 'function') {
								self.setVariableValues({ [`output_${ch}_polarity`]: next ? 'Reverse' : 'Normal' })
							}
						}
					}
					continue
				}

				const want = op === 'on'
				if (typeof self._setOutputPolarity === 'function') {
					self._setOutputPolarity(ch, want)
				} else {
					if (typeof self._cmdSendLine === 'function') {
						self._cmdSendLine(`/processing/output/${ch}/polarity_reversal=${want ? 'true' : 'false'}`)
					}
					if (typeof self._applyOutputPolarity === 'function') {
						self._applyOutputPolarity(ch, want)
					} else if (self?.outputPolarity) {
						self.outputPolarity[ch] = want
						if (typeof self.setVariableValues === 'function') {
							self.setVariableValues({ [`output_${ch}_polarity`]: want ? 'Reverse' : 'Normal' })
						}
					}
				}
			}
		},
	}

	// =========================
	// ===== DELAY =============
	// =========================

	actions['output_delay_set'] = {
		name: 'Output: Delay',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: [],
				choices: outputChoicesFriendly,
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
				max: 2000,
				step: 0.01,
				isVisible: (o) => o.type !== 'unchanged',
			},
		],
		callback: (e) => {
			if (!self) return
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid output channels selected')
				return
			}
			const typeId = String(e.options.type || 'unchanged')
			const valueRaw = Number(e.options.value)
			const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
			const roundTo01 = (v) => Math.round(v / 0.01) * 0.01

			const valueToMs = (val, typeKey) => {
				const n = Number(val)
				if (!Number.isFinite(n)) return 0
				const SPEED_FT_PER_SEC = 1125 // fixed for consistency with Galaxy display expectations
				const SPEED_M_PER_SEC = 343 // approx speed of sound at room temp
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
				if (typeId === 'unchanged') continue
				const msFromValue = valueToMs(valueRaw, typeId)
				const targetMs = roundTo01(clamp(msFromValue, 0, 2000))

				if (typeof self._setOutputDelayMs === 'function') {
					self._setOutputDelayMs(ch, targetMs)
				} else if (typeof self._cmdSendLine === 'function') {
					const samples = Math.round(targetMs * 96)
					self._cmdSendLine(`/processing/output/${ch}/delay=${samples}`)
					if (typeof self._applyOutputDelay === 'function') {
						self._applyOutputDelay(ch, samples)
					}
				}
			}
		},
	}

	// =================================
	// ===== ATMOSPHERIC CORRECTION ====
	// =================================

	const ATMOS_GAIN_CHOICES = Array.from({ length: 10 }, (_, i) => {
		const pct = (i + 1) * 10
		return { id: String(pct), label: `${pct}%` }
	})

	const applyAtmosphericLocal = (ch, field, value) => {
		if (typeof self._applyOutputAtmospheric === 'function') {
			self._applyOutputAtmospheric(ch, field, value)
		} else {
			if (!self.outputAtmospheric) self.outputAtmospheric = {}
			if (!self.outputAtmospheric[ch]) self.outputAtmospheric[ch] = {}
			self.outputAtmospheric[ch][field] = value
		}
	}

	const ATMOS_LINE_OPTIONS = []
	const MAX_LINES = Math.min(16, NUM_OUTPUTS)
	for (let i = 1; i <= MAX_LINES; i++) {
		const visibleExpr = new Function('o', `return Number(o.count || 0) >= ${i}`)
		ATMOS_LINE_OPTIONS.push({
			type: 'number',
			id: `distance_${i}`,
			label: `Line ${i}: Distance (m)`,
			default: 10,
			min: 1,
			max: 150,
			step: 1,
			isVisible: visibleExpr,
		})
		ATMOS_LINE_OPTIONS.push({
			type: 'dropdown',
			id: `gain_${i}`,
			label: `Line ${i}: Gain (%)`,
			default: '10',
			choices: ATMOS_GAIN_CHOICES,
			isVisible: visibleExpr,
		})
		if (i < MAX_LINES) {
			ATMOS_LINE_OPTIONS.push({
				type: 'static-text',
				id: `line_sep_${i}`,
				label: '',
				value: ' ',
				isVisible: visibleExpr,
			})
		}
	}

	actions['output_atmospheric_block'] = {
		name: 'Output: Atmospheric block (multi-channel)',
		options: [
			{
				type: 'dropdown',
				id: 'start_output',
				label: 'Start output',
				default: '1',
				choices: outputChoicesFriendly,
			},
			{
				type: 'dropdown',
				id: 'count',
				label: 'How many outputs',
				default: String(Math.min(8, MAX_LINES)),
				choices: Array.from({ length: MAX_LINES }, (_, i) => {
					const n = i + 1
					return { id: String(n), label: `${n}` }
				}),
			},
			{
				type: 'checkbox',
				id: 'bypass',
				label: 'Bypass ON (apply to all selected)',
				default: false,
			},
			...ATMOS_LINE_OPTIONS,
		],
		callback: (e) => {
			if (!self || typeof self._cmdSendLine !== 'function') return

			const start = Math.max(1, Math.min(NUM_OUTPUTS, Number(e.options.start_output || 1)))
			const requestedCount = Number(e.options.count || 1)
			const count = Math.max(1, Math.min(MAX_LINES, Math.min(requestedCount, NUM_OUTPUTS - start + 1)))
			const bypass = !!e.options.bypass

			for (let i = 1; i <= count; i++) {
				const ch = start + i - 1
				if (ch > NUM_OUTPUTS) break

				const distRaw = Number(e.options[`distance_${i}`])
				const gainRaw = Number(e.options[`gain_${i}`])

				const distance = Number.isFinite(distRaw) ? Math.max(1, Math.min(150, Math.round(distRaw))) : 1
				const gain = Number.isFinite(gainRaw)
					? Math.round(Math.max(10, Math.min(100, gainRaw)) / 10) * 10
					: 10

				self._cmdSendLine(`/processing/output/${ch}/atmospheric/bypass=${bypass ? 'true' : 'false'}`)
				self._cmdSendLine(`/processing/output/${ch}/atmospheric/distance=${distance}`)
				self._cmdSendLine(`/processing/output/${ch}/atmospheric/gain=${gain}`)

				applyAtmosphericLocal(ch, 'bypass', bypass)
				applyAtmosphericLocal(ch, 'distance', distance)
				applyAtmosphericLocal(ch, 'gain', gain)
			}
		},
	}

	actions['output_atmospheric_single'] = {
		name: 'Output: Atmospheric (single output)',
		options: [
			{
				type: 'dropdown',
				id: 'ch',
				label: 'Output',
				default: '1',
				choices: outputChoicesFriendly,
			},
			{
				type: 'checkbox',
				id: 'bypass',
				label: 'Bypass ON',
				default: false,
			},
			{
				type: 'number',
				id: 'distance',
				label: 'Distance (m)',
				default: 10,
				min: 1,
				max: 150,
				step: 1,
			},
			{
				type: 'dropdown',
				id: 'gain',
				label: 'Gain (%)',
				default: '10',
				choices: ATMOS_GAIN_CHOICES,
			},
		],
		callback: (e) => {
			if (!self || typeof self._cmdSendLine !== 'function') return
			const ch = Number(e.options.ch || 1)
			if (!Number.isFinite(ch) || ch < 1 || ch > NUM_OUTPUTS) {
				self.log?.('warn', 'Invalid output channel selected')
				return
			}
			const bypass = !!e.options.bypass
			const distRaw = Number(e.options.distance)
			const gainRaw = Number(e.options.gain)
			const distance = Number.isFinite(distRaw) ? Math.max(1, Math.min(150, Math.round(distRaw))) : 1
			const gain = Number.isFinite(gainRaw) ? Math.round(Math.max(10, Math.min(100, gainRaw)) / 10) * 10 : 10

			self._cmdSendLine(`/processing/output/${ch}/atmospheric/bypass=${bypass ? 'true' : 'false'}`)
			self._cmdSendLine(`/processing/output/${ch}/atmospheric/distance=${distance}`)
			self._cmdSendLine(`/processing/output/${ch}/atmospheric/gain=${gain}`)

			applyAtmosphericLocal(ch, 'bypass', bypass)
			applyAtmosphericLocal(ch, 'distance', distance)
			applyAtmosphericLocal(ch, 'gain', gain)
		},
	}

	// ================================
	// ===== HF ATTENUATION CURVE =====
	// ================================

	actions['output_hf_attenuation'] = {
		name: 'Output: HF attenuation',
		description:
			'Apply a log-shaped HF attenuation curve to U-Shaping Band 5 across consecutive outputs (+2.67 to 0 dB, then 0 to -5.33 dB). Uses the first half of the selected array for the positive portion and the second half for the negative portion.',
		options: [
			{
				type: 'dropdown',
				id: 'start_output',
				label: 'Start output',
				default: '1',
				choices: outputChoicesFriendly,
			},
			{
				type: 'number',
				id: 'total',
				label: 'Number of loudspeakers',
				default: NUM_OUTPUTS,
				min: 1,
				max: NUM_OUTPUTS,
				step: 1,
			},
			{
				type: 'number',
				id: 'ratio',
				label: 'HF shading span (dB)',
				tooltip: 'Total dB span to split 1/3 positive and 2/3 negative across the array (default 8 dB).',
				default: 8,
				min: 0.1,
				max: 24,
				step: 0.1,
			},
		],
		callback: (e) => {
			if (!self || typeof self._cmdSendLine !== 'function') return

			const start = Math.max(1, Math.min(NUM_OUTPUTS, Math.round(Number(e.options.start_output) || 1)))

			const totalRaw = Number(e.options.total)
			let total = Number.isFinite(totalRaw) ? Math.round(totalRaw) : NUM_OUTPUTS
			total = Math.max(1, Math.min(total, NUM_OUTPUTS - start + 1))

			// Use half the selected array length as the positive-curve span (e.g., 1-8 on a 16-box array)
			const span = Math.max(1, Math.ceil(total / 2))
			const logBase = Math.log(span)
			if (!Number.isFinite(logBase) || logBase <= 0) {
				self.log?.('warn', 'HF attenuation: invalid span (must be > 1)')
				return
			}

			const ratioRaw = Number(e.options.ratio)
			const totalSwing = Math.max(0.1, Math.min(24, Number.isFinite(ratioRaw) ? ratioRaw : 8))
			const posMax = totalSwing / 3 // 1/3 positive
			const negMax = (totalSwing * 2) / 3 // 2/3 negative

			const band4Frequency = 8000
			const band4Slope = 1 // 6 dB/oct

			const roundTenth = (v) => {
				const r = Math.round(v * 10) / 10
				return Object.is(r, -0) ? 0 : r
			}

			const assignments = []

			for (let i = 0; i < total; i++) {
				const boxIndex = i + 1
				const ch = start + i
				if (ch > NUM_OUTPUTS) break

				let rawDb
				if (boxIndex <= span) {
					const t = Math.log(boxIndex) / logBase
					rawDb = posMax * (1 - t)
				} else {
					const j = Math.max(1, 2 * span - boxIndex + 1)
					const s = (logBase - Math.log(j)) / logBase
					rawDb = -negMax * s
				}

				const db = roundTenth(rawDb)
				// Update local state for U-Shaping Bands 4 (freq/slope) and 5 (HF gain)
				if (!self.outputUShaping) self.outputUShaping = {}
				if (!self.outputUShaping[ch]) self.outputUShaping[ch] = {}
				if (!self.outputUShaping[ch][4]) self.outputUShaping[ch][4] = {}
				if (!self.outputUShaping[ch][5]) self.outputUShaping[ch][5] = {}

				self.outputUShaping[ch][4].frequency = band4Frequency
				self.outputUShaping[ch][4].slope = band4Slope
				self.outputUShaping[ch][5].gain = db

				// Send to device
				self._cmdSendLine(`/processing/output/${ch}/ushaping/4/frequency=${band4Frequency}`)
				self._cmdSendLine(`/processing/output/${ch}/ushaping/4/slope=${band4Slope}`)
				self._cmdSendLine(`/processing/output/${ch}/ushaping/5/gain=${db}`)

				// Update variable value if available
				if (typeof self.setVariableValues === 'function') {
					self.setVariableValues({
						[`output_${ch}_ushaping_band4_frequency`]: Math.round(band4Frequency).toString(),
						[`output_${ch}_ushaping_band4_slope`]: Math.round(band4Slope).toString(),
						[`output_${ch}_ushaping_band5_gain`]: db.toFixed(1),
					})
				}

				assignments.push(`${ch}:${db.toFixed(1)} dB`)
			}

			if (assignments.length > 0) {
				self.log?.(
					'info',
					`HF attenuation from output ${start} (${total} speakers, span ${span}, total ${totalSwing.toFixed(1)} dB, +1/3:${posMax.toFixed(2)} / -2/3:${negMax.toFixed(2)}): ${assignments.join(', ')}`,
				)
			}
		},
	}

	// ================================
	// ===== PRODUCT INTEGRATION ======
	// ================================

	// Get product integration data from self.constructor (attached in main.js)
	const PRODUCT_INTEGRATION_DATA_PI = self.constructor.PRODUCT_INTEGRATION_DATA || {}
	const STARTING_POINTS_SOURCE_PI = self.constructor.STARTING_POINTS_SOURCE || {}
	const productIntegrationSpeakerChoices = PRODUCT_INTEGRATION_DATA_PI.speakerChoices || [{ id: 'OFF', label: 'Off' }]
	const productIntegrationPhaseOptionDefs = PRODUCT_INTEGRATION_DATA_PI.phaseOptionDefs || []
	const productIntegrationStartingPointOptionDefs = PRODUCT_INTEGRATION_DATA_PI.startingPointOptionDefs || []
	const productIntegrationSpeakerPhaseGroup = PRODUCT_INTEGRATION_DATA_PI.speakerPhaseGroup || new Map()
	const productIntegrationLookup = PRODUCT_INTEGRATION_DATA_PI.lookup || new Map()
	const productIntegrationSpeakers = PRODUCT_INTEGRATION_DATA_PI.speakers || new Map()
	const productIntegrationSpeakerStartingPointOption = PRODUCT_INTEGRATION_DATA_PI.speakerStartingPointOption || new Map()
	const productIntegrationStartingPoints = PRODUCT_INTEGRATION_DATA_PI.startingPoints || new Map()

	// Import FACTORY_RESET_COMMANDS from actions-data
	const { FACTORY_RESET_COMMANDS } = require('../actions-data')

	actions['output_product_integration_set'] = {
		name: 'Output: Set product integration',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: [],
				choices: outputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'dropdown',
				id: 'speaker',
				label: 'Loudspeaker',
				default: 'OFF',
				choices: productIntegrationSpeakerChoices,
			},
			...productIntegrationPhaseOptionDefs,
			...productIntegrationStartingPointOptionDefs,
			{
				type: 'checkbox',
				id: 'mixed_array_compensation',
				label: 'Apply mixed array compensation',
				tooltip: (o) => {
					const speakerKey = String(o.speaker || '')
					const compensation = STARTING_POINTS_SOURCE_PI.compensation || {}
					const compData = compensation[speakerKey]
					if (compData?.label) {
						return `${compData.label} (${compData.delayMs} ms)`
					}
					return 'Apply delay compensation for mixed arrays'
				},
				default: false,
				isVisible: (o) => {
					const speakerKey = String(o.speaker || '')
					// Only show for LEO, LEOPARD, or MINA
					return speakerKey === 'LEO' || speakerKey === 'LEOPARD' || speakerKey === 'MINA'
				},
			},
			{
				type: 'checkbox',
				id: 'reset_channel',
				label: 'Reset channel to factory defaults before applying',
				default: false,
			},
		],
		callback: (e) => {
			if (!self || typeof self._cmdSendLine !== 'function') return

			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid output channels selected')
				return
			}

			const speakerKey = String(e.options?.speaker || 'OFF')
			const phaseOptionId = productIntegrationSpeakerPhaseGroup.get(speakerKey)
			let requestedPhase = ''
			if (phaseOptionId) {
				requestedPhase = String(e.options?.[phaseOptionId] || '')
			}
			let typeId = null

			if (speakerKey === 'OFF') {
				typeId = productIntegrationLookup.get('OFF|') || '1'
			} else {
				const speakerEntry = productIntegrationSpeakers.get(speakerKey)
				let phaseKey = requestedPhase
				if ((!phaseKey || phaseKey === '') && speakerEntry?.phases?.[0]?.id) {
					phaseKey = speakerEntry.phases[0].id
				}

				if (typeof phaseKey === 'string' && phaseKey.length > 0) {
					typeId = productIntegrationLookup.get(`${speakerKey}|${phaseKey}`)
					if (!typeId && speakerEntry?.phases) {
						const exact = speakerEntry.phases.find((p) => p.id === phaseKey)
						if (exact?.typeId) typeId = exact.typeId
					}
				}

				if (!typeId && speakerEntry?.phases?.length > 0) {
					const fallbackPhase = speakerEntry.phases[0]
					phaseKey = fallbackPhase?.id ?? ''
					typeId = fallbackPhase?.typeId ?? null
				}
			}

			if (!typeId) {
				self.log?.('warn', `Invalid product integration selection for speaker ${speakerKey}`)
				return
			}

			let startingPointCommands = null
			let startingPointTitle = ''
			if (speakerKey !== 'OFF') {
				const startingOptionId = productIntegrationSpeakerStartingPointOption.get(speakerKey)
				if (startingOptionId) {
					const selectionId = String(e.options?.[startingOptionId] ?? '').trim()
					if (selectionId) {
						const entries = productIntegrationStartingPoints.get(speakerKey) || []
						const entry = entries.find((sp) => sp.id === selectionId)
						if (entry && Array.isArray(entry.controlPoints) && entry.controlPoints.length > 0) {
							startingPointCommands = entry.controlPoints
							startingPointTitle = entry.title || ''
						}
					}
				}
			}

			const finalTypeId = String(typeId)
			const shouldReset = e.options.reset_channel === true

			for (const ch of chs) {
				// Apply factory reset if checkbox is enabled
				if (shouldReset) {
					for (const resetCmd of FACTORY_RESET_COMMANDS) {
						const cmd = resetCmd.replace(/\{ch\}/g, ch)
						self._cmdSendLine(cmd)
					}
				}

				// Apply product integration type
				self._cmdSendLine(`/processing/output/${ch}/delay_integration/type=${finalTypeId}`)

				// Apply starting point commands if any
				if (startingPointCommands && startingPointCommands.length) {
					for (const rawCmd of startingPointCommands) {
						let cmd = String(rawCmd || '').trim()
						if (!cmd) continue
						if (cmd.includes('{}')) {
							cmd = cmd.replace(/\{\}/g, ch)
						} else if (cmd.includes('{ch}')) {
							cmd = cmd.replace(/\{ch\}/gi, ch)
						}
						self._cmdSendLine(cmd)
					}
				}

				// Apply mixed array compensation if enabled
				if (e.options.mixed_array_compensation === true) {
					const compensation = STARTING_POINTS_SOURCE_PI.compensation || {}
					const compData = compensation[speakerKey]
					if (compData && typeof compData.delayMs === 'number') {
						const compensationMs = compData.delayMs
						// Get current delay and add compensation
						const currentDelayObj = self?.outputDelay?.[ch]
						const currentDelayMs = currentDelayObj?.ms || 0
						const currentDelaySamples = currentDelayObj?.samples || 0
						const totalDelayMs = currentDelayMs + compensationMs
						const totalSamples = Math.round(totalDelayMs * 96)
						self.log?.(
							'info',
							`Ch ${ch}: Applying compensation: current=${currentDelayMs.toFixed(2)}ms (${currentDelaySamples} samples) + ${compensationMs.toFixed(2)}ms = ${totalDelayMs.toFixed(2)}ms (${totalSamples} samples) | Command: /processing/output/${ch}/delay=${totalSamples}`,
						)
						if (typeof self._setOutputDelayMs === 'function') {
							self._setOutputDelayMs(ch, totalDelayMs)
						}
					}
				}
			}

			// Log the operation
			const resetMsg = shouldReset ? ' (with factory reset)' : ''
			let compensationMsg = ''
			if (e.options.mixed_array_compensation === true) {
				const compensation = STARTING_POINTS_SOURCE_PI.compensation || {}
				const compData = compensation[speakerKey]
				if (compData && typeof compData.delayMs === 'number') {
					compensationMsg = ` with ${compData.delayMs.toFixed(2)} ms mixed array compensation`
				}
			}
			if (startingPointCommands && startingPointTitle) {
				self.log?.(
					'info',
					`Applied starting point "${startingPointTitle}" for speaker ${speakerKey} on outputs ${chs.join(', ')}${resetMsg}${compensationMsg}`,
				)
			} else if (shouldReset || compensationMsg) {
				self.log?.(
					'info',
					`Applied product integration for speaker ${speakerKey} on outputs ${chs.join(', ')}${resetMsg}${compensationMsg}`,
				)
			}
		},
	}

	// =========================
	// ===== FILTERS ===========
	// =========================

	// HIGHPASS FILTER

	// Note: FILTER_TYPE_CHOICES_HP should be imported from shared constants
	const FILTER_TYPE_CHOICES_HP = [
		{ id: '1', label: 'Butterworth 6 dB/oct' },
		{ id: '2', label: 'Butterworth 12 dB/oct' },
		{ id: '3', label: 'Butterworth 18 dB/oct' },
		{ id: '4', label: 'Butterworth 24 dB/oct' },
		{ id: '5', label: 'Butterworth 30 dB/oct' },
		{ id: '6', label: 'Butterworth 36 dB/oct' },
		{ id: '7', label: 'Butterworth 42 dB/oct' },
		{ id: '8', label: 'Butterworth 48 dB/oct' },
		{ id: '9', label: 'Linkwitz-Riley 12 dB/oct' },
		{ id: '10', label: 'Linkwitz-Riley 24 dB/oct' },
		{ id: '11', label: 'Linkwitz-Riley 48 dB/oct' },
		{ id: '12', label: 'Bessel 12 dB/oct' },
	]

	actions['output_highpass_bypass'] = {
		name: 'Output: High-pass bypass control',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: [],
				choices: outputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'dropdown',
				id: 'operation',
				label: 'Operation',
				default: 'toggle',
				choices: [
					{ id: 'on', label: 'Enabled' },
					{ id: 'off', label: 'Bypassed' },
					{ id: 'toggle', label: 'Toggle' },
				],
			},
		],
		callback: (e) => {
			if (!self) return
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid output channels selected')
				return
			}
			const op = String(e.options?.operation || 'toggle')
			for (const ch of chs) {
				if (op === 'toggle') {
					if (typeof self._toggleOutputHighpassBypass === 'function') {
						self._toggleOutputHighpassBypass(ch)
					} else if (typeof self._setOutputHighpassBypass === 'function') {
						const current = !!self?.outputHighpass?.[ch]?.bypass
						self._setOutputHighpassBypass(ch, !current)
					} else {
						const current = !!self?.outputHighpass?.[ch]?.bypass
						const next = !current
						if (typeof self._cmdSendLine === 'function') {
							self._cmdSendLine(`/processing/output/${ch}/highpass/bypass=${next ? 'true' : 'false'}`)
						}
						if (typeof self._applyOutputFilter === 'function') {
							self._applyOutputFilter('highpass', ch, 'bypass', next)
						}
					}
					continue
				}

				const wantEngaged = op === 'Enabled'
				const bypass = !wantEngaged
				if (typeof self._setOutputHighpassBypass === 'function') {
					self._setOutputHighpassBypass(ch, bypass)
				} else {
					if (typeof self._cmdSendLine === 'function') {
						self._cmdSendLine(`/processing/output/${ch}/highpass/bypass=${bypass ? 'true' : 'false'}`)
					}
					if (typeof self._applyOutputFilter === 'function') {
						self._applyOutputFilter('highpass', ch, 'bypass', bypass)
					}
				}
			}
		},
	}

	actions['output_highpass_frequency'] = {
		name: 'Output: High-pass frequency',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: [],
				choices: outputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'number',
				id: 'frequency',
				label: 'Frequency (Hz)',
				default: 40,
				min: 5,
				max: 20000,
				step: 1,
			},
		],
		callback: (e) => {
			if (!self) return
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid output channels selected')
				return
			}
			const hz = Number(e.options?.frequency)
			if (!Number.isFinite(hz)) {
				self.log?.('warn', 'Invalid high-pass frequency')
				return
			}
			for (const ch of chs) {
				if (typeof self._setOutputHighpassFrequency === 'function') {
					self._setOutputHighpassFrequency(ch, hz)
				} else {
					const clamped = Math.max(5, Math.min(20000, hz))
					if (typeof self._cmdSendLine === 'function') {
						self._cmdSendLine(`/processing/output/${ch}/highpass/frequency=${clamped}`)
					}
					if (typeof self._applyOutputFilter === 'function') {
						self._applyOutputFilter('highpass', ch, 'frequency', clamped)
					}
				}
			}
		},
	}

	actions['output_highpass_type'] = {
		name: 'Output: High-pass type',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: [],
				choices: outputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'dropdown',
				id: 'type',
				label: 'Filter type',
				default: '11',
				choices: FILTER_TYPE_CHOICES_HP,
			},
		],
		callback: (e) => {
			if (!self) return
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid output channels selected')
				return
			}
			const typeId = Number(e.options?.type)
			if (!Number.isFinite(typeId)) {
				self.log?.('warn', 'Invalid high-pass type selection')
				return
			}
			const rounded = Math.max(1, Math.min(12, Math.round(typeId)))
			for (const ch of chs) {
				if (typeof self._setOutputHighpassType === 'function') {
					self._setOutputHighpassType(ch, rounded)
				} else {
					if (typeof self._cmdSendLine === 'function') {
						self._cmdSendLine(`/processing/output/${ch}/highpass/type=${rounded}`)
					}
					if (typeof self._applyOutputFilter === 'function') {
						self._applyOutputFilter('highpass', ch, 'type', rounded)
					}
				}
			}
		},
	}

	actions['output_highpass_configure'] = {
		name: 'Output: High-pass configure',
		description: 'Set high-pass filter state, frequency, and type in one action.',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: [],
				choices: outputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'dropdown',
				id: 'state',
				label: 'Filter state',
				default: 'on',
				choices: [
					{ id: 'on', label: 'Enabled' },
					{ id: 'off', label: 'Bypassed' },
				],
			},
			{
				type: 'number',
				id: 'frequency',
				label: 'Frequency (Hz)',
				default: 40,
				min: 5,
				max: 20000,
				step: 1,
			},
			{
				type: 'dropdown',
				id: 'type',
				label: 'Filter type',
				default: '11',
				choices: FILTER_TYPE_CHOICES_HP,
			},
		],
		callback: (e) => {
			if (!self) return
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid output channels selected')
				return
			}

			const engage = String(e.options?.state || 'on') === 'on'
			const bypass = !engage

			const hzRaw = Number(e.options?.frequency)
			const hz = Number.isFinite(hzRaw) ? Math.max(5, Math.min(20000, hzRaw)) : null

			const typeIdRaw = Number(e.options?.type)
			const typeId = Number.isFinite(typeIdRaw) ? Math.max(1, Math.min(12, Math.round(typeIdRaw))) : null

			for (const ch of chs) {
				if (hz !== null) {
					if (typeof self._setOutputHighpassFrequency === 'function') {
						self._setOutputHighpassFrequency(ch, hz)
					} else {
						if (typeof self._cmdSendLine === 'function')
							self._cmdSendLine(`/processing/output/${ch}/highpass/frequency=${hz}`)
						if (typeof self._applyOutputFilter === 'function') self._applyOutputFilter('highpass', ch, 'frequency', hz)
					}
				}

				if (typeId !== null) {
					if (typeof self._setOutputHighpassType === 'function') {
						self._setOutputHighpassType(ch, typeId)
					} else {
						if (typeof self._cmdSendLine === 'function')
							self._cmdSendLine(`/processing/output/${ch}/highpass/type=${typeId}`)
						if (typeof self._applyOutputFilter === 'function') self._applyOutputFilter('highpass', ch, 'type', typeId)
					}
				}

				if (typeof self._setOutputHighpassBypass === 'function') {
					self._setOutputHighpassBypass(ch, bypass)
				} else {
					if (typeof self._cmdSendLine === 'function')
						self._cmdSendLine(`/processing/output/${ch}/highpass/bypass=${bypass ? 'true' : 'false'}`)
					if (typeof self._applyOutputFilter === 'function') self._applyOutputFilter('highpass', ch, 'bypass', bypass)
				}
			}
		},
	}

	// LOWPASS FILTER

	// Note: FILTER_TYPE_CHOICES_LP should be imported from shared constants
	const FILTER_TYPE_CHOICES_LP = [
		{ id: '1', label: 'Butterworth 6 dB/oct' },
		{ id: '2', label: 'Butterworth 12 dB/oct' },
		{ id: '3', label: 'Butterworth 18 dB/oct' },
		{ id: '4', label: 'Butterworth 24 dB/oct' },
		{ id: '5', label: 'Butterworth 30 dB/oct' },
		{ id: '6', label: 'Butterworth 36 dB/oct' },
		{ id: '7', label: 'Butterworth 42 dB/oct' },
		{ id: '8', label: 'Butterworth 48 dB/oct' },
		{ id: '9', label: 'Linkwitz-Riley 12 dB/oct' },
		{ id: '10', label: 'Linkwitz-Riley 24 dB/oct' },
		{ id: '11', label: 'Linkwitz-Riley 48 dB/oct' },
	]

	actions['output_lowpass_bypass'] = {
		name: 'Output: Low-pass bypass control',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: [],
				choices: outputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'dropdown',
				id: 'operation',
				label: 'Operation',
				default: 'toggle',
				choices: [
					{ id: 'on', label: 'Enabled' },
					{ id: 'off', label: 'Bypassed' },
					{ id: 'toggle', label: 'Toggle' },
				],
			},
		],
		callback: (e) => {
			if (!self) return
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid output channels selected')
				return
			}
			const op = String(e.options?.operation || 'toggle')
			for (const ch of chs) {
				if (op === 'toggle') {
					if (typeof self._toggleOutputLowpassBypass === 'function') {
						self._toggleOutputLowpassBypass(ch)
					} else if (typeof self._setOutputLowpassBypass === 'function') {
						const current = !!self?.outputLowpass?.[ch]?.bypass
						self._setOutputLowpassBypass(ch, !current)
					} else {
						const current = !!self?.outputLowpass?.[ch]?.bypass
						const next = !current
						if (typeof self._cmdSendLine === 'function') {
							self._cmdSendLine(`/processing/output/${ch}/lowpass/bypass=${next ? 'true' : 'false'}`)
						}
						if (typeof self._applyOutputFilter === 'function') {
							self._applyOutputFilter('lowpass', ch, 'bypass', next)
						}
					}
					continue
				}

				const wantEngaged = op === 'on'
				const bypass = !wantEngaged
				if (typeof self._setOutputLowpassBypass === 'function') {
					self._setOutputLowpassBypass(ch, bypass)
				} else {
					if (typeof self._cmdSendLine === 'function') {
						self._cmdSendLine(`/processing/output/${ch}/lowpass/bypass=${bypass ? 'true' : 'false'}`)
					}
					if (typeof self._applyOutputFilter === 'function') {
						self._applyOutputFilter('lowpass', ch, 'bypass', bypass)
					}
				}
			}
		},
	}

	actions['output_lowpass_frequency'] = {
		name: 'Output: Low-pass frequency',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: [],
				choices: outputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'number',
				id: 'frequency',
				label: 'Frequency (Hz)',
				default: 160,
				min: 10,
				max: 20000,
				step: 1,
			},
		],
		callback: (e) => {
			if (!self) return
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid output channels selected')
				return
			}
			const hz = Number(e.options?.frequency)
			if (!Number.isFinite(hz)) {
				self.log?.('warn', 'Invalid low-pass frequency')
				return
			}
			for (const ch of chs) {
				if (typeof self._setOutputLowpassFrequency === 'function') {
					self._setOutputLowpassFrequency(ch, hz)
				} else {
					const clamped = Math.max(10, Math.min(20000, hz))
					if (typeof self._cmdSendLine === 'function') {
						self._cmdSendLine(`/processing/output/${ch}/lowpass/frequency=${clamped}`)
					}
					if (typeof self._applyOutputFilter === 'function') {
						self._applyOutputFilter('lowpass', ch, 'frequency', clamped)
					}
				}
			}
		},
	}

	actions['output_lowpass_type'] = {
		name: 'Output: Low-pass type',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: [],
				choices: outputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'dropdown',
				id: 'type',
				label: 'Filter type',
				default: '11',
				choices: FILTER_TYPE_CHOICES_LP,
			},
		],
		callback: (e) => {
			if (!self) return
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid output channels selected')
				return
			}
			const typeId = Number(e.options?.type)
			if (!Number.isFinite(typeId)) {
				self.log?.('warn', 'Invalid low-pass type selection')
				return
			}
			const rounded = Math.max(1, Math.min(11, Math.round(typeId)))
			for (const ch of chs) {
				if (typeof self._setOutputLowpassType === 'function') {
					self._setOutputLowpassType(ch, rounded)
				} else {
					if (typeof self._cmdSendLine === 'function') {
						self._cmdSendLine(`/processing/output/${ch}/lowpass/type=${rounded}`)
					}
					if (typeof self._applyOutputFilter === 'function') {
						self._applyOutputFilter('lowpass', ch, 'type', rounded)
					}
				}
			}
		},
	}

	actions['output_lowpass_configure'] = {
		name: 'Output: Low-pass configure',
		description: 'Set low-pass filter state, frequency, and type in one action.',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: [],
				choices: outputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'dropdown',
				id: 'state',
				label: 'Filter state',
				default: 'on',
				choices: [
					{ id: 'on', label: 'Enabled' },
					{ id: 'off', label: 'Bypassed' },
				],
			},
			{
				type: 'number',
				id: 'frequency',
				label: 'Frequency (Hz)',
				default: 160,
				min: 10,
				max: 20000,
				step: 1,
			},
			{
				type: 'dropdown',
				id: 'type',
				label: 'Filter type',
				default: '11',
				choices: FILTER_TYPE_CHOICES_LP,
			},
		],
		callback: (e) => {
			if (!self) return
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid output channels selected')
				return
			}

			const engage = String(e.options?.state || 'on') === 'on'
			const bypass = !engage

			const hzRaw = Number(e.options?.frequency)
			const hz = Number.isFinite(hzRaw) ? Math.max(10, Math.min(20000, hzRaw)) : null

			const typeIdRaw = Number(e.options?.type)
			const typeId = Number.isFinite(typeIdRaw) ? Math.max(1, Math.min(11, Math.round(typeIdRaw))) : null

			for (const ch of chs) {
				if (hz !== null) {
					if (typeof self._setOutputLowpassFrequency === 'function') {
						self._setOutputLowpassFrequency(ch, hz)
					} else {
						if (typeof self._cmdSendLine === 'function')
							self._cmdSendLine(`/processing/output/${ch}/lowpass/frequency=${hz}`)
						if (typeof self._applyOutputFilter === 'function') self._applyOutputFilter('lowpass', ch, 'frequency', hz)
					}
				}

				if (typeId !== null) {
					if (typeof self._setOutputLowpassType === 'function') {
						self._setOutputLowpassType(ch, typeId)
					} else {
						if (typeof self._cmdSendLine === 'function')
							self._cmdSendLine(`/processing/output/${ch}/lowpass/type=${typeId}`)
						if (typeof self._applyOutputFilter === 'function') self._applyOutputFilter('lowpass', ch, 'type', typeId)
					}
				}

				if (typeof self._setOutputLowpassBypass === 'function') {
					self._setOutputLowpassBypass(ch, bypass)
				} else {
					if (typeof self._cmdSendLine === 'function')
						self._cmdSendLine(`/processing/output/${ch}/lowpass/bypass=${bypass ? 'true' : 'false'}`)
					if (typeof self._applyOutputFilter === 'function') self._applyOutputFilter('lowpass', ch, 'bypass', bypass)
				}
			}
		},
	}

	// ALLPASS FILTER

	// Note: ALLPASS_BAND_CHOICES should be imported from shared constants
	const ALLPASS_BAND_CHOICES = [
		{ id: '1', label: 'Band 1' },
		{ id: '2', label: 'Band 2' },
		{ id: '3', label: 'Band 3' },
	]

	actions['output_allpass_bypass'] = {
		name: 'Output: All-pass bypass control',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: [],
				choices: outputChoicesFriendly,
				minSelection: 0,
			},
			{
				type: 'dropdown',
				id: 'band',
				label: 'Band',
				default: '1',
				choices: ALLPASS_BAND_CHOICES,
			},
			{
				type: 'dropdown',
				id: 'operation',
				label: 'Operation',
				default: 'toggle',
				choices: [
					{ id: 'on', label: 'Enabled' },
					{ id: 'off', label: 'Bypassed' },
					{ id: 'toggle', label: 'Toggle' },
				],
			},
		],
		callback: (e) => {
			if (!self) return
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid output channels selected')
				return
			}
			const band = Math.max(1, Math.min(3, Number(e.options?.band ?? 1)))
			const op = String(e.options?.operation || 'toggle')
			for (const ch of chs) {
				if (op === 'toggle') {
					if (typeof self._toggleOutputAllpassBypass === 'function') {
						self._toggleOutputAllpassBypass(ch, band)
					} else {
						const current = !!self?.outputAllpass?.[ch]?.[band]?.band_bypass
						const next = !current
						if (typeof self._cmdSendLine === 'function')
							self._cmdSendLine(`/processing/output/${ch}/allpass/${band}/band_bypass=${next ? 'true' : 'false'}`)
						if (typeof self._applyOutputAllpass === 'function') self._applyOutputAllpass(ch, band, 'band_bypass', next)
					}
					continue
				}
				const bypass = op !== 'on'
				if (typeof self._setOutputAllpassBypass === 'function') {
					self._setOutputAllpassBypass(ch, band, bypass)
				} else {
					if (typeof self._cmdSendLine === 'function')
						self._cmdSendLine(`/processing/output/${ch}/allpass/${band}/band_bypass=${bypass ? 'true' : 'false'}`)
					if (typeof self._applyOutputAllpass === 'function') self._applyOutputAllpass(ch, band, 'band_bypass', bypass)
				}
			}
		},
	}

	actions['output_allpass_frequency'] = {
		name: 'Output: All-pass frequency',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: [],
				choices: outputChoicesFriendly,
				minSelection: 1,
			},
			{
				type: 'dropdown',
				id: 'band',
				label: 'Band',
				default: '1',
				choices: ALLPASS_BAND_CHOICES,
			},
			{
				type: 'dropdown',
				id: 'mode',
				label: 'Mode',
				default: 'value',
				choices: [
					{ id: 'value', label: 'Set to value' },
					{ id: 'nudge', label: 'Nudge (delta)' },
				],
			},
			{
				type: 'number',
				id: 'frequency',
				label: 'Frequency (Hz)',
				default: 100,
				min: 10,
				max: 20000,
				step: 1,
				isVisible: (o) => o.mode === 'value',
			},
			{
				type: 'number',
				id: 'frequency_delta',
				label: 'Delta (Hz)',
				default: 10,
				min: -20000,
				max: 20000,
				step: 1,
				isVisible: (o) => o.mode === 'nudge',
			},
		],
		callback: (e) => {
			if (!self) return
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid output channels selected')
				return
			}
			const band = Math.max(1, Math.min(3, Number(e.options?.band ?? 1)))
			const mode = e.options.mode === 'nudge' ? 'nudge' : 'value'
			const clamp = (v) => Math.max(10, Math.min(20000, v))

			for (const ch of chs) {
				let targetHz
				if (mode === 'nudge') {
					const fine = Number(e.options.frequency_delta)
					const delta = Number.isFinite(fine) ? fine : 0
					const cur = Number(self?.outputAllpass?.[ch]?.[band]?.frequency)
					const base = Number.isFinite(cur) ? cur : Number(e.options.frequency) || 100
					targetHz = clamp(base + (Number.isFinite(delta) ? delta : 0))
				} else {
					const hz = Number(e.options?.frequency)
					if (!Number.isFinite(hz)) {
						self.log?.('warn', 'Invalid all-pass frequency')
						continue
					}
					targetHz = clamp(hz)
				}

				if (typeof self._setOutputAllpassFrequency === 'function') {
					self._setOutputAllpassFrequency(ch, band, targetHz)
				} else {
					if (typeof self._cmdSendLine === 'function')
						self._cmdSendLine(`/processing/output/${ch}/allpass/${band}/frequency=${targetHz}`)
					if (typeof self._applyOutputAllpass === 'function') self._applyOutputAllpass(ch, band, 'frequency', targetHz)
				}
			}
		},
	}

	actions['output_allpass_q'] = {
		name: 'Output: All-pass Q',
		options: [
			{
				type: 'multidropdown',
				id: 'chs',
				label: 'Output channel(s)',
				default: [],
				choices: outputChoicesFriendly,
				minSelection: 1,
			},
			{
				type: 'dropdown',
				id: 'band',
				label: 'Band',
				default: '1',
				choices: ALLPASS_BAND_CHOICES,
			},
			{
				type: 'dropdown',
				id: 'mode',
				label: 'Mode',
				default: 'value',
				choices: [
					{ id: 'value', label: 'Set to value' },
					{ id: 'nudge', label: 'Nudge (delta)' },
				],
			},
			{
				type: 'number',
				id: 'q',
				label: 'Q value',
				default: 1,
				min: 0.5,
				max: 12,
				step: 0.01,
				isVisible: (o) => o.mode === 'value',
			},
			{
				type: 'number',
				id: 'q_delta',
				label: 'Delta (Q) - fine',
				default: 0.1,
				min: -12,
				max: 12,
				step: 0.01,
				isVisible: (o) => o.mode === 'nudge',
			},
			{
				type: 'number',
				id: 'q_delta_coarse',
				label: 'Delta (Q) - coarse',
				default: 0.5,
				min: -12,
				max: 12,
				step: 0.01,
				isVisible: (o) => o.mode === 'nudge',
			},
		],
		callback: (e) => {
			if (!self) return
			const chs = safeGetChannels(e.options, 'chs', NUM_OUTPUTS)
			if (chs.length === 0) {
				self.log?.('warn', 'No valid output channels selected')
				return
			}
			const band = Math.max(1, Math.min(3, Number(e.options?.band ?? 1)))
			const mode = e.options.mode === 'nudge' ? 'nudge' : 'value'
			const clamp = (v) => Math.max(0.5, Math.min(12, v))

			for (const ch of chs) {
				let targetQ
				if (mode === 'nudge') {
					const fine = Number(e.options.q_delta)
					const coarse = Number(e.options.q_delta_coarse)
					const key = buildRotaryKey(e)
					const isCoarse = key && self._rotaryPressState?.[key]
					const delta = isCoarse && Number.isFinite(coarse) ? coarse : Number.isFinite(fine) ? fine : 0
					const cur = Number(self?.outputAllpass?.[ch]?.[band]?.q)
					const base = Number.isFinite(cur) ? cur : Number(e.options.q) || 1
					targetQ = clamp(base + (Number.isFinite(delta) ? delta : 0))
				} else {
					const qRaw = Number(e.options?.q)
					if (!Number.isFinite(qRaw)) {
						self.log?.('warn', 'Invalid all-pass Q value')
						continue
					}
					targetQ = clamp(qRaw)
				}

				if (typeof self._setOutputAllpassQ === 'function') {
					self._setOutputAllpassQ(ch, band, targetQ)
				} else {
					if (typeof self._cmdSendLine === 'function')
						self._cmdSendLine(`/processing/output/${ch}/allpass/${band}/q=${targetQ}`)
					if (typeof self._applyOutputAllpass === 'function') self._applyOutputAllpass(ch, band, 'q', targetQ)
				}
			}
		},
	}

	actions['output_allpass_q_coarse_mode'] = {
		name: 'Output: All-pass Q Coarse Mode',
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
				self.log?.('warn', 'All-pass coarse mode: no controlId/key available')
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

	// ================================
	// ===== SPEAKER CHASE (Test) =====
	// ================================

	actions['output_chase_start'] = {
		name: 'Speaker test: Start',
		options: [
			{ type: 'dropdown', id: 'start', label: 'First output', default: '1', choices: outputChoicesFriendly },
			{
				type: 'dropdown',
				id: 'end',
				label: 'Last output',
				default: String(Math.min(8, NUM_OUTPUTS)),
				choices: outputChoicesFriendly,
			},
			{
				type: 'dropdown',
				id: 'delay',
				label: 'Delay per step',
				default: '1000',
				choices: [
					{ id: '500', label: '0.5 s' },
					{ id: '1000', label: '1 s' },
					{ id: '2000', label: '2 s' },
					{ id: '3000', label: '3 s' },
					{ id: '5000', label: '5 s' },
					{ id: '10000', label: '10 s' },
					{ id: '15000', label: '15 s' },

				],
			},
			{
				type: 'dropdown',
				id: 'window',
				label: 'Speakers at a time',
				default: '1',
				choices: [
					{ id: '1', label: '1 (solo)' },
					{ id: '2', label: '2 (solo->pair->advance)' },
				],
			},
			{ type: 'checkbox', id: 'loop', label: 'Loop sequence', default: false },
		],
		callback: (e) => {
			if (!self || typeof self._startOutputChase !== 'function') return
			self._startOutputChase(
				Number(e.options.start),
				Number(e.options.end),
				Number(e.options.delay),
				Number(e.options.window),
				!!e.options.loop,
				e?.controlId || e?.event?.controlId || null,
			)
		},
	}

	actions['output_chase_stop'] = {
		name: 'Speaker test: Stop',
		options: [],
		callback: () => {
			if (!self || typeof self._stopOutputChase !== 'function') return
			self._stopOutputChase()
		},
	}
}

module.exports = { registerOutputActions }
