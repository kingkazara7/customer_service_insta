# Instalily PartSelect Agent — AWS Deployment Info

> Region: us-east-2 | Account: 554487657884 | Created: 2026-06-11

## EC2
- Instance ID: `i-01c8fe9496075c166`
- Name tag: `instalily_project`
- Type: t3.small (2 vCPU / 2 GB), Ubuntu 24.04, 30 GB gp3
- Elastic IP (static): `18.227.30.139` ← demo address http://18.227.30.139/
- SSH: `ssh -i instalily-key.pem ubuntu@18.227.30.139` (key in this folder; access restricted to 76.36.238.226)
- App: /home/ubuntu/app/partselect-agent, systemd service `partselect` (starts on boot)
- Env file: /etc/partselect.env (root:ubuntu 640); nginx reverse-proxies 80→3000 (SSE buffering off)
- Common commands: `sudo systemctl restart partselect` / `journalctl -u partselect -f`

## Security groups
- `instalily-web-sg` = sg-0ee11c942d565ab00 (80/443 public, 22 limited to home IP)
- `instalily-db-sg` = sg-08e90a1dbf05d77b8 (5432 allowed only from web-sg)

## RDS (production database, live ✅)
- Identifier: `instalily-db`, PostgreSQL 18.3, db.t4g.micro, 20 GB gp3
- Database: `partselect`, user: `psadmin`
- Password: see `.deploy-secrets` in this folder (gitignored — do not commit)
- Not publicly accessible; reachable only from EC2 (security group allows 5432 from web-sg)
- Endpoint: `instalily-db.cnak2yye03in.us-east-2.rds.amazonaws.com:5432`
- App connects via `DB_DRIVER=pg` + PG* env vars (already in `/etc/partselect.env`)
- Data loaded: 18 models / 664 parts / 938 compatibility pairs / 13 guides / 16 vector chunks
- Reload data (against RDS), on EC2: `set -a; . /etc/partselect.env; set +a; npm run db:seed && npm run ingest && npm run embed` (⚠️ db:seed wipes all tables)

## Bedrock (us-east-2)
- Chat models: anthropic.claude-* family (use case form submitted; sonnet-4-5 inference profile in use)
- Embeddings: `amazon.titan-embed-text-v2:0` (1024-dim)

## Network
- VPC: vpc-04f8d9b58c18c2c6c (default)
- Subnet: subnet-0efceaeb404466c32 (us-east-2c)
- AMI: ami-0ea1cddefe0c4aed5 (ubuntu-noble-24.04, 20260610)

## Status
- [x] Elastic IP associated
- [x] RDS endpoint recorded; database migrated and live
- [x] Bedrock invoke access verified (Anthropic use case form submitted)
- [x] Domain + TLS: customerservice.lambdapen.com via Cloudflare DNS + Let's Encrypt (certbot)
