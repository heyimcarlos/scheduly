.PHONY: setup

setup:
	pnpm install
	cd apps/api && uv sync
	cd packages/ml && uv sync
