SHELL=/bin/bash
IMAGE_TAG=latest
REGISTRY=andremiras
INDEXER_IMAGE_NAME=indexer
INDEXER_DOCKER_IMAGE=$(REGISTRY)/$(INDEXER_IMAGE_NAME)
ifndef CI
DOCKER_IT=-it
endif


docker/build:
	docker build --tag=$(INDEXER_DOCKER_IMAGE):$(IMAGE_TAG) .

docker/login:
	gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin https://gcr.io

docker/push:
	docker push $(INDEXER_DOCKER_IMAGE):$(IMAGE_TAG)

docker/run:
	docker run $(DOCKER_IT) --env-file .env --rm $(INDEXER_DOCKER_IMAGE)

docker/run/sh:
	docker run $(DOCKER_IT) --env-file .env --entrypoint /bin/sh --rm $(INDEXER_DOCKER_IMAGE)
