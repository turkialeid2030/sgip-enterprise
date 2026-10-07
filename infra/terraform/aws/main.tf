terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 2.24" }
    helm = { source = "hashicorp/helm", version = "~> 2.12" }
  }
  # Backend coordinates are supplied explicitly at init time.
  # Production must never silently target a hard-coded/shared state bucket.
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "SGIP-Sovereign-GRC"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.4.0"
  name    = "sgip-${var.environment}-vpc"
  cidr    = var.vpc_cidr
  azs              = ["${var.aws_region}a","${var.aws_region}b","${var.aws_region}c"]
  private_subnets  = var.private_subnet_cidrs
  public_subnets   = var.public_subnet_cidrs
  database_subnets = var.database_subnet_cidrs
  enable_nat_gateway     = true
  one_nat_gateway_per_az = true
  enable_flow_log        = true
  public_subnet_tags  = { "kubernetes.io/role/elb"          = "1" }
  private_subnet_tags = { "kubernetes.io/role/internal-elb" = "1" }
}

module "eks" {
  source          = "terraform-aws-modules/eks/aws"
  version         = "20.2.0"
  cluster_name    = "sgip-${var.environment}"
  cluster_version = var.eks_cluster_version
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.private_subnets
  cluster_endpoint_public_access       = true
  cluster_endpoint_private_access      = true
  cluster_endpoint_public_access_cidrs = var.allowed_cidr_blocks
  cluster_addons = {
    coredns            = { most_recent = true }
    kube-proxy         = { most_recent = true }
    vpc-cni            = { most_recent = true }
    aws-ebs-csi-driver = { most_recent = true }
  }
  eks_managed_node_groups = {
    api = {
      name           = "sgip-api"
      instance_types = ["c6i.xlarge","c6i.2xlarge"]
      min_size       = 3
      max_size       = 15
      desired_size   = 3
      labels         = { role = "api" }
    }
    data = {
      name           = "sgip-data"
      instance_types = ["r6i.xlarge"]
      min_size       = 3
      max_size       = 6
      desired_size   = 3
      labels         = { role = "data" }
    }
  }
}

module "rds" {
  source             = "terraform-aws-modules/rds/aws"
  version            = "6.3.1"
  identifier         = "sgip-${var.environment}-postgres"
  engine             = "postgres"
  engine_version     = "16.1"
  instance_class     = var.db_instance_class
  allocated_storage  = var.db_storage_gb
  max_allocated_storage = var.db_max_storage_gb
  db_name            = "sgip_prod"
  username           = "sgip_admin"
  password           = var.db_password
  multi_az           = true
  db_subnet_group_name   = module.vpc.database_subnet_group
  vpc_security_group_ids = [aws_security_group.rds.id]
  backup_retention_period = 35
  deletion_protection     = true
  storage_encrypted       = true
  kms_key_id              = aws_kms_key.rds.arn
  parameters = [
    { name = "log_statement",    value = "all" },
    { name = "log_connections",  value = "1"   },
    { name = "shared_preload_libraries", value = "pg_stat_statements" },
  ]
}

resource "aws_kms_key" "rds" {
  description             = "SGIP RDS encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_security_group" "rds" {
  name_prefix = "sgip-rds-"
  vpc_id      = module.vpc.vpc_id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }
}

resource "aws_msk_cluster" "governance_events" {
  cluster_name           = "sgip-${var.environment}-events"
  kafka_version          = "3.6.0"
  number_of_broker_nodes = 3
  broker_node_group_info {
    instance_type   = var.kafka_instance_type
    client_subnets  = module.vpc.private_subnets
    security_groups = [aws_security_group.kafka.id]
    storage_info {
      ebs_storage_info { volume_size = 1000 }
    }
  }
  encryption_info {
    encryption_in_transit { client_broker = "TLS"; in_cluster = true }
    encryption_at_rest_kms_key_arn = aws_kms_key.kafka.arn
  }
}

resource "aws_kms_key" "kafka" {
  description             = "SGIP Kafka encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_security_group" "kafka" {
  name_prefix = "sgip-kafka-"
  vpc_id      = module.vpc.vpc_id
  ingress {
    from_port       = 9094
    to_port         = 9094
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }
}

output "cluster_endpoint"        { value = module.eks.cluster_endpoint        }
output "cluster_name"            { value = module.eks.cluster_name            }
output "rds_endpoint"            { value = module.rds.db_instance_endpoint    }
output "kafka_brokers"           { value = aws_msk_cluster.governance_events.bootstrap_brokers_tls }
output "vpc_id"                  { value = module.vpc.vpc_id                  }
