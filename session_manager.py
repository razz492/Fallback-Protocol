import json
from pathlib import Path

CONFIG_FILE = Path("session_config.json")

def get_current_session_id():
    """Reads the current session ID, defaulting to 200 if the file doesn't exist."""
    if not CONFIG_FILE.exists():
        return 200
    with open(CONFIG_FILE, 'r') as f:
        data = json.load(f)
        return data.get("session_id", 200)

def increment_session_id():
    """Increments the session ID and saves it to the file."""
    current_id = get_current_session_id()
    new_id = current_id + 1
    with open(CONFIG_FILE, 'w') as f:
        json.dump({"session_id": new_id}, f)
    return new_id