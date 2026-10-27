import errno
import sys
from types import SimpleNamespace

import pytest
from webapp import __main__ as startup
from webapp.server import Server


def test_second_server_cannot_share_a_running_port():
    with Server(("127.0.0.1", 0), SimpleNamespace()) as first:
        with pytest.raises(OSError):
            Server(("127.0.0.1", first.server_port), SimpleNamespace())


def test_busy_port_has_readable_recovery(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["webapp", "--port", "8766", "--no-browser"])
    monkeypatch.setattr(startup, "App", lambda *args: SimpleNamespace())

    def busy(*args):
        raise OSError(errno.EADDRINUSE, "Address already in use")

    monkeypatch.setattr(startup, "Server", busy)
    with pytest.raises(SystemExit) as exc:
        startup.main()
    assert exc.value.code == 1
    message = capsys.readouterr().err
    assert "port 8766 is already in use" in message
    assert "http://127.0.0.1:8766" in message
    assert "--port" in message


@pytest.mark.parametrize("port", ["-1", "65536"])
def test_invalid_port_rejected_before_opening_data(monkeypatch, capsys, port):
    monkeypatch.setattr(sys, "argv", ["webapp", "--port", port])

    def unexpected(*args):
        pytest.fail("Invalid configuration must not create or seed a data folder")

    monkeypatch.setattr(startup, "App", unexpected)
    with pytest.raises(SystemExit) as exc:
        startup.main()
    assert exc.value.code == 2
    assert "--port must be between" in capsys.readouterr().err
