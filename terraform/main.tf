terraform {
  backend "gcs" {
    bucket      = "slashed-bucket-tfstate"
    prefix      = "terraform/state"
    credentials = "terraform-service-key.json"
  }
}

provider "google" {
  project     = var.project
  credentials = file(var.credentials)
  region      = var.region
  zone        = var.zone
}

resource "google_storage_bucket" "default" {
  name          = "${var.service_name}-bucket-tfstate"
  force_destroy = false
  location      = "US"
  storage_class = "STANDARD"
  versioning {
    enabled = true
  }
}

resource "google_project_service" "cloud_run_api" {
  project            = var.project
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "cloudscheduler_api" {
  project            = var.project
  service            = "run.googleapis.com"
  disable_on_destroy = false
}
