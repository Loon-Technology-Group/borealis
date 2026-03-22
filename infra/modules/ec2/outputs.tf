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
