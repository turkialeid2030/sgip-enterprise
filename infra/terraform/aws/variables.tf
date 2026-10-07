variable "aws_region" {
  type    = string
  default = "me-south-1"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "eks_cluster_version" {
  type        = string
  description = "Explicit EKS Kubernetes version approved for the target account. No implicit production default."
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "private_subnet_cidrs" {
  type    = list(string)
  default = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
}

variable "public_subnet_cidrs" {
  type    = list(string)
  default = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
}

variable "database_subnet_cidrs" {
  type    = list(string)
  default = ["10.0.201.0/24", "10.0.202.0/24", "10.0.203.0/24"]
}

variable "cluster_endpoint_public_access" {
  type        = bool
  default     = false
  description = "Public EKS control-plane exposure is disabled by default."
}

variable "allowed_cidr_blocks" {
  type        = list(string)
  default     = []
  description = "Explicit CIDRs allowed only when public EKS endpoint access is intentionally enabled."

  validation {
    condition = (
      !contains(var.allowed_cidr_blocks, "0.0.0.0/0") &&
      !contains(var.allowed_cidr_blocks, "::/0")
    )
    error_message = "allowed_cidr_blocks must never contain 0.0.0.0/0 or ::/0."
  }
}

variable "db_instance_class" {
  type    = string
  default = "db.r6g.xlarge"
}

variable "db_storage_gb" {
  type    = number
  default = 500
}

variable "db_max_storage_gb" {
  type    = number
  default = 2000
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "kafka_instance_type" {
  type    = string
  default = "kafka.m5.xlarge"
}
