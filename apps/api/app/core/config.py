"""Application configuration and settings."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Scheduler API"
    debug: bool = True

    workspace_root: Path = Path(__file__).resolve().parents[4]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def shared_config_path(self) -> Path:
        return self.workspace_root / "packages/shared/system_config.json"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
