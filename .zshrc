#!/bin/zsh
# Sawyer's zsh config — portable version for devenv

# ---------- oh-my-zsh ----------
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="robbyrussell"
plugins=(git)
[ -f "$ZSH/oh-my-zsh.sh" ] && source "$ZSH/oh-my-zsh.sh"

# ---------- PATH ----------
export PATH="$HOME/.local/bin:$PATH"
export PATH="/usr/local/go/bin:$PATH"

# ---------- aliases ----------
alias nv="nvim"
alias py3="python3"
alias gs="git status"
alias ga="git add ."
alias gcm="git commit -m"
alias gp="git push"
alias ll="ls -alF"
alias go="/usr/local/go/bin/go"

# ---------- Claude Code (Google Vertex AI) ----------
if [ -f "$HOME/Downloads/google-cloud-sdk/path.zsh.inc" ]; then
    source "$HOME/Downloads/google-cloud-sdk/path.zsh.inc"
fi
if [ -f "$HOME/Downloads/google-cloud-sdk/completion.zsh.inc" ]; then
    source "$HOME/Downloads/google-cloud-sdk/completion.zsh.inc"
fi
export CLAUDE_CODE_USE_VERTEX=1
export CLOUD_ML_REGION=us-east5
export ANTHROPIC_VERTEX_PROJECT_ID=itpc-gcp-product-all-claude

# ---------- bun ----------
[ -s "$HOME/.bun/_bun" ] && source "$HOME/.bun/_bun"
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# ---------- source devenv helpers ----------
DEVENV_DIR="$(cd "$(dirname "${(%):-%x}")" 2>/dev/null && pwd)"
[ -f "$DEVENV_DIR/.bash_profile" ] && source "$DEVENV_DIR/.bash_profile"

# ---------- local overrides ----------
[ -f "$HOME/.zshrc.local" ] && source "$HOME/.zshrc.local"
