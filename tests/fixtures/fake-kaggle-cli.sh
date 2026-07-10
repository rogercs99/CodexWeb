#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "kernels" && "${2:-}" == "push" ]]; then
  echo "Kernel version 1 successfully pushed"
  exit 0
fi
if [[ "${1:-}" == "kernels" && "${2:-}" == "status" ]]; then
  echo "${3:-audit/mock} has status \"KernelWorkerStatus.RUNNING\""
  exit 0
fi
if [[ "${1:-}" == "kernels" && "${2:-}" == "output" ]]; then
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "-p" && $# -gt 1 ]]; then
      mkdir -p "$2"
      printf 'fake kaggle output\n' > "$2/output.txt"
      shift 2
      continue
    fi
    shift
  done
  echo "Output downloaded"
  exit 0
fi
echo "fake kaggle cli: unsupported arguments: $*" >&2
exit 2
