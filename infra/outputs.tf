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
