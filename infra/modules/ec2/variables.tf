variable "project_name" { type = string }
variable "aws_region"   { type = string }
variable "instance_type" { type = string }
variable "ami_id"        { type = string }
variable "subnet_id"     { type = string }
variable "security_group_id" { type = string }
variable "tailscale_auth_key" {
  type      = string
  sensitive = true
}
