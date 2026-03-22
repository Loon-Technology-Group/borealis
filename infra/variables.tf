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

variable "vpc_cidr" {
  description = "CIDR block for the Borealis VPC"
  type        = string
  default     = "10.1.1.0/24"
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
