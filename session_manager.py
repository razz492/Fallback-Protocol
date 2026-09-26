import json
from pathlib import Path

# Always use the project-root session_config.json next to this module.
# (dirname twice incorrectly pointed at ~/session_config.json and desynced the dashboard.)
CONFIG_FILE = Path(__file__).resolve().parent / "session_config.json"


def _read_config() -> dict:
    if not CONFIG_FILE.exists():
        return {"session_id": 200, "status": "idle"}
    try:
        with open(CONFIG_FILE, "r") as f:
            data = json.load(f)
            if not isinstance(data, dict):
                return {"session_id": 200, "status": "idle"}
            return data
    except Exception:
        return {"session_id": 200, "status": "idle"}


def _write_config(data: dict) -> None:
    with open(CONFIG_FILE, "w") as f:
        json.dump(data, f)


def get_current_session_id() -> int:
    """Reads the current session ID, defaulting to 200 if the file doesn't exist."""
    return int(_read_config().get("session_id", 200))


def increment_session_id() -> int:
    """Increments the session ID and resets status to idle (keeps other keys)."""
    data = _read_config()
    new_id = int(data.get("session_id", 200)) + 1
    data["session_id"] = new_id
    data["status"] = "idle"
    _write_config(data)
    return new_id


def set_session_state(session_id: int | None = None, status: str | None = None) -> dict:
    """Merge session_id/status into the shared config the dashboard polls."""
    data = _read_config()
    if session_id is not None:
        data["session_id"] = int(session_id)
    if status is not None:
        data["status"] = status
    _write_config(data)
    return data
