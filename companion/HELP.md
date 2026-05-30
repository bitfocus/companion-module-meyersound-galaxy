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
- **End-Fire** — Calculate and apply delay taps based on target frequency and air temperature. Supports 2–8 taps with recommended spacing preview.
- **Array** — Configure arc/curved arrays with delay timing based on sub spacing, arc angle, and temperature. Automatic symmetric delay calculation.
- **Array End-Fire** — Combines end-fire rows with arc configuration for multi-row deployments.
- **Gradient** — Apply gradient subwoofer presets with front and reversed polarity outputs.
- **End-Fire Gradient** — Combines gradient and end-fire. Pick a loudspeaker, its phase curve (PC63 / PC100 / PC125, as available), the number of end-fire taps, and the first front-facing and first rear-facing output; the remaining outputs are filled in automatically. Adjacent first outputs (e.g. front 1, rear 2) interleave the pairs (1,3,5… front / 2,4,6… rear); a larger gap lays them out as consecutive blocks (e.g. front 1, rear 5 with 4 taps → 1–4 front / 5–8 rear). The correct front/rear starting point is chosen automatically per loudspeaker. Each tap's end-fire delay (from target frequency and air temperature) is added on top of the cabinet gradient delay carried by the rear-facing outputs; front-facing outputs receive the end-fire delay only. Loudspeakers without a factory rear-facing preset accept a manual rear delay, with polarity reversed automatically. An optional channel-name prefix names each output "&lt;prefix&gt; T# Front" / "&lt;prefix&gt; T# Rear".

All modes support loudspeaker selection for product integration, starting points, output link group assignment, and optional factory reset before applying settings. Each mode also accepts an optional channel-name prefix (e.g. "Sub") that names the configured outputs with a role/position suffix, and selecting an Output Link Group automatically enables it (choose "None" to leave link groups untouched).

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
