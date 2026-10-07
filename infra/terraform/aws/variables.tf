variable "aws_region"    { default = "me-south-1" }
variable "environment"   { default = "production" }
variable "vpc_cidr"      { default = "10.0.0.0/16" }
variable "private_subnet_cidrs"  { type = list(string); default = ["10.0.1.0/24","10.0.2.0/24","10.0.3.0/24"] }
variable "public_subnet_cidrs"   { type = list(string); default = ["10.0.101.0/24","10.0.102.0/24","10.0.103.0/24"] }
variable "database_subnet_cidrs" { type = list(string); default = ["10.0.201.0/24","10.0.202.0/24","10.0.203.0/24"] }
variable "cluster_endpoint_public_access" { type = bool; default = false }
variable "allowed_cidr_blocks"   { type = list(string); default = [] }
variable "db_instance_class"     { default = "db.r6g.xlarge" }
variable "db_storage_gb"         { default = 500 }
variable "db_max_storage_gb"     { default = 2000 }
variable "db_password"           { sensitive = true }
variable "kafka_instance_type"   { default = "kafka.m5.xlarge" }
