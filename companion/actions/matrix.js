// actions/matrix.js
// Matrix routing actions

const { safeGetChannels, buildMatrixInputChoices, buildMatrixOutputChoices } = require('../actions-helpers')

/**
 * Register matrix-related actions
 * @param {Object} actions - Actions object to populate
 * @param {Object} self - Module instance
 * @param {number} NUM_INPUTS - Number of input channels
 * @param {number} NUM_OUTPUTS - Number of output channels
 */
function registerMatrixActions(actions, self, NUM_INPUTS, NUM_OUTPUTS) {
	const matrixInputChoices = buildMatrixInputChoices(self)
	const matrixOutputChoices = buildMatrixOutputChoices(self, NUM_OUTPUTS)

	// =========================
	// ===== Matrix Routing ====
	// =========================

	actions['matrix_gain'] = {
		name: 'Matrix: Gain',
		options: [
			{
				type: 'multidropdown',
				id: 'matrix_inputs',
				label: 'Matrix input(s)',
				default: [],
				choices: matrixInputChoices,
				minSelection: 0,
			},
			{
				type: 'multidropdown',
				id: 'matrix_outputs',
				label: 'Matrix output(s)',
				default: [],
				choices: matrixOutputChoices,
				minSelection: 0,
			},
			{
				type: 'dropdown',
				id: 'mode',
				label: 'Mode',
				default: 'set',
				choices: [
					{ id: 'set', label: 'Set to value' },
					{ id: 'nudge', label: 'Nudge (delta)' },
					{ id: 'minus6', label: 'Set to -6 dB' },
				],
			},
			{
				type: 'number',
				id: 'gain',
				label: 'Gain (dB)',
				default: 0,
				min: -90,
				max: 20,
				step: 0.1,
				isVisible: (o) => o.mode === 'set',
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
				isVisible: (o) => o.mode === 'nudge',
			},
			{
				type: 'number',
				id: 'fadeMs',
				label: 'Fade duration (ms)',
				default: 0,
				min: 0,
				max: 600000,
				step: 10,
				isVisible: (o) => o.mode !== 'nudge' && o.mode !== 'minus6',
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
				isVisible: (o) => o.mode !== 'nudge' && o.mode !== 'minus6',
			},
		],
		callback: (e) => {
			if (!self) return
			const inputs = safeGetChannels(e.options, 'matrix_inputs', 32)
			const outs = safeGetChannels(e.options, 'matrix_outputs', NUM_OUTPUTS)
			if (inputs.length === 0 || outs.length === 0) {
				self.log?.('warn', 'No valid matrix channels selected')
				return
			}
			const mode = ['nudge', 'minus6'].includes(e.options.mode) ? e.options.mode : 'set'

			if (mode === 'nudge') {
				const d = Number(e.options.delta)
				for (const i of inputs) {
					if (typeof self._nudgeMatrixGainMulti === 'function') {
						self._nudgeMatrixGainMulti(i, outs, d)
					}
				}
				return
			}

			const targetGain = mode === 'minus6' ? -6 : Number.isFinite(Number(e.options.gain)) ? Number(e.options.gain) : 0
			const dur = mode === 'minus6' ? 0 : Math.max(0, Number(e.options.fadeMs) || 0)
			const curve = e.options.curve === 'log' ? 'log' : 'linear'

			for (const i of inputs) {
				if (dur > 0 && typeof self._startMatrixGainFadeMulti === 'function') {
					self._startMatrixGainFadeMulti(i, outs, targetGain, dur, curve)
				} else if (typeof self._setMatrixGainMulti === 'function') {
					self._setMatrixGainMulti(i, outs, targetGain)
				}
			}
		},
	}

	// =========================
	// ===== Matrix Delay ======
	// =========================


	actions['matrix_delay_full'] = {
		name: 'Matrix: Delay',
		options: [
			{
				type: 'multidropdown',
				id: 'matrix_inputs',
				label: 'Matrix input(s)',
				default: [],
				choices: matrixInputChoices,
				minSelection: 0,
			},
			{
				type: 'multidropdown',
				id: 'matrix_outputs',
				label: 'Matrix output(s)',
				default: [],
				choices: matrixOutputChoices,
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
			{
				type: 'dropdown',
				id: 'delay_status',
				label: 'Delay status',
				default: 'unchanged',
				choices: [
					{ id: 'unchanged', label: '— Unchanged —' },
					{ id: 'on', label: 'On' },
					{ id: 'off', label: 'Off' },
					{ id: 'toggle', label: 'Toggle' },
				],
			},
		],
		callback: (e) => {
			if (!self) return
			const inputs = safeGetChannels(e.options, 'matrix_inputs', 32)
			const outs = safeGetChannels(e.options, 'matrix_outputs', NUM_OUTPUTS)
			if (inputs.length === 0 || outs.length === 0) {
				self.log?.('warn', 'No valid matrix channels selected')
				return
			}

			const typeId = String(e.options.type || 'unchanged')
			const valueRaw = Number(e.options.value)
			const statusMode = String(e.options.delay_status || 'unchanged')
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

			for (const i of inputs) {
				for (const o of outs) {
					// Delay type
					if (typeId !== 'unchanged') {
						self._cmdSendLine(`/processing/matrix/${i}/${o}/delay_type='${typeId}'`)
						self._applyMatrixDelayType?.(i, o, Number(typeId))
					}

					// Delay value (converted from selected unit) only when a unit is chosen
					if (typeId !== 'unchanged') {
						const msFromValue = valueToMs(valueRaw, typeId)
						const targetMs = roundTo01(clamp(msFromValue, 0, 500))
						const samples = Math.round(targetMs * 96)
						self._cmdSendLine(`/processing/matrix/${i}/${o}/delay=${samples}`)
						self._applyMatrixDelay?.(i, o, samples)
					}

					// Bypass
					if (statusMode !== 'unchanged') {
						let newState
						if (statusMode === 'toggle') {
							const key = `${i}-${o}`
							const current = !!self?.matrixDelay?.[key]?.bypass
							newState = !current
						} else {
							newState = statusMode === 'off'
						}
						self._cmdSendLine(`/processing/matrix/${i}/${o}/delay_bypass='${newState}'`)
						self._applyMatrixDelayBypass?.(i, o, newState)
					}
				}
			}
		},
	}
}

module.exports = { registerMatrixActions }
