#!/usr/bin/env bash
set -u

# フェーズ0のWASM検証を再現可能に始めるための、非破壊な環境診断。
# ツールのインストールやリポジトリのcloneは行わない。

missing=0

check_required() {
  label="$1"
  command_name="$2"
  if command -v "$command_name" >/dev/null 2>&1; then
    version="$($command_name --version 2>/dev/null | sed -n '1p')"
    printf 'PASS  %-12s %s\n' "$label" "${version:-$command_name}"
  else
    printf 'MISS  %-12s command=%s\n' "$label" "$command_name"
    missing=$((missing + 1))
  fi
}

check_optional() {
  label="$1"
  command_name="$2"
  if command -v "$command_name" >/dev/null 2>&1; then
    version="$($command_name --version 2>/dev/null | sed -n '1p')"
    printf 'PASS  %-12s %s\n' "$label" "${version:-$command_name}"
  else
    printf 'INFO  %-12s command=%s (optional accelerator)\n' "$label" "$command_name"
  fi
}

check_required 'Node.js' node
check_required 'npm' npm
check_required 'Git' git
check_required 'CMake' cmake
check_required 'Emscripten' emcc
check_required 'emcmake' emcmake
check_optional 'Ninja' ninja

if [ "$missing" -gt 0 ]; then
  printf '\nPhase 0 toolchain is not ready: %s required command(s) missing.\n' "$missing"
  exit 1
fi

printf '\nPhase 0 toolchain is ready for source-level WASM build trials.\n'
