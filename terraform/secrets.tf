resource "google_project_service" "secretmanager" {
  provider           = google
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

# Supabase
data "google_secret_manager_secret" "supabase_url" {
  secret_id  = "${var.service_name}-supabase-url"
  depends_on = [google_project_service.secretmanager]
}

data "google_secret_manager_secret" "supabase_service_role_key" {
  secret_id  = "${var.service_name}-supabase-service-role-key"
  depends_on = [google_project_service.secretmanager]
}

# Tendermint
data "google_secret_manager_secret" "tendermint_rpc" {
  for_each   = toset(var.chains)
  secret_id  = "${var.service_name}-${each.key}-tendermint-rpc"
  depends_on = [google_project_service.secretmanager]
}
