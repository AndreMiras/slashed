resource "google_cloud_scheduler_job" "indexer" {
  for_each    = toset(var.chains)
  name        = "${var.service_name}-indexer-${each.key}-scheduler-job"
  description = "Run the ${each.key} indexer Cloud Run job"
  # hourly
  schedule = "0 * * * *"
  http_target {
    http_method = "POST"
    uri         = "https://${google_cloud_run_v2_job.indexer[each.key].location}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project}/jobs/${google_cloud_run_v2_job.indexer[each.key].name}:run"
    oauth_token {
      service_account_email = var.client_email
    }
  }
  depends_on = [
    resource.google_project_service.cloudscheduler_api,
    resource.google_cloud_run_v2_job.indexer,
  ]
}
