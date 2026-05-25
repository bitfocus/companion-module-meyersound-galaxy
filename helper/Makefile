UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)

CC      ?= cc
CFLAGS  ?= -O2 -Wall -Wextra -Wpedantic -std=c11

SRC     := src/main.c

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

.PHONY: all clean

all: $(OUT)

$(OUT): $(SRC) Makefile
	@mkdir -p prebuilt
	$(CC) $(CFLAGS) $(SRC) -o $@
	@echo "built -> $@"

clean:
	rm -f prebuilt/galaxy-discovery-helper-*
