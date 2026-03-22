output "vpc_id" {
  value = aws_vpc.borealis.id
}

output "subnet_id" {
  value = aws_subnet.public.id
}
