resource "google_artifact_registry_repository" "public_repository" {
  location      = var.registry_region
  repository_id = var.repository_id
  format        = "DOCKER"
  description   = "Public Docker repository"
}

resource "google_artifact_registry_repository_iam_member" "public_read" {
  for_each = toset([
    "allAuthenticatedUsers"
  ])
  location   = google_artifact_registry_repository.public_repository.location
  repository = google_artifact_registry_repository.public_repository.repository_id
  role       = "roles/artifactregistry.reader"
  member     = each.key
}
