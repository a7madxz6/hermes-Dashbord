"""Read the installed endpoint using a same-user one-use Hermes ticket. Never prints credentials."""
import json
from pathlib import Path
import urllib.request
from hermes_cli.gateway_runtime_discovery import query_identify, connect_private

from hermes_constants import get_hermes_home

home = get_hermes_home().resolve()
identity = query_identify(home, timeout=3)
request = {'protocol': 1, 'verb': 'session-ticket', 'params': {
    'profile_id': str(home), 'instance_id': identity['instance_id'], 'purpose': 'native-http'}}
with connect_private(home, 3) as sock:
    sock.sendall(json.dumps(request).encode() + b'\n')
    with sock.makefile('rb') as stream:
        reply = json.loads(stream.readline())
if not reply.get('ok'):
    raise RuntimeError('Native authentication ticket was refused')
url = identity['api_origin'].rstrip('/') + '/api/plugins/a7m-dashboard/snapshot'
req = urllib.request.Request(url, headers={'X-Hermes-Gateway-Ticket': reply['result']['ticket']})
with urllib.request.urlopen(req, timeout=15) as response:
    data = json.load(response)
    print(json.dumps({'status': response.status, 'board': data.get('board'),
        'columns': {c['name']:len(c['tasks']) for c in data['columns']},
        'workers': data.get('workers'), 'now':data['now']}, ensure_ascii=False))
