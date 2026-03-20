"""
Entry point for the scheduler backend.
This file allows running the backend with: python main.py
Or with uvicorn: uvicorn main:app --reload
"""
from app.main import app
import uvicorn

def main():
    """Run the FastAPI application."""
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )

if __name__ == "__main__":
    main()
