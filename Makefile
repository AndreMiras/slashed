SHELL=/bin/bash
IMAGE_TAG=latest
PROJECT=slashed-397106
CLOUD_RUN_REGION=us-east1
REGISTRY_REGION=us-docker
REGISTRY_HOSTNAME=$(REGISTRY_REGION).pkg.dev
REGISTRY_REPOSITORY=public
REGISTRY=$(REGISTRY_HOSTNAME)/$(PROJECT)/$(REGISTRY_REPOSITORY)
INDEXER_IMAGE_NAME=indexer
INDEXER_DOCKER_IMAGE=$(REGISTRY)/$(INDEXER_IMAGE_NAME)
ENV_FILE=.env
CLOUDSDK_CORE_ACCOUNT?=notset
ifndef CI
DOCKER_IT=-it
endif

ifneq (,$(wildcard $(ENV_FILE)))
    include $(ENV_FILE)
endif

ensure-account-set:
ifeq ($(CLOUDSDK_CORE_ACCOUNT),notset)
	$(error CLOUDSDK_CORE_ACCOUNT is not set. Please set it to a valid email address.)
endif

devops/terraform/fmt:
	terraform -chdir=terraform fmt -recursive -diff

devops/terraform/init:
	terraform -chdir=terraform init

devops/terraform/plan:
	terraform -chdir=terraform plan

devops/terraform/apply:
	terraform -chdir=terraform apply -auto-approve

devops/terraform/output:
	terraform -chdir=terraform output

devops/gcloud/run/slashed-indexer-cloud-run-job/%: ensure-account-set
	CLOUDSDK_CORE_ACCOUNT=$(CLOUDSDK_CORE_ACCOUNT) gcloud beta --project $(PROJECT) run jobs execute slashed-indexer-$*-cloud-run-job --wait --region $(CLOUD_RUN_REGION)

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
	CLOUDSDK_CORE_ACCOUNT=$(CLOUDSDK_CORE_ACCOUNT) gcloud auth configure-docker $(REGISTRY_REGION).pkg.dev
	CLOUDSDK_CORE_ACCOUNT=$(CLOUDSDK_CORE_ACCOUNT) gcloud auth print-access-token | docker login --username oauth2accesstoken --password-stdin https://$(REGISTRY_REGION).pkg.dev


docker/push: ensure-account-set
	CLOUDSDK_CORE_ACCOUNT=$(CLOUDSDK_CORE_ACCOUNT) docker push $(INDEXER_DOCKER_IMAGE):$(IMAGE_TAG)

docker/run:
	docker run $(DOCKER_IT) --env-file .env --rm $(INDEXER_DOCKER_IMAGE)

docker/run/sh:
	docker run $(DOCKER_IT) --env-file .env --entrypoint /bin/sh --rm $(INDEXER_DOCKER_IMAGE)
