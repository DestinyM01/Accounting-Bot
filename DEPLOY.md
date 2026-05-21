# Proxmox LXC Deployment Guide

## 1. Create the LXC container in Proxmox

1. In Proxmox UI → Create CT
   - Template: Ubuntu 22.04
   - Disk: 8 GB
   - RAM: 1024 MB (512 MB minimum)
   - CPU: 1 core
   - Network: DHCP or static IP
   - Uncheck "Unprivileged container" (Docker needs nesting)
2. After creation, open the container shell and enable nesting:
   ```
   # In Proxmox host shell:
   pct set <CTID> -features nesting=1
   ```

## 2. Install Docker inside the LXC

```bash
apt-get update && apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

## 3. Copy project files to the LXC

From your local machine (Windows PowerShell):
```powershell
# Use scp or rsync to copy the project
scp -r "C:\Users\ManMC\OneDrive\Documentos\Code-Projects\ClaudeCode_sessions\Acc_bot" root@<LXC_IP>:/opt/accbot
```

Or use the Proxmox web shell to clone directly:
```bash
apt-get install -y git
cd /opt
git clone <your-repo-url> accbot
```

## 4. Create the .env file

```bash
cd /opt/accbot
cp .env.example .env
nano .env
```

Fill in:
```
TELEGRAM_TOKEN=<your bot token from @BotFather>
ANTHROPIC_API_KEY=<your Anthropic API key>
MONGO_URI=mongodb://mongo:27017/accbot
CRON_SCHEDULE=47 15 * * *
CRON_TIMEZONE=America/Santo_Domingo
```

## 5. Build and start

```bash
cd /opt/accbot
docker compose up -d --build
```

This starts two containers:
- `mongo` — MongoDB 7, data persisted in `mongo_data` volume
- `app` — NestJS bot, built from `./repo/Dockerfile`

## 6. Check logs

```bash
docker compose logs -f app
```

Expected output (healthy start):
```
[NestFactory] Starting Nest application...
[AppModule] Mongoose connected
[TelegrafModule] Bot started
```

## 7. Updating the bot

```bash
cd /opt/accbot
git pull           # if using git
docker compose up -d --build app
```

## 8. Auto-restart on reboot

Docker with `restart: unless-stopped` already handles this. To ensure Docker itself starts on boot:
```bash
systemctl enable docker
```

## Troubleshooting

- **Canvas build fails**: The Dockerfile installs all required native libraries (cairo, pango, jpeg). If it fails, check: `docker compose logs app`
- **Bot not responding**: Verify `TELEGRAM_TOKEN` in `.env` and that the LXC has outbound internet access
- **MongoDB connection refused**: Check that the `mongo` container is running: `docker compose ps`
