"""Check: when a model is overloaded (503/429...) or too slow to start answering, the relay asks the next model in
line, skips the failed model for a while, and gives up (passes the error on) only after the last one.
Uses a fake connection class, so nothing goes to the internet and no key is involved."""
import http.client, io, json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools", "jarvis_trial"))
import gemini_relay as g

g.log = lambda entry: None
g.BACKUP_MODELS = ["B", "C"]


class FakeResp:
    def __init__(self, status):
        self.status, self.done = status, False
    def read(self, n=-1):
        if self.done:
            return b""
        self.done = True
        return b'{"choices":[]}' if self.status == 200 else b"x"
    def getheaders(self):
        return [("Content-Type", "application/json")]
    def getheader(self, k, d=""):
        return "application/json"


def run(script, model="A"):
    """script: model name -> status (int) or 'slow' (never starts answering). Returns (models asked, status sent)."""
    asked = []
    class FakeConn:
        sock = None
        def __init__(self, *a, **k): pass
        def request(self, method, path, body=None, headers=None):
            asked.append(json.loads(body)["model"])
        def getresponse(self):
            s = script[asked[-1]]
            if s == "slow":
                raise TimeoutError()
            return FakeResp(s)
        def close(self): pass
    http.client.HTTPSConnection = FakeConn
    h = g.Handler.__new__(g.Handler)
    h.command, h.path = "POST", "/v1beta/openai/chat/completions"
    raw = json.dumps({"model": model, "messages": []}).encode()
    h.headers = {"Content-Length": str(len(raw))}
    h.rfile, h.wfile = io.BytesIO(raw), io.BytesIO()
    sent = []
    h.send_response = lambda s: sent.append(s)
    h.send_header = lambda *a: None
    h.end_headers = lambda: None
    h.send_error = lambda s, m: sent.append(s)
    g.SPEAK_URL = ""
    h._forward()
    return asked, sent


g._bad_until.clear()
assert run({"A": 503, "B": 503, "C": 200}) == (["A", "B", "C"], [200])          # two overloaded, third answers
g._bad_until.clear()
assert run({"A": 503, "B": 503, "C": 503}) == (["A", "B", "C"], [503])          # all overloaded: error passes on
g._bad_until.clear()
assert run({"A": "slow", "B": 200}) == (["A", "B"], [200])                      # A too slow: B answers
assert run({"A": 200, "B": 200}) == (["B"], [200])                              # A is skipped now: B asked first
g._bad_until.clear()
assert run({"A": 200}) == (["A"], [200])                                        # healthy: one call
assert run({"A": 400}) == (["A"], [400])                                        # a real error (400) is not retried
g._bad_until.clear()
assert run({"A": "slow", "B": "slow", "C": 200}) == (["A", "B", "C"], [200])
print("relay fallback check OK: overload and slow starts move on to the next model, failed model skipped, 200/400 not retried")
