#!/usr/bin/env python3
"""Run synthetic success, denied and error controls on an isolated Caddy process."""
import argparse
import hashlib
import http.client
import http.server
import json
import os
import pathlib
import re
import subprocess
import tempfile
import threading
import time

if not __debug__:
    raise SystemExit('Run without Python optimisation; verification checks must remain enabled')

HEADERS = ['X-Api-Key', 'X-Internal-Secret', 'X-Migration-Secret', 'X-Bootstrap-Secret']
parser = argparse.ArgumentParser()
parser.add_argument('--caddy', default='caddy')
parser.add_argument('--production-config', type=pathlib.Path)
args = parser.parse_args()
fixture = pathlib.Path(__file__).with_name('fixtures') / 'flash-edge-log-redaction.caddy'
source = fixture.read_text()
received = []
if args.production_config:
    # The complete private config stays outside the repository. Compare only
    # the two filter bodies, including every existing privacy rule.
    def bodies(text):
        return re.findall(r'format filter \{(.*?)\n    \}', text, re.S)
    assert len(bodies(source)) == 2, 'Expected two fixture encoder bodies'
    assert bodies(args.production_config.read_text()) == bodies(source), 'Production/fixture encoder drift'


class Upstream(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        received.append({h: self.headers.get_all(h, []) for h in HEADERS})
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'ok')

    def log_message(self, *args):
        pass


def request(path, marker=None):
    connection = http.client.HTTPConnection('127.0.0.1', 18426, timeout=3)
    try:
        connection.putrequest('GET', path + ('?token=' + marker if marker else ''))
        if marker:
            for header in HEADERS:
                connection.putheader(header.lower(), marker + '_one')
                connection.putheader(header.upper(), marker + '_two')
            for header in ['Authorization', 'Proxy-Authorization', 'Cookie', 'Referer']:
                connection.putheader(header, marker)
        connection.endheaders()
        response = connection.getresponse()
        response.read()
        return response.status
    finally:
        connection.close()


def exercise(root, label, configuration):
    directory = root / label
    directory.mkdir(mode=0o700)
    # Caddy otherwise writes autosave and instance storage outside the fixture,
    # even with its admin endpoint disabled. Never inherit operator homes.
    environment = {'PATH': os.environ.get('PATH', '/usr/bin:/bin')}
    for variable, name in [('HOME', 'home'), ('XDG_CONFIG_HOME', 'config'), ('XDG_DATA_HOME', 'data')]:
        isolated = directory / name
        isolated.mkdir(mode=0o700)
        environment[variable] = str(isolated)
    access, error = directory / 'access.log', directory / 'error.log'
    path = directory / 'Caddyfile'
    path.write_text(configuration.replace('ACCESS_LOG', str(access)).replace('ERROR_LOG', str(error)))
    validated = subprocess.run([args.caddy, 'validate', '--config', str(path), '--adapter', 'caddyfile'], capture_output=True, cwd=directory, env=environment)
    assert validated.returncode == 0, 'Caddy fixture validation failed: ' + validated.stderr.decode()[-1000:]
    with (directory / 'runtime.log').open('wb') as runtime:
        process = subprocess.Popen([args.caddy, 'run', '--config', str(path), '--adapter', 'caddyfile'], stdout=runtime, stderr=runtime, cwd=directory, env=environment)
        try:
            for _ in range(100):
                if process.poll() is not None:
                    raise AssertionError('Isolated Caddy exited during startup')
                try:
                    if request('/ready') == 200:
                        break
                except OSError:
                    time.sleep(.05)
            else:
                raise AssertionError('Isolated Caddy did not become ready')
            marker = 'FLASH_SYNTHETIC_' + label.upper()
            statuses = [request(route, marker) for route in ['/success', '/denied', '/failure']]
            assert statuses == [200, 403, 502], statuses
            forwarded = received[-1]
            assert all(forwarded[h] == [marker + '_one', marker + '_two'] for h in HEADERS), 'Logging changed upstream headers'
            time.sleep(.2)
        finally:
            process.terminate()
            process.wait(timeout=10)
    access_rows = [json.loads(line) for line in access.read_text().splitlines()]
    error_rows = [json.loads(line) for line in error.read_text().splitlines()]
    cases = [row for row in access_rows if row.get('request', {}).get('uri', '').startswith(('/success', '/denied', '/failure'))]
    assert len(cases) == 3 and len(error_rows) >= 1, 'Missing access/error evidence'
    exposed = [h for h in HEADERS if any(marker in str(row.get('request', {}).get('headers', {}).get(h, '')) for row in cases)]
    error_exposed = [h for h in HEADERS if any(marker in str(row.get('request', {}).get('headers', {}).get(h, '')) for row in error_rows)]
    runtime_text = (directory / 'runtime.log').read_text()
    assert marker not in runtime_text, 'Unfiltered duplicate runtime output'
    if label == 'before':
        assert exposed == HEADERS and error_exposed == HEADERS, 'Negative control did not expose original defect'
    else:
        assert not exposed and not error_exposed, 'Credential header retained'
        assert all(marker not in json.dumps(row) for row in cases + error_rows), 'Sensitive marker survived redaction'
    return {'variant': label, 'statuses': statuses, 'access_cases': len(cases), 'error_cases': len(error_rows), 'headers_forwarded': True, 'custom_headers_exposed_access': exposed, 'custom_headers_exposed_error': error_exposed}


server = http.server.HTTPServer(('127.0.0.1', 18427), Upstream)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    before = source
    for header in HEADERS:
        line = '        request>headers>' + header + ' delete\n'
        assert before.count(line) == 2, 'Expected both Flash encoders'
        before = before.replace(line, '')
    with tempfile.TemporaryDirectory(prefix='flash-edge-redaction-') as temporary:
        root = pathlib.Path(temporary)
        results = [exercise(root, 'before', before), exercise(root, 'candidate', source)]
    print(json.dumps({'caddy_version': subprocess.check_output([args.caddy, 'version'], text=True).strip(), 'fixture_sha256': hashlib.sha256(source.encode()).hexdigest(), 'results': results, 'temporary_processes_stopped': True}))
finally:
    server.shutdown()
    server.server_close()
