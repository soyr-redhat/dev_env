#!/bin/bash
# Sawyer's devenv — sourced on login

DEVENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------- auto-update ----------
if [ -d "$DEVENV_DIR/.git" ]; then
    (cd "$DEVENV_DIR" && git pull --ff-only --quiet 2>/dev/null)
fi

# ---------- env ----------
export HF_HOME="${HF_HOME:-$HOME/.cache/huggingface}"
export UV_CACHE_DIR="${UV_CACHE_DIR:-$HOME/.cache/uv}"
export EDITOR=vim

# ---------- aliases ----------
alias ll='ls -alF'
alias gs='git status'
alias gd='git diff'
alias gl='git log --oneline -20'

# ---------- uv venv helpers ----------
uva() {
    if [ -z "$1" ]; then
        echo "Usage: uva <venv-name>"
        echo "Available:"
        ls -1 "$HOME/.venvs/" 2>/dev/null || echo "  (none — create with: uv venv ~/.venvs/<name>)"
        return 1
    fi
    source "$HOME/.venvs/$1/bin/activate"
}

# ---------- oc helpers ----------
ocproject() {
    oc project "${1:-machine-learning}"
}

ocgpus() {
    oc get nodes -l nvidia.com/gpu.present=true -o custom-columns=NAME:.metadata.name,STATUS:.status.conditions[-1:].type,GPUs:.status.allocatable.nvidia\\.com/gpu
}

# ---------- logging ----------
dolog() {
    mkdir -p "$HOME/logs"
    local logfile="$HOME/logs/$(date +%Y-%m-%d).log"
    echo "[$(date +%H:%M:%S)] $*" >> "$logfile"
    echo "Logged to $logfile"
}

# ---------- source extras ----------
[ -f "$HOME/.bash_profile.local" ] && source "$HOME/.bash_profile.local"
