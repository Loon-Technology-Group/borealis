# CLAUDE.md — Step 6: Terraform Infrastructure

This file provides guidance for writing the Terraform configuration that provisions
all infrastructure for Borealis: S3 remote state backend, EC2 instance, security group,
Elastic IP, SSH key pair, IAM role for SSM, Tailscale bootstrap, and Cloudflare DNS.

---

## What Each Part Does — Learning Reference

Before implementing, understand what each resource does and why it exists:

### S3 Backend (`infra/bootstrap/`)
Terraform needs to store a state file tracking what infrastructure it has created.
By default this lives locally on disk (`terraform.tfstate`). The S3 backend stores it
in an S3 bucket instead — durable, not on your laptop, never committed to git.
A DynamoDB table provides state locking: if two `terraform apply` runs happen
simultaneously, the lock prevents them from corrupting the state file. The bootstrap
configuration is a separate mini-Terraform root that creates the bucket and table —
it runs once, manually, before the main configuration is initialized.

### EC2 Instance (`aws_instance`)
The virtual machine that runs your Docker Compose stack. You're using a `t4g.small`
— a Graviton3 arm64 instance. Graviton instances are cheaper than x86 equivalents
and arm64 matches your Docker images (built for `linux/arm64` in the release workflow).
The instance is configured via a `user_data` bootstrap script that runs once on first
boot: installs Docker, installs Tailscale, joins your tailnet, and pulls your prod
compose file.

### Security Group (`aws_security_group`)
AWS's virtual firewall for the instance. Controls what inbound and outbound traffic
is allowed. For Borealis:
- **Inbound 443** from Cloudflare IP ranges only — the public-facing HTTPS port.
  No other inbound rules. Tailscale uses outbound connections so needs no inbound rule.
- **All outbound** allowed — the instance needs to reach Docker Hub, NOAA APIs,
  Cloudflare, and the Tailscale coordination server.
Locking inbound 443 to Cloudflare IPs means direct access to your origin is blocked
— all traffic must flow through Cloudflare's proxy.

### Elastic IP (`aws_eip`)
A static public IP address that stays the same even if the instance is stopped and
restarted. Without this, EC2 assigns a random public IP on each start, which would
break your Cloudflare DNS record. The EIP is associated with the instance and is what
the Cloudflare DNS A record points to.

### SSH Key Pair (`aws_key_pair` + `tls_private_key`)
An RSA key pair for SSH access. Terraform generates the private key, stores it locally
as a `.pem` file, and registers the public key with EC2. You won't use this directly
for day-to-day access (Tailscale SSH handles that), but it's good practice to have
it provisioned and it's needed if Tailscale ever fails.

### IAM Instance Profile (`aws_iam_instance_profile`)
An IAM role attached to the EC2 instance that grants it AWS permissions. Even though
you're not using SSM Session Manager for access, attaching the
`AmazonSSMManagedInstanceCore` policy is still worthwhile — it enables AWS Systems
Manager inventory and patch management, and costs nothing. The instance profile is
how EC2 instances assume IAM roles.

### Tailscale Bootstrap (in `user_data`)
The EC2 instance's first-boot script installs Tailscale and authenticates it to your
tailnet using a single-use auth key. Once joined, you can SSH to the instance via its
Tailscale IP without exposing port 22 to the internet. The auth key is consumed on
first use and cannot be reused.

### Cloudflare DNS (`cloudflare_record`)
A DNS A record pointing `borealis.loontechnology.com` to the Elastic IP, with
Cloudflare proxying enabled (orange cloud). This means:
- Cloudflare terminates TLS for browsers — your origin certificate only needs to be
  valid between Cloudflare and your EC2 instance
- Cloudflare's IP ranges are what actually hit your EC2 security group on port 443
- Direct connections to your EC2 IP are blocked by the security group

---

## File Structure

```
infra/
├── bootstrap/                  # run once to create S3 state backend
│   ├── main.tf                 # S3 bucket + DynamoDB table
│   ├── variables.tf
│   └── outputs.tf
│
├── modules/
│   ├── ec2/
│   │   ├── main.tf             # instance, key pair, IAM role/profile, EIP
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── security/
│       ├── main.tf             # security group, Cloudflare IP data source
│       ├── variables.tf
│       └── outputs.tf
│
├── main.tf                     # root: providers, backend, module calls
├── variables.tf                # all input variable declarations
├── outputs.tf                  # EIP address, instance ID, key path
├── terraform.tfvars            # gitignored — actual values
└── terraform.tfvars.example    # committed — documents required vars
```

