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
