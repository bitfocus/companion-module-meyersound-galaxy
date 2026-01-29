# companion-module-meyersound-galaxy

[![Companion Module Checks](https://github.com/bitfocus/companion-module-meyersound-galaxy/actions/workflows/companion-module-checks.yaml/badge.svg)](https://github.com/bitfocus/companion-module-meyersound-galaxy/actions/workflows/companion-module-checks.yaml)

Unofficial Bitfocus Companion module for Meyer Sound Galaxy processors.

Control your Meyer Sound Galaxy processors directly from Bitfocus Companion with real-time control, variables, and feedback for inputs, outputs, matrices, snapshots, hardware status, and more.

## Compatibility

- **Tested:** Galaxy 816, Galaxy Virtual
- **Should work:** Galaxy 408, Galaxy 816 AES
- **Partial support:** Bluehorn (some differences may require testing)
- **Not compatible:** Galileo, Callisto

## Setup

1. In Companion, add the **Meyer Sound Galaxy** module
2. Configure:
   - **IP Address** of the Galaxy processor
   - **Port** (default: 25003)
3. The module will automatically subscribe to all inputs, outputs, matrices, clocks, and status channels
4. Variables, feedbacks, and presets are instantly available

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
Four deployment modes for subwoofer configurations:
- **End-Fire**: Calculate and apply delay taps based on target frequency and air temperature. Supports 2-8 taps with recommended spacing preview.
- **Array**: Configure arc/curved arrays with delay timing based on sub spacing, arc angle, and temperature. Automatic symmetric delay calculation.
- **Array End-Fire**: Combines end-fire rows with arc configuration for multi-row deployments.
- **Gradient**: Apply gradient subwoofer presets with front and reversed polarity outputs.

All modes support loudspeaker selection for product integration, starting points, output link group assignment, and optional factory reset before applying settings.

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

Example variables for button labels:

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

## Requirements

- Bitfocus Companion v3.0 or newer (v4+ recommended)
- Meyer Sound Galaxy processor with firmware 2.9.1 or newer

## Notes

This is a community-driven, unofficial module. Use at your own risk.

Feature requests and bug reports are welcome via [GitHub Issues](https://github.com/bitfocus/companion-module-meyersound-galaxy/issues).

## Acknowledgments

Thanks to José Gaudin and David Vincent for their ideas and contributions.
