# Colors
BOLD   := \033[1m
RESET  := \033[0m
CYAN   := \033[36m
GREEN  := \033[32m
YELLOW := \033[33m
RED    := \033[31m
GRAY   := \033[90m
MAGENTA := \033[35m

IMAGE  := es-okta-auth-proxy
PORT   := 3344

# ── Runtime detection (override: RUNTIME=podman make up) ──────────────────────
ifeq ($(RUNTIME),)
  ifneq ($(shell command -v docker 2>/dev/null),)
    RUNTIME := docker
  else ifneq ($(shell command -v podman 2>/dev/null),)
    RUNTIME := podman
  else
    $(error No container runtime found. Install docker or podman.)
  endif
endif

# ── Compose detection (override: COMPOSE="podman-compose" make up) ────────────
ifeq ($(COMPOSE),)
  ifeq ($(RUNTIME),podman)
    ifneq ($(shell command -v podman-compose 2>/dev/null),)
      COMPOSE := podman-compose
    else
      COMPOSE := podman compose
    endif
  else
    ifneq ($(shell docker compose version 2>/dev/null),)
      COMPOSE := docker compose
    else ifneq ($(shell command -v docker-compose 2>/dev/null),)
      COMPOSE := docker-compose
    else
      $(error No compose tool found. Install docker compose plugin or podman-compose.)
    endif
  endif
endif

.DEFAULT_GOAL := help

.PHONY: help build up down logs shell clean restart status env-check env-init check-version

# Auto-create .env from env.example if missing
.env:
	@echo "$(YELLOW)» .env not found — copying from env.example$(RESET)"
	@cp env.example .env
	@echo "$(RED)  Edit .env before continuing$(RESET)"
	@exit 1

help: ## Show this help
	@echo ""
	@echo "  $(BOLD)$(CYAN)es-okta-auth-proxy$(RESET)"
	@echo "  $(GRAY)Okta OIDC → Elasticsearch auth proxy$(RESET)"
	@echo ""
	@echo "  $(GRAY)runtime:$(RESET) $(MAGENTA)$(RUNTIME)$(RESET)   $(GRAY)compose:$(RESET) $(MAGENTA)$(COMPOSE)$(RESET)"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  $(CYAN)%-12s$(RESET) %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""
	@echo "  $(GRAY)Override runtime:  RUNTIME=podman make up$(RESET)"
	@echo "  $(GRAY)Override compose:  COMPOSE=podman-compose make up$(RESET)"
	@echo ""

build: ## Build the container image
	@echo "$(BOLD)$(CYAN)» Building image [$(RUNTIME)]...$(RESET)"
	@$(COMPOSE) build --no-cache
	@echo "$(GREEN)✓ Build complete$(RESET)"

env-init: .env ## Create .env from env.example (noop if exists)

up: .env ## Start the proxy (detached)
	@echo "$(BOLD)$(CYAN)» Starting proxy on :$(PORT) [$(COMPOSE)]...$(RESET)"
	@$(COMPOSE) up -d
	@echo "$(GREEN)✓ Running → http://localhost:$(PORT)$(RESET)"

down: ## Stop and remove containers
	@echo "$(BOLD)$(YELLOW)» Stopping proxy...$(RESET)"
	@$(COMPOSE) down
	@echo "$(GREEN)✓ Stopped$(RESET)"

restart: down up ## Restart the proxy

logs: ## Tail proxy logs
	@$(COMPOSE) logs -f --tail=50

shell: ## Open a shell in the running container
	@$(RUNTIME) exec -it $$($(COMPOSE) ps -q proxy) sh

status: ## Show container status
	@echo ""
	@$(COMPOSE) ps
	@echo ""

clean: ## Remove containers, image, and volumes
	@echo "$(BOLD)$(RED)» Removing containers and image...$(RESET)"
	@$(COMPOSE) down --rmi local --volumes --remove-orphans 2>/dev/null || \
	  $(COMPOSE) down --rmi all --volumes 2>/dev/null || true
	@echo "$(GREEN)✓ Clean$(RESET)"

check-version: ## Verify image.tag and APP_VERSION match in argocd sandbox values
	@CHART=argocd/sandbox/es-okta-auth-proxy-swi-app-chart.yaml; \
	IMG=$$(grep 'tag:' $$CHART | grep -v '#' | awk '{print $$2}' | tr -d '"'); \
	VER=$$(grep 'APP_VERSION:' $$CHART | awk '{print $$2}' | tr -d '"'); \
	if [ "$$IMG" != "$$VER" ]; then \
		echo "$(RED)✗ version mismatch: image.tag=$$IMG APP_VERSION=$$VER$(RESET)"; exit 1; \
	else \
		echo "$(GREEN)✓ image.tag == APP_VERSION == $$IMG$(RESET)"; \
	fi

env-check: ## Validate required env vars are set in .env
	@echo "$(BOLD)$(CYAN)» Checking environment...$(RESET)"
	@missing=0; \
	for var in OKTA_DOMAIN OKTA_CLIENT_ID OKTA_CLIENT_SECRET OKTA_REDIRECT_URI ES_URL ES_API_KEY SESSION_SECRET; do \
		if [ -z "$$(grep -s "^$$var=" .env | cut -d= -f2-)" ]; then \
			echo "  $(RED)✗ $$var$(RESET)"; missing=1; \
		else \
			echo "  $(GREEN)✓ $$var$(RESET)"; \
		fi; \
	done; \
	if [ $$missing -eq 1 ]; then echo "\n$(RED)Fill missing vars in .env$(RESET)\n"; exit 1; fi
	@echo "$(GREEN)✓ All vars present$(RESET)"
