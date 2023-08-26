SHELL=/bin/bash
IMAGE_TAG=latest
PROJECT=slashed-397106
CLOUD_RUN_REGION=us-east1
REGISTRY=gcr.io/$(PROJECT)
INDEXER_IMAGE_NAME=indexer
INDEXER_DOCKER_IMAGE=$(REGISTRY)/$(INDEXER_IMAGE_NAME)
CLOUDSDK_CORE_ACCOUNT?=notset
ifndef CI
DOCKER_IT=-it
endif


ensure-account-set:
ifeq ($(CLOUDSDK_CORE_ACCOUNT),notset)
	$(error CLOUDSDK_CORE_ACCOUNT is not set. Please set it to a valid email address.)
endif

devops/terraform/fmt:
	terraform -chdir=terraform fmt -recursive -diff

devops/terraform/init: ensure-account-set
	terraform -chdir=terraform init

devops/terraform/plan: ensure-account-set
	terraform -chdir=terraform plan

devops/terraform/apply: ensure-account-set
	terraform -chdir=terraform apply -auto-approve

devops/terraform/output:
	terraform -chdir=terraform output

devops/gcloud/run/slashed-indexer-cloud-run-job/%: ensure-account-set
	gcloud beta --project $(PROJECT) run jobs execute slashed-indexer-$*-cloud-run-job --wait --region $(CLOUD_RUN_REGION)

lint/terraform:
	terraform -chdir=terraform fmt -recursive -check -diff

lint/node:
	npm run lint

lint: lint/node lint/terraform

format/node:
	npm run format

format/terraform: devops/terraform/fmt

format: format/node format/terraform

docker/build:
	docker build --tag=$(INDEXER_DOCKER_IMAGE):$(IMAGE_TAG) .

docker/login: ensure-account-set
	gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin https://gcr.io

docker/push: ensure-account-set
	docker push $(INDEXER_DOCKER_IMAGE):$(IMAGE_TAG)

docker/run:
	docker run $(DOCKER_IT) --env-file .env --rm $(INDEXER_DOCKER_IMAGE)

docker/run/sh:
	docker run $(DOCKER_IT) --env-file .env --entrypoint /bin/sh --rm $(INDEXER_DOCKER_IMAGE)
