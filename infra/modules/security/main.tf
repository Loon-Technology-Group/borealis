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
  description = "Borealis-HTTPS from Cloudflare only, all outbound"
  vpc_id      = var.vpc_id

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
