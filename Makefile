PYTHON ?= $(if $(wildcard .venv/bin/python3),.venv/bin/python3,python3)

.PHONY: all build lint typecheck test smoke verify clean

all: verify

build:
	@echo "--> Building apps/web..."
	npm --prefix apps/web run build
	@echo "--> Building services/edge-ingest..."
	(cd services/edge-ingest && go build -v -o /dev/null .)
	@echo "--> Compiling Python services..."
	$(PYTHON) -m py_compile services/intelligence/app/*.py services/execution/app/*.py

typecheck:
	@echo "--> Typechecking apps/web..."
	npm --prefix apps/web run typecheck

lint: typecheck
	@echo "--> Linting services/edge-ingest..."
	(cd services/edge-ingest && go vet ./...)
	@echo "--> Linting Python services..."
	$(PYTHON) -m py_compile services/intelligence/app/*.py services/execution/app/*.py

test:
	@echo "--> Running automated E2E tests..."
	PYTHONPATH=. $(PYTHON) tests/e2e/runner.py --tier all
	@echo "--> Running SQLite stress tests..."
	PYTHONPATH=. $(PYTHON) tests/test_sqlite_stress.py

smoke:
	@echo "--> Running live stack smoke test..."
	bash scripts/verify_all.sh smoke

verify:
	@echo "--> Running full verification suite..."
	bash scripts/verify_all.sh all

clean:
	@echo "--> Cleaning build artifacts..."
	rm -rf apps/web/.next apps/web/out
	rm -f services/edge-ingest/edge-ingest
	find services/ -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find tests/ -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
