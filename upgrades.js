module.exports = [
	/*
	 * Place your upgrade scripts here
	 * Remember that once it has been added it cannot be removed!
	 */

	// V1: Rename action IDs and parameters for consistency
	function (_context, props) {
		const updatedActions = []
		const updatedFeedbacks = []

		// Action ID renames (remove _multi suffixes and standardize prefixes)
		const actionRenames = {
			'inputs_mute_control_multi': 'input_mute_control',
			'inputs_mute_control': 'input_mute_control',
			'inputs_solo': 'input_solo',
			'outputs_mute_control_multi': 'output_mute_control',
			'outputs_mute_control': 'output_mute_control',
			'outputs_solo': 'output_solo',
			'matrix_gain_set_multi': 'matrix_gain_set',
			'matrix_gain_nudge_multi': 'matrix_gain_nudge',
			'matrix_delay_set_multi': 'matrix_delay_set',
			'system_input_mode_set_multi': 'system_input_mode_set',
			'system_chase_start': 'output_chase_start',
			'system_chase_stop': 'output_chase_stop',
		}

		// Parameter renames for actions
		const actionParamRenames = {
			// Matrix actions: mi/mo → matrix_inputs/matrix_outputs
			'matrix_gain_set': { 'mi': 'matrix_inputs', 'mo': 'matrix_outputs' },
			'matrix_gain_nudge': { 'mi': 'matrix_inputs', 'mo': 'matrix_outputs' },
			'matrix_delay_set': { 'mi': 'matrix_inputs', 'mo': 'matrix_outputs' },
			// Link group actions: channels → chs
			'input_link_group_assign': { 'channels': 'chs' },
			'output_link_group_assign': { 'channels': 'chs' },
			// EQ actions: freq_value/freq_delta → frequency_value/frequency_delta
			'input_eq_knob_frequency': { 'freq_value': 'frequency_value' },
			'input_eq_nudge_frequency': { 'freq_delta': 'frequency_delta' },
		}

		// Feedback ID renames
		const feedbackRenames = {
			'speakerTestFlash': 'speaker_test_flash',
		}

		// Parameter renames for feedbacks
		const feedbackParamRenames = {
			// Matrix feedbacks: mi/mo → matrix_input/matrix_output
			'matrix_gain_level': { 'mi': 'matrix_input', 'mo': 'matrix_output' },
			'matrix_delay_bypassed': { 'mi': 'matrix_input', 'mo': 'matrix_output' },
			'matrix_gain_color': { 'mi': 'matrix_input', 'mo': 'matrix_output' },
		}

		// Upgrade actions
		for (const action of props.actions) {
			let changed = false
			const newAction = { ...action }

			// Rename action ID if needed
			if (actionRenames[action.actionId]) {
				newAction.actionId = actionRenames[action.actionId]
				changed = true
			}

			// Rename action parameters if needed
			const currentActionId = newAction.actionId
			if (actionParamRenames[currentActionId]) {
				const renames = actionParamRenames[currentActionId]
				for (const [oldParam, newParam] of Object.entries(renames)) {
					if (newAction.options && oldParam in newAction.options) {
						newAction.options[newParam] = newAction.options[oldParam]
						delete newAction.options[oldParam]
						changed = true
					}
				}
			}

			if (changed) {
				updatedActions.push(newAction)
			}
		}

		// Upgrade feedbacks
		for (const feedback of props.feedbacks) {
			let changed = false
			const newFeedback = { ...feedback }

			// Rename feedback ID if needed
			if (feedbackRenames[feedback.feedbackId]) {
				newFeedback.feedbackId = feedbackRenames[feedback.feedbackId]
				changed = true
			}

			// Rename feedback parameters if needed
			const currentFeedbackId = newFeedback.feedbackId
			if (feedbackParamRenames[currentFeedbackId]) {
				const renames = feedbackParamRenames[currentFeedbackId]
				for (const [oldParam, newParam] of Object.entries(renames)) {
					if (newFeedback.options && oldParam in newFeedback.options) {
						newFeedback.options[newParam] = newFeedback.options[oldParam]
						delete newFeedback.options[oldParam]
						changed = true
					}
				}
			}

			if (changed) {
				updatedFeedbacks.push(newFeedback)
			}
		}

		return {
			updatedConfig: null,
			updatedActions,
			updatedFeedbacks,
		}
	},
	// V2: Drop Bonjour discovery and migrate to manual host/port
	function (_context, props) {
		let updatedConfig = null
		const updatedActions = []
		const updatedFeedbacks = []

		const bonjourHost = props.config?.bonjour_host
		if (bonjourHost) {
			const trimmed = String(bonjourHost).trim()
			let parsedHost = null
			let parsedPort = null

			if (trimmed.startsWith('[')) {
				const match = trimmed.match(/^\[([^\]]+)\]:(\d+)$/)
				if (match) {
					parsedHost = match[1]
					parsedPort = Number(match[2])
				} else if (trimmed.endsWith(']')) {
					parsedHost = trimmed.slice(1, -1)
				}
			} else {
				const lastColonIndex = trimmed.lastIndexOf(':')
				if (lastColonIndex !== -1) {
					parsedHost = trimmed.substring(0, lastColonIndex).trim()
					const parsed = Number(trimmed.substring(lastColonIndex + 1))
					if (Number.isFinite(parsed)) {
						parsedPort = parsed
					}
				} else if (trimmed) {
					parsedHost = trimmed
				}
			}

			const manualHost = props.config?.host
			const manualPort = Number(props.config?.port)
			const hasManualHost = typeof manualHost === 'string' && manualHost.trim() !== ''
			const hasManualPort = Number.isFinite(manualPort) && manualPort >= 1 && manualPort <= 65535
			const host = hasManualHost ? manualHost : parsedHost
			const port = hasManualPort
				? manualPort
				: Number.isFinite(parsedPort) && parsedPort >= 1 && parsedPort <= 65535
					? parsedPort
					: 25003

			if (host) {
				updatedConfig = {
					...props.config,
					host,
					port,
				}
			} else {
				updatedConfig = { ...props.config }
			}

			delete updatedConfig.bonjour_host
		} else if (props.config && 'bonjour_host' in props.config) {
			updatedConfig = { ...props.config }
			delete updatedConfig.bonjour_host
		}

		return {
			updatedConfig,
			updatedActions,
			updatedFeedbacks,
		}
	},
	// V3: Add connection type + virtual host/ID settings
	function (_context, props) {
		const cfg = props.config || {}
		const nextCfg = { ...cfg }
		let changed = false

		const DEFAULT_VIRTUAL_HOST = '127.0.0.1'
		const VIRTUAL_BASE_PORT = 50503
		const VIRTUAL_PORT_STEP = 100
		const VIRTUAL_MIN_ID = 1
		const VIRTUAL_MAX_ID = 20

		if (!nextCfg.connection_type) {
			nextCfg.connection_type = 'physical'
			changed = true
		}

		const hostRaw = typeof cfg.host === 'string' ? cfg.host.trim() : ''
		const hostLower = hostRaw.toLowerCase()
		const port = Number(cfg.port)
		const isVirtualHost = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostLower)

		let virtualIdFromPort = null
		if (Number.isFinite(port)) {
			const offset = (VIRTUAL_BASE_PORT - port) / VIRTUAL_PORT_STEP
			if (offset >= 0 && offset <= VIRTUAL_MAX_ID - VIRTUAL_MIN_ID && Number.isInteger(offset)) {
				virtualIdFromPort = VIRTUAL_MIN_ID + offset
			}
		}

		if (isVirtualHost || virtualIdFromPort !== null) {
			nextCfg.connection_type = 'virtual'
			changed = true
			if (!nextCfg.virtual_host || typeof nextCfg.virtual_host !== 'string' || nextCfg.virtual_host.trim() === '') {
				nextCfg.virtual_host = hostRaw || DEFAULT_VIRTUAL_HOST
			}
			if (!nextCfg.virtual_id) {
				const id = virtualIdFromPort ?? VIRTUAL_MIN_ID
				nextCfg.virtual_id = Math.min(Math.max(id, VIRTUAL_MIN_ID), VIRTUAL_MAX_ID)
			}
		}

		if (nextCfg.connection_type === 'virtual') {
			if (!nextCfg.virtual_host || typeof nextCfg.virtual_host !== 'string' || nextCfg.virtual_host.trim() === '') {
				nextCfg.virtual_host = DEFAULT_VIRTUAL_HOST
				changed = true
			}
			const rawId = Number(nextCfg.virtual_id)
			const clampedId = Math.min(
				Math.max(Number.isFinite(rawId) ? rawId : VIRTUAL_MIN_ID, VIRTUAL_MIN_ID),
				VIRTUAL_MAX_ID,
			)
			if (clampedId !== nextCfg.virtual_id) {
				nextCfg.virtual_id = clampedId
				changed = true
			}
		}

		if (!Number.isFinite(Number(nextCfg.port))) {
			nextCfg.port = 25003
			changed = true
		}

		if (!changed) {
			return {
				updatedConfig: null,
				updatedActions: [],
				updatedFeedbacks: [],
			}
		}

		return {
			updatedConfig: nextCfg,
			updatedActions: [],
			updatedFeedbacks: [],
		}
	},
]
