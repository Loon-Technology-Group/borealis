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
