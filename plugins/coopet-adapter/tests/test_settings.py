import tomllib
from pathlib import Path

from coopet_adapter.settings import AdapterSettings

ROOT = Path(__file__).resolve().parent.parent


def test_defaults():
    s = AdapterSettings()
    assert s.plugin.enabled is False
    assert s.server.port == 18100
    assert s.server.token == ""
    assert s.identity.owner_user_id == "owner"


def test_example_config_matches_defaults():
    example = tomllib.loads((ROOT / "config.example.toml").read_text(encoding="utf-8"))
    assert AdapterSettings.model_validate(example) == AdapterSettings()


def test_token_is_hidden_from_repr():
    s = AdapterSettings.model_validate({"server": {"token": "secret-value"}})
    assert "secret-value" not in repr(s)
