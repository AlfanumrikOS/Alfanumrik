#!/bin/bash

set -e

info() {
  echo ""
  echo "[INFO] $1"
}

success() {
  echo "[SUCCESS] $1"
}

error() {
  echo "[ERROR] $1"
  exit 1
}

# Check required tools
command -v gh >/dev/null 2>&1 || error "GitHub CLI (gh) is not installed."
command -v git >/dev/null 2>&1 || error "Git is not installed."

# Check required environment variables
[ -z "$GITHUB_TOKEN" ] && error "GITHUB_TOKEN is not set."
[ -z "$VERCEL_TOKEN" ] && error "VERCEL_TOKEN is not set."
[ -z "$ANTHROPIC_API_KEY" ] && error "ANTHROPIC_API_KEY is not set."

# Authenticate with GitHub
info "Authenticating with GitHub..."
echo "$GITHUB_TOKEN" | gh auth login --with-token
success "GitHub authenticated as $(gh api user --jq .login)"

# Show environment status without exposing secrets
info "Environment variables detected:"
echo "GITHUB_TOKEN: set"
echo "VERCEL_TOKEN: set"
echo "ANTHROPIC_API_KEY: set"

success "DEPLOY.sh is configured correctly."