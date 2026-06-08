# Meyer Sound Galaxy — Module Help

Unofficial Bitfocus Companion module for Meyer Sound Galaxy processors.

Control your Meyer Sound Galaxy processors with real-time control, variables, and feedback for inputs, outputs, matrices, snapshots, hardware status, and more.

## Compatibility

| Device | Status |
|--------|--------|
| Galaxy 816, Galaxy Virtual | Tested |
| Galaxy 408, Galaxy 816 AES | Should work |
| Bluehorn | Partial support (some differences may require testing) |
| Galileo, Callisto | Not compatible |

**Firmware:** Galaxy firmware 2.9.1 or newer required.

## Setup

1. In Companion, add the **Meyer Sound Galaxy** module.
2. Configure the connection settings:
   - **IP Address** — the IP address of your Galaxy processor
   - **Port** — default is `25003`
3. The module will automatically subscribe to all inputs, outputs, matrices, clocks, and status channels.
4. Variables, feedbacks, and presets are instantly available.

## Features

### Speaker Test
Cycles through outputs automatically for quick speaker line testing. Supports solo or paired (A+B) modes with adjustable timing. Outputs are muted/unmuted automatically during the sequence.

### Line Array Design
Configure multiple outputs for line array deployments with a single action:
- Select loudspeaker model (LEO-M, LYON, LEOPARD, MICA, PANTHER, MINA, LINA, etc.)
- Set number of elements and elements per output
- Phase curve selection per loudspeaker type
- Mixed array support with automatic delay compensation
- Optional starting point presets
- Output link group assignment with automatic enable
- Channel naming with custom prefix
- LMBC (Low-Mid Beam Control) configuration with beam angle, control type, and array assignment

### Subwoofer Design Assist
Five deployment modes for subwoofer configurations:
- **End-Fire** — Calculate and apply progressive delay taps based on target frequency and air temperature (2–8 taps, with recommended spacing preview). Pick a loudspeaker and its phase curve (PC63/PC100/PC125, as available); the Front Facing starting point is applied automatically. Choose the first output and the remaining taps auto-fill one output per tap (T0 = first, T1 = first+1, …). Loudspeakers without a front-facing preset accept a manual base delay added on top of every tap.
- **Array** — Configure arc/curved arrays with delay timing based on sub spacing, arc angle, and temperature. Automatic symmetric delay calculation.
- **Array End-Fire** — Combines end-fire rows with arc configuration for multi-row deployments.
- **Array Gradient** — A symmetric arc of front-facing subs (like Array) plus one rear-facing sub per front sub for a cardioid arc. Pick the front and rear starting outputs; each rear sub gets its front partner's arc delay plus the cabinet gradient delay with polarity reversed (front/rear presets and phase curve are chosen automatically; loudspeakers without a rear preset accept a manual rear delay). Supports the same Mono/Stereo and flip-layout options as Array.
- **Gradient** — Apply gradient subwoofer presets with front and reversed polarity outputs.
- **End-Fire Gradient** — Combines gradient and end-fire. Pick a loudspeaker, its phase curve (PC63 / PC100 / PC125, as available), the number of end-fire taps, and the first front-facing and first rear-facing output; the remaining outputs are filled in automatically. Adjacent first outputs (e.g. front 1, rear 2) interleave the pairs (1,3,5… front / 2,4,6… rear); a larger gap lays them out as consecutive blocks (e.g. front 1, rear 5 with 4 taps → 1–4 front / 5–8 rear). The correct front/rear starting point is chosen automatically per loudspeaker. Each tap's end-fire delay (from target frequency and air temperature) is added on top of the cabinet gradient delay carried by the rear-facing outputs; front-facing outputs receive the end-fire delay only. Loudspeakers without a factory rear-facing preset accept a manual rear delay, with polarity reversed automatically. An optional channel-name prefix names each output "&lt;prefix&gt; T# Front" / "&lt;prefix&gt; T# Rear".

All modes support loudspeaker selection for product integration, starting points, output link group assignment, and optional factory reset before applying settings. Each mode also accepts an optional channel-name prefix (e.g. "Sub") that names the configured outputs with a role/position suffix, and selecting an Output Link Group automatically enables it (choose "None" to leave link groups untouched). A **Status** line shows standby, the applied summary, or — for an impossible layout — the reason and how to fix it (nothing is applied in that case).

### Speed of Sound / Spacing Calculator
A standalone action with **no effect on the Galaxy**. Enter air temperature and a target frequency, press the button, and it reports the speed of sound and the recommended ¼-wavelength sub spacing (m and ft) in its Result line.

### Inputs
- Mute, unmute, toggle
- Set, nudge, or fade gain (dB)
- Parametric EQ control with fine/coarse modes
- Link group assignment and bypass
- Variables for name, mute state, and gain
- Feedback for mute status and gain levels

### Outputs
- Mute, unmute, toggle
- Set, nudge, or fade gain (dB)
- Parametric EQ control with fine/coarse modes
- Link group assignment and bypass
- Line array design tools
- Factory reset per channel
- Variables for name, mute state, and gain
- Feedback for mute status and gain levels

### Matrix
- Select multiple inputs and outputs simultaneously
- Set, nudge, or fade crosspoint gains
- Variables and feedback for all crosspoints

### Snapshots
- Recall snapshots (0–255)
- Variables for active snapshot (ID, name, timestamps)
- Feedback for snapshot state

### Presets
- Auto-generated mute buttons for inputs and outputs
- Labels display channel number, name, and gain
- Feedback coloring (red when muted)

### Linking Galaxies (Link ID)
Give two or more connections on the same Companion server the same non-empty **Link ID** (in the connection config) to operate them as one. Any control change you make through a Companion action on one linked Galaxy is automatically replayed on the others — e.g. muting "Galaxy Left" also mutes "Galaxy Right". Leave the Link ID blank to disable linking. Per-unit/identity actions (Identify, Access Lock, Front Panel Lockout, Reboot, Group Name, Clear Log) are intentionally not mirrored. Linking covers connections on the same machine; changes made directly on a device's front panel are not mirrored.

Use the **Linking: Enable / Disable** action to temporarily suspend mirroring for one connection — handy when you need to adjust a single Galaxy without affecting its linked peers. The `link_active` variable and the **Linking: Active** feedback show the current state; it resets to enabled on restart or when the Link ID changes.

### Front Panel Lockout
- Lock/unlock Galaxy hardware front panel
- Feedback shows live state

### Status & System Info
- Device info (model, firmware, serial, group name)
- Clock & sync (AES, word clock, system clock)
- Network status (IP, MAC, speed)
- RTC date & time

## Variables

| Variable | Description |
|----------|-------------|
| `$(Galaxy:input_1_name)` | Input 1 name |
| `$(Galaxy:input_1_gain_db)` | Input 1 gain in dB |
| `$(Galaxy:input_1_mute)` | Input 1 mute state (true/false) |
| `$(Galaxy:output_3_name)` | Output 3 name |
| `$(Galaxy:snapshot_active_id)` | Currently active snapshot ID |

## Feedbacks

- Input/output mute status (visual indicator when muted)
- Gain threshold comparisons (equal, above, below target dB)
- Matrix crosspoint gain monitoring
- Front panel lock state

## Notes

This is a community-driven, unofficial module. Use at your own risk.

Feature requests and bug reports are welcome via [GitHub Issues](https://github.com/bitfocus/companion-module-meyersound-galaxy/issues).
