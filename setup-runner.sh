#!/bin/bash
# Run this ONCE inside your Proxmox LXC to install the GitHub Actions self-hosted runner.
# Usage: bash setup-runner.sh <GITHUB_REPO_URL> <RUNNER_TOKEN>
#
# Get the RUNNER_TOKEN from:
#   GitHub repo → Settings → Actions → Runners → New self-hosted runner → Linux
#   Copy the token shown in the "Configure" step (starts with A...)
#
# Example:
#   bash setup-runner.sh https://github.com/youruser/yourrepo AXXXXXXXXXXXXXXXX

set -euo pipefail

REPO_URL="${1:?Usage: $0 <github-repo-url> <runner-token>}"
RUNNER_TOKEN="${2:?Usage: $0 <github-repo-url> <runner-token>}"
RUNNER_VERSION="2.317.0"
INSTALL_DIR="/opt/actions-runner"

echo "==> Installing dependencies..."
apt-get install -y curl jq libicu-dev

echo "==> Creating runner directory at $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo "==> Downloading GitHub Actions runner v${RUNNER_VERSION}..."
curl -fsSL -o actions-runner.tar.gz \
  "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
tar xzf actions-runner.tar.gz
rm actions-runner.tar.gz

echo "==> Configuring runner (repo: $REPO_URL)..."
./config.sh \
  --url "$REPO_URL" \
  --token "$RUNNER_TOKEN" \
  --name "proxmox-lxc" \
  --labels "self-hosted,linux,proxmox" \
  --work "/opt/accbot" \
  --unattended

echo "==> Installing runner as a systemd service..."
./svc.sh install root
./svc.sh start

echo ""
echo "==> Done! Runner is running as a systemd service."
echo "    Check status: systemctl status actions.runner.*.service"
echo "    View logs:    journalctl -u 'actions.runner.*' -f"
