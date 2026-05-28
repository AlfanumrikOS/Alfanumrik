# Make tests a Python package for pytest imports
import os, sys
# Ensure the project root is on PYTHONPATH for test imports
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
