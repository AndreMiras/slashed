resource "google_cloud_run_v2_job" "indexer" {
  for_each = toset(var.chains)
  name     = "${var.service_name}-indexer-${each.key}-cloud-run-job"
  location = var.region
  template {
    task_count = 1
    template {
      timeout         = "${var.run_job_timeout * 60}s"
      max_retries     = 1
      service_account = var.client_email
      containers {
        image = local.indexer_image
        env {
          name  = "CHAIN_NAME"
          value = each.key
        }
        env {
          name = "SUPABASE_URL"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.supabase_url.secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "SUPABASE_SERVICE_ROLE_KEY"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.supabase_service_role_key.secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "TENDERMINT_RPC_URL"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.tendermint_rpc[each.key].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
}
