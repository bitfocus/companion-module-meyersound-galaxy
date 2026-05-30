UNAME_S := $(shell uname -s 2>/dev/null)
UNAME_M := $(shell uname -m 2>/dev/null)

CC      ?= cc
CFLAGS  ?= -O2 -Wall -Wextra -Wpedantic -std=c11

SRC     := src/main.c

# ---- native platform detection ----------------------------------------

ifeq ($(UNAME_S),Darwin)
  ifeq ($(UNAME_M),arm64)
    PLATFORM := darwin-arm64
  else
    PLATFORM := darwin-x64
  endif
endif
ifeq ($(UNAME_S),Linux)
  ifeq ($(UNAME_M),x86_64)
    PLATFORM := linux-x64
  else ifeq ($(UNAME_M),aarch64)
    PLATFORM := linux-arm64
  else
    PLATFORM := linux-$(UNAME_M)
  endif
endif

PLATFORM ?= unknown
OUT      := prebuilt/galaxy-discovery-helper-$(PLATFORM)

# ---- Linux arm64 cross-compile (run from an x64 host) -----------------
# Requires gcc-aarch64-linux-gnu installed on the build host.
CROSS_CC_ARM64 ?= aarch64-linux-gnu-gcc
CROSS_OUT_ARM64 := prebuilt/galaxy-discovery-helper-linux-arm64

# ---- Windows x64 cross-compile (mingw-w64) ---------------------------
# Requires:
#   - x86_64-w64-mingw32-gcc (brew install mingw-w64 / apt-get install mingw-w64)
#   - NPCAP_SDK env pointing at an unpacked Npcap SDK directory
# Runtime needs Npcap installed on the target Windows host.
MINGW_CC   ?= x86_64-w64-mingw32-gcc
NPCAP_SDK  ?=
WIN_OUT    := prebuilt/galaxy-discovery-helper-win-x64.exe
WIN_CFLAGS := -O2 -Wall -std=c11 -D_WIN32_WINNT=0x0601

.PHONY: all clean distclean native linux-arm64 win-x64

all: native

native: $(OUT)

$(OUT): $(SRC) Makefile
	@mkdir -p prebuilt
	$(CC) $(CFLAGS) $(SRC) -o $@
	@echo "built -> $@"

# Linux arm64 cross-compile target.
linux-arm64: $(CROSS_OUT_ARM64)

$(CROSS_OUT_ARM64): $(SRC) Makefile
	@mkdir -p prebuilt
	$(CROSS_CC_ARM64) $(CFLAGS) $(SRC) -o $@
	@echo "built -> $@"

# Windows x64 cross-compile via mingw. NPCAP_SDK must be set.
win-x64: $(WIN_OUT)

$(WIN_OUT): $(SRC) Makefile
	@if [ -z "$(NPCAP_SDK)" ]; then \
		echo "NPCAP_SDK must be set (path to unpacked Npcap SDK)"; exit 1; \
	fi
	@mkdir -p prebuilt
	$(MINGW_CC) $(WIN_CFLAGS) -I"$(NPCAP_SDK)/Include" $(SRC) \
		"$(NPCAP_SDK)/Lib/x64/wpcap.lib" "$(NPCAP_SDK)/Lib/x64/Packet.lib" \
		-lws2_32 -liphlpapi -o $@
	@echo "built -> $@"

# Only the current platform's native output. Other-platform binaries
# in prebuilt/ come from the GitHub Actions workflow's commit — a casual
# `make clean` from a dev machine should not delete them. Use distclean
# when you really want to nuke every prebuilt.
clean:
	rm -f $(OUT)

distclean:
	rm -f prebuilt/galaxy-discovery-helper-*
