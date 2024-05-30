## Service account variables

variable "credentials" {
  type    = string
  default = "terraform-service-key.json"
}

variable "client_email" {
  type    = string
  default = "terraform-service-account@slashed-397106.iam.gserviceaccount.com"
}

## Account variables

variable "project" {
  type    = string
  default = "slashed-397106"
}

variable "region" {
  type    = string
  default = "us-east1"
}

variable "registry_region" {
  type    = string
  default = "us"
}

variable "zone" {
  type    = string
  default = "us-east1-a"
}

variable "service_name" {
  description = "The service name is prepended to resource names."
  type        = string
  default     = "slashed"
}

## Misc

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "indexer_image" {
  type    = string
  default = "indexer"
}

variable "repository_id" {
  type    = string
  default = "public"
}

variable "chains" {
  type        = list(string)
  description = "List of supported chains."
  default = [
    "canto",
    "chihuahua",
    "composable",
    "evmos",
    "gravity",
    "kujira",
    "meme",
    "nois",
  ]
}

variable "run_job_timeout" {
  type        = number
  description = "Task timeout in minutes."
  default     = 50
}

locals {
  indexer_image = "${var.registry_region}-docker.pkg.dev/${var.project}/${var.repository_id}/${var.indexer_image}:${var.image_tag}"
}
