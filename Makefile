# Colors
BOLD   := \033[1m
RESET  := \033[0m
CYAN   := \033[36m
GREEN  := \033[32m
YELLOW := \033[33m
RED    := \033[31m
GRAY   := \033[90m

IMAGE  := es-okta-auth-proxy
PORT   := 3000

.DEFAULT_GOAL := help

.PHONY: help build up down logs shell clean restart status

help: ## Show this help
	@echo ""
	@echo "  $(BOLD)$(CYAN)es-okta-auth-proxy$(RESET)"
	@echo "  $(GRAY)Okta OIDC → Elasticsearch auth proxy$(RESET)"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  $(CYAN)%-12s$(RESET) %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""

build: ## Build the Docker image
	@echo "$(BOLD)$(CYAN)» Building image...$(RESET)"
	@docker compose build
	@echo "$(GREEN)✓ Build complete$(RESET)"

up: ## Start the proxy (detached)
	@echo "$(BOLD)$(CYAN)» Starting proxy on :$(PORT)...$(RESET)"
	@docker compose up -d
	@echo "$(GREEN)✓ Running → http://localhost:$(PORT)$(RESET)"

down: ## Stop and remove containers
	@echo "$(BOLD)$(YELLOW)» Stopping proxy...$(RESET)"
	@docker compose down
	@echo "$(GREEN)✓ Stopped$(RESET)"

restart: down up ## Restart the proxy

logs: ## Tail proxy logs
	@docker compose logs -f --tail=50

shell: ## Open a shell in the running container
	@docker compose exec proxy sh

status: ## Show container status
	@echo ""
	@docker compose ps
	@echo ""

clean: ## Remove containers, image, and volumes
	@echo "$(BOLD)$(RED)» Removing containers and image...$(RESET)"
	@docker compose down --rmi local --volumes --remove-orphans
	@echo "$(GREEN)✓ Clean$(RESET)"

env-check: ## Validate required env vars are set
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
