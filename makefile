IMAGE_NAME ?= k8s-lab
REGISTRY ?= docker.io/elroymalayov
TAG ?= latest

FULL_IMAGE := $(REGISTRY)/$(IMAGE_NAME):$(TAG)
.PHONY: build push release all

build:
	@echo "Building Docker image: $(FULL_IMAGE)"
	docker build -t $(FULL_IMAGE) .

push:
	@echo "Pushing Docker image: $(FULL_IMAGE)"
	docker push $(FULL_IMAGE)

release: build push
	@echo "Successfuly built and pushed $(FULL_IMAGE)"

all: release

DEPLOYMENT_FILE ?= k8s/deployment.yaml

.PHONY: deploy deploy-all

# עדכון גרסה בקובץ והחלה בקוברנטיס
deploy:
	@echo "Updating image tag to $(TAG) in $(DEPLOYMENT_FILE)..."
	@sed -i.bak -E 's|image: $(REGISTRY)/$(IMAGE_NAME):.*|image: $(FULL_IMAGE)|g' $(DEPLOYMENT_FILE) && rm -f $(DEPLOYMENT_FILE).bak
	@echo "Applying deployment to Kubernetes..."
	kubectl apply -f $(DEPLOYMENT_FILE)
	@echo "Deployment applied successfully with $(FULL_IMAGE)"

# שרשרת מלאה: בנייה -> דחיפה -> פריסה לקוברנטיס
deploy-all: release deploy