---

## `infra/bootstrap/main.tf`

This is a standalone Terraform root. Run it once with local state before initializing
the main configuration. It creates the S3 bucket and DynamoDB table that the main
config uses as its backend.

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-2"
}

resource "aws_s3_bucket" "tfstate" {
  bucket = "borealis-tfstate-loontechcraig"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "tfstate_lock" {
  name         = "borealis-tfstate-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

output "bucket_name" {
  value = aws_s3_bucket.tfstate.bucket
}

output "dynamodb_table" {
  value = aws_dynamodb_table.tfstate_lock.name
}
```

**S3 bucket name must be globally unique.** `borealis-tfstate-loontechcraig` should
be unique enough but AWS will error on apply if it's taken — adjust if needed.

`prevent_destroy = true` on the bucket means `terraform destroy` will refuse to delete
it. This is intentional — you never want to accidentally destroy your state file.

---

## `infra/main.tf`

Root configuration. Declares providers and backend, then calls modules.

```hcl
terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  backend "s3" {
    bucket         = "borealis-tfstate-loontechcraig"
    key            = "borealis/terraform.tfstate"
    region         = "us-east-2"
    dynamodb_table = "borealis-tfstate-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

module "security" {
  source = "./modules/security"

  project_name = var.project_name
}

module "ec2" {
  source = "./modules/ec2"

  project_name       = var.project_name
  aws_region         = var.aws_region
  instance_type      = var.instance_type
  ami_id             = var.ami_id
  security_group_id  = module.security.security_group_id
  tailscale_auth_key = var.tailscale_auth_key
}

resource "cloudflare_record" "borealis" {
  zone_id = var.cloudflare_zone_id
  name    = "borealis"
  value   = module.ec2.eip_address
  type    = "A"
  proxied = true
}
```

---

## `infra/variables.tf`

```hcl
variable "project_name" {
  description = "Used as a prefix/tag on all resources"
  type        = string
  default     = "borealis"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-2"
}

variable "instance_type" {
  description = "EC2 instance type — must be arm64 (t4g family)"
  type        = string
  default     = "t4g.small"
}

variable "ami_id" {
  description = "arm64 AMI ID for us-east-2 — find latest Debian 12 arm64 in AWS console"
  type        = string
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with DNS edit permissions for loontechnology.com"
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for loontechnology.com"
  type        = string
}

variable "tailscale_auth_key" {
  description = "Single-use Tailscale auth key for joining tailnet on first boot"
  type        = string
  sensitive   = true
}
```

---

## `infra/terraform.tfvars.example`

Commit this file. It documents what is needed without exposing values.

```hcl
# Copy to terraform.tfvars and fill in values
# terraform.tfvars is gitignored

project_name         = "borealis"
aws_region           = "us-east-2"
instance_type        = "t4g.small"

# Find the latest Debian 12 arm64 AMI for us-east-2:
# AWS Console → EC2 → AMIs → Public images
# Filter: Owner=136693071363 (Debian), Architecture=arm64, Name=debian-12-*
ami_id               = "ami-xxxxxxxxxxxxxxxxx"

# Cloudflare
cloudflare_api_token = "your-cloudflare-api-token"
cloudflare_zone_id   = "your-zone-id"

# Generate at: https://login.tailscale.com/admin/settings/keys
# Use a single-use, ephemeral key
tailscale_auth_key   = "tskey-auth-xxxxxxxxx"
```

---

## `infra/modules/security/main.tf`

Fetches Cloudflare's published IP ranges via HTTP data sources and creates a security
group that allows inbound 443 only from those ranges.

```hcl
# Cloudflare publishes their IP ranges at these URLs
data "http" "cloudflare_ips_v4" {
  url = "https://www.cloudflare.com/ips-v4"
}

data "http" "cloudflare_ips_v6" {
  url = "https://www.cloudflare.com/ips-v6"
}

locals {
  cloudflare_ipv4_cidrs = compact(split("\n", trimspace(data.http.cloudflare_ips_v4.response_body)))
  cloudflare_ipv6_cidrs = compact(split("\n", trimspace(data.http.cloudflare_ips_v6.response_body)))
}

resource "aws_security_group" "borealis" {
  name        = "${var.project_name}-sg"
  description = "Borealis — HTTPS from Cloudflare only, all outbound"

  # HTTPS inbound from Cloudflare IPv4 ranges only
  ingress {
    description = "HTTPS from Cloudflare IPv4"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = local.cloudflare_ipv4_cidrs
  }

  # HTTPS inbound from Cloudflare IPv6 ranges
  ingress {
    description      = "HTTPS from Cloudflare IPv6"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    ipv6_cidr_blocks = local.cloudflare_ipv6_cidrs
  }

  # All outbound allowed
  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name    = "${var.project_name}-sg"
    Project = var.project_name
  }
}
```

**Why no SSH inbound rule?** Tailscale establishes outbound connections to its
coordination server and creates an encrypted overlay network. SSH over Tailscale
travels through that overlay — it never touches the EC2 security group. Port 22
does not need to be open to the internet.

**Why fetch Cloudflare IPs dynamically?** Cloudflare occasionally adds new IP ranges.
Fetching them at apply time means `terraform apply` always uses the current list.
The tradeoff is that apply requires internet access and the list can change between
plans — acceptable for this use case.

---

## `infra/modules/security/variables.tf`

```hcl
variable "project_name" {
  type = string
}
```

## `infra/modules/security/outputs.tf`

```hcl
output "security_group_id" {
  value = aws_security_group.borealis.id
}
```

---

## `infra/modules/ec2/main.tf`

```hcl
# Generate an RSA private key
resource "tls_private_key" "borealis" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

# Register the public key with EC2
resource "aws_key_pair" "borealis" {
  key_name   = "${var.project_name}-key"
  public_key = tls_private_key.borealis.public_key_openssh
}

# Save the private key locally — gitignored
resource "local_sensitive_file" "private_key" {
  content         = tls_private_key.borealis.private_key_pem
  filename        = "${path.module}/../../keys/${var.project_name}.pem"
  file_permission = "0600"
}

# IAM role for the instance
resource "aws_iam_role" "borealis" {
  name = "${var.project_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

# Attach SSM managed instance core policy
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.borealis.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "borealis" {
  name = "${var.project_name}-profile"
  role = aws_iam_role.borealis.name
}

# EC2 instance
resource "aws_instance" "borealis" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  key_name               = aws_key_pair.borealis.key_name
  vpc_security_group_ids = [var.security_group_id]
  iam_instance_profile   = aws_iam_instance_profile.borealis.name

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }

  user_data = templatefile("${path.module}/user_data.sh.tpl", {
    tailscale_auth_key = var.tailscale_auth_key
  })

  tags = {
    Name    = var.project_name
    Project = var.project_name
  }
}

# Elastic IP
resource "aws_eip" "borealis" {
  instance = aws_instance.borealis.id
  domain   = "vpc"

  tags = {
    Name    = "${var.project_name}-eip"
    Project = var.project_name
  }
}
```

---

## `infra/modules/ec2/user_data.sh.tpl`

This script runs once on first boot as root. It installs Docker, installs Tailscale,
joins your tailnet, and sets up the directory structure for the prod Docker Compose
stack. It does not start the application — that is done manually after the Cloudflare
Origin Certificate and `.env` are placed on the instance.

```bash
#!/bin/bash
set -euo pipefail

# ── System update ─────────────────────────────────────────────────────────────
apt-get update
apt-get upgrade -y

# ── Docker ────────────────────────────────────────────────────────────────────
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

systemctl enable docker
systemctl start docker

# ── Tailscale ─────────────────────────────────────────────────────────────────
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --authkey="${tailscale_auth_key}" --ssh

# ── Application directory structure ───────────────────────────────────────────
mkdir -p /opt/borealis/certs

# Placeholder .env — operator must fill this in before starting the stack
cat > /opt/borealis/.env.example <<'EOF'
POSTGRES_PASSWORD=
USER_AGENT=borealis/1.0
KP_URL=https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json
BZ_URL=https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json
WIND_URL=https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json
EOF

echo "Bootstrap complete. Next steps:"
echo "  1. Copy docker-compose.prod.yml to /opt/borealis/docker-compose.yml"
echo "  3. Place Cloudflare Origin Cert at /opt/borealis/certs/origin.pem"
echo "  4. Place Cloudflare Origin Key at /opt/borealis/certs/origin.key"
echo "  5. Create /opt/borealis/.env from .env.example"
echo "  6. Run: cd /opt/borealis && docker compose pull && docker compose up -d"
```

`--ssh` on the `tailscale up` command enables Tailscale SSH — this allows you to SSH
to the instance via its Tailscale IP using your existing Tailscale identity without
managing SSH keys manually. The EC2 key pair is a fallback only.

---

## `infra/modules/ec2/variables.tf`

```hcl
variable "project_name" { type = string }
variable "aws_region"   { type = string }
variable "instance_type" { type = string }
variable "ami_id"        { type = string }
variable "security_group_id" { type = string }
variable "tailscale_auth_key" {
  type      = string
  sensitive = true
}
```

## `infra/modules/ec2/outputs.tf`

```hcl
output "eip_address" {
  value       = aws_eip.borealis.public_ip
  description = "Public IP of the Borealis EC2 instance — used for Cloudflare DNS"
}

output "instance_id" {
  value = aws_instance.borealis.id
}

output "key_path" {
  value       = local_sensitive_file.private_key.filename
  description = "Path to the generated SSH private key (fallback access)"
}
```

## `infra/outputs.tf`

```hcl
output "eip_address" {
  value       = module.ec2.eip_address
  description = "Point your Cloudflare DNS A record here"
}

output "instance_id" {
  value = module.ec2.instance_id
}

output "dns_record" {
  value = "borealis.loontechnology.com → ${module.ec2.eip_address}"
}
```

---

## Finding the arm64 AMI ID

Before filling in `terraform.tfvars`, find the current Debian 12 arm64 AMI for
`us-east-2`:

```bash
aws ec2 describe-images \
  --region us-east-2 \
  --owners 136693071363 \
  --filters \
    "Name=name,Values=debian-12-arm64-*" \
    "Name=architecture,Values=arm64" \
    "Name=state,Values=available" \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
  --output text
```

Owner `136693071363` is the official Debian AWS account. Use the most recent image
returned.

---

## Execution Order

### Step A — Bootstrap (run once)

```bash
cd infra/bootstrap
terraform init
terraform apply
# Note the bucket_name and dynamodb_table outputs
```

### Step B — Main configuration

```bash
cd infra

# Initialize with S3 backend
terraform init

# Review what will be created
terraform plan

# Apply
terraform apply
```

### Step C — Verify

```bash
# Confirm outputs
terraform output

# Confirm DNS record exists in Cloudflare dashboard
# Confirm instance appears in AWS EC2 console
# Confirm EIP is associated with the instance
# Confirm instance appears in your Tailscale admin console
#   (https://login.tailscale.com/admin/machines)

# SSH via Tailscale (once instance is in your tailnet)
ssh admin@<tailscale-ip>
```

---

## `terraform.tfvars` (gitignored, you create this)

```hcl
ami_id               = "ami-xxxxxxxxxxxxxxxxx"   # from AWS CLI command above
cloudflare_api_token = "your-cloudflare-api-token"
cloudflare_zone_id   = "your-zone-id"
tailscale_auth_key   = "tskey-auth-xxxxxxxxx"
```

---

## Verification Checklist

- [ ] `terraform init` succeeds in `infra/bootstrap/` — providers download cleanly
- [ ] `terraform apply` in bootstrap creates S3 bucket and DynamoDB table
- [ ] `terraform init` succeeds in `infra/` — connects to S3 backend
- [ ] `terraform plan` shows expected resources with no errors
- [ ] `terraform apply` completes with no errors
- [ ] EC2 instance visible in AWS console, running, arm64 architecture
- [ ] EIP associated with instance in AWS console
- [ ] `terraform output eip_address` matches the EIP in AWS console
- [ ] DNS A record `borealis.loontechnology.com` visible in Cloudflare dashboard
      pointing to EIP, proxied (orange cloud)
- [ ] Instance appears in Tailscale admin console within ~2 minutes of boot
- [ ] SSH via Tailscale works: `ssh admin@<tailscale-ip>`
- [ ] Docker is running on the instance: `docker ps` returns without error
- [ ] Security group has no inbound rules except 443 from Cloudflare IP ranges

---

## What Is NOT In This Step

- TLS / Cloudflare Origin Certificate — wired into the API binary in Step 7
- Docker Compose stack startup — done manually after certs and `.env` are placed
- GitHub Actions deploy trigger — added in Step 8
- No Rust, frontend, or CI changes
