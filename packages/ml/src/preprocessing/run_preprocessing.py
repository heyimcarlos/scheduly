"""
Entry point for running the preprocessing pipeline.
Usage: python -m src.preprocessing.run_preprocessing
Or: python src/preprocessing/run_preprocessing.py
"""

import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from src.preprocessing.preprocessing import main

if __name__ == "__main__":
    main()
