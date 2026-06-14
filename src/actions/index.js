// actions/index.js
// Main actions entry point that combines all action categories

const { registerInputActions } = require('./inputs')
const { registerOutputActions } = require('./outputs')
const { registerMatrixActions } = require('./matrix')
const { registerSnapshotActions } = require('./snapshots')
const { registerSystemActions } = require('./system')
const { registerArrayDesignActions } = require('./array-design')
const { registerSubwooferDesignActions } = require('./subwoofer-design')
const { linkEnableOption, linkOptsFrom } = require('../actions-helpers')

// Actions that must never mirror over the Link bus, so they get NO Global Link checkbox:
// per-unit identity/access/hardware, the link control itself, read-only/log ops, and the
// offline calculator. (Several already hard-code { noLink: true } in their sends.)
const LINK_EXCLUDED = new Set([
	'set_group_name',
	'access_lock',
	'access_priv_toggle',
	'front_panel_lockout_control',
	'system_identify',
	'system_clear_log_history',
	'system_reboot',
	'link_set',
	'system_log_history',
	'system_add_log_message',
	'subassist_calculator',
])

/**
 * Register all action definitions
 * @param {Object} self - Module instance
 * @param {number} NUM_INPUTS - Number of input channels
 * @param {number} NUM_OUTPUTS - Number of output channels
 */
module.exports = function UpdateActions(self, NUM_INPUTS, NUM_OUTPUTS) {
	if (!self) {
		console.error('UpdateActions: self is required')
		return
	}
	if (!Number.isFinite(NUM_INPUTS) || NUM_INPUTS < 1) {
		self.log('error', 'UpdateActions: Invalid NUM_INPUTS')
		return
	}
	if (!Number.isFinite(NUM_OUTPUTS) || NUM_OUTPUTS < 1) {
		self.log('error', 'UpdateActions: Invalid NUM_OUTPUTS')
		return
	}

	// Initialize required properties
	self.snapshotValues = self.snapshotValues || {}
	self.inputName = self.inputName || {}
	self.outputName = self.outputName || {}
	self.inMute = self.inMute || {}
	self.outMute = self.outMute || {}

	const actions = {}

	// Register actions from each category
	registerInputActions(actions, self, NUM_INPUTS, NUM_OUTPUTS)
	registerOutputActions(actions, self, NUM_INPUTS, NUM_OUTPUTS)
	registerMatrixActions(actions, self, NUM_INPUTS, NUM_OUTPUTS)
	registerSnapshotActions(actions, self, NUM_INPUTS, NUM_OUTPUTS)
	registerSystemActions(actions, self, NUM_INPUTS, NUM_OUTPUTS)
	registerArrayDesignActions(actions, self, NUM_INPUTS, NUM_OUTPUTS)
	registerSubwooferDesignActions(actions, self, NUM_INPUTS, NUM_OUTPUTS)

	// Global Link: when this connection has a Link ID, prepend a "Global Link (<id>)" checkbox
	// to every linkable action and wrap its callback so self._linkOpts carries that button's
	// link choice for the duration of the run. _cmdSendLine/_cmdSendBatch read _linkOpts, so a
	// single wrapper covers every action's send path without per-action plumbing.
	const linkId = String(self.config?.link_id || '').trim()
	if (linkId) {
		for (const [id, action] of Object.entries(actions)) {
			if (!action || LINK_EXCLUDED.has(id) || typeof action.callback !== 'function') continue
			action.options = [linkEnableOption(linkId), ...(action.options || [])]
			const orig = action.callback
			action.callback = async (event, ...rest) => {
				const prev = self._linkOpts
				self._linkOpts = linkOptsFrom(event.options)
				try {
					return await orig(event, ...rest)
				} finally {
					self._linkOpts = prev
				}
			}
		}
	}

	// Register all actions with Companion
	self.setActionDefinitions(actions)
}
