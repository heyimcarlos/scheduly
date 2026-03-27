"""Supabase client for API → Supabase database operations."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic_settings import BaseSettings, SettingsConfigDict
from supabase import create_client, Client


class SupabaseSettings(BaseSettings):
    """Supabase configuration settings."""

    supabase_url: str = ""
    supabase_service_role_key: str = ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache()
def get_supabase_settings() -> SupabaseSettings:
    """Get cached Supabase settings."""
    return SupabaseSettings()


@lru_cache()
def get_supabase_client() -> Client:
    """Get memoized Supabase admin client.

    Uses service role key - bypasses RLS.
    Only for server-side operations that need admin access.
    """
    settings = get_supabase_settings()

    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise ValueError(
            "Supabase configuration missing. "
            "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env"
        )

    return create_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
    )
