"""In-process fixture for Cloud Sync browser tests. SQL authorization is exercised separately."""
import copy
import hashlib
import json
from email.parser import BytesParser
from urllib.parse import urlparse

from library_browser import OWNER

STAMP = '2026-11-27T01:00:00Z'


class WorkingAPI:
    def __init__(self, publications=None):
        self.documents = {}
        self.publications = publications if publications is not None else {}
        self.requests = {}
        self.writes = []
        self.document_reads = []
        self.public_reads = []
        self.catalog_requests = []
        self.assets = {}
        self.uploads = []
        self.editors = {}
        self.missing = False
        self.lose_response = False

    def seed(self, document, kind='lesson', revision=1, digest=None, deleted=None):
        deck = document['deck'] if kind == 'template' else document
        identifier = deck['id']
        meta = {
            'id': identifier, 'kind': kind, 'title': deck['title'], 'slides': len(deck['slides']),
            'templateKind': document.get('kind'), 'templateFormat': document.get('format'),
            'revision': revision, 'hash': digest, 'updated': STAMP,
            'deleted': deleted, 'restorable': bool(deleted),
        }
        self.documents[kind, identifier] = {'meta': meta, 'document': copy.deepcopy(document)}
        return meta

    def route(self, route, emit):
        request = route.request
        path = urlparse(request.url).path
        method = request.method
        endpoint = path.rsplit('/', 1)[-1]
        if endpoint.startswith(('atlas_working_', 'atlas_publication_')) and '/rpc/' in path:
            args = request.post_data_json
            assert args['expected_owner'] == OWNER
        if endpoint == 'atlas_working_list':
            if self.missing:
                emit({'code': 'PGRST202', 'message': 'Missing schema'}, 404)
            else:
                emit([value['meta'] for value in self.documents.values()])
        elif endpoint == 'atlas_working_get':
            key = args['doc_kind'], args['doc_id']
            self.document_reads.append(key)
            emit(self.documents.get(key))
        elif endpoint == 'atlas_working_editing':
            sessions = self.editors.setdefault((args['doc_kind'], args['doc_id']), set())
            if args['release']:
                sessions.discard(args['session_id'])
            else:
                sessions.add(args['session_id'])
            emit(len(sessions) > 1)
        elif endpoint == 'atlas_working_save':
            key = args['doc_kind'], args['doc_id']
            notify = args['mutation']
            prior = self.documents.get(key, {}).get('meta')
            self.writes.append((key, notify))
            if notify in self.requests:
                emit({'accepted': True, 'committed': self.requests[notify], 'meta': prior})
            elif args['expected_revision'] == (prior['revision'] if prior else 0):
                assert all(OWNER + '/' + sha in self.assets for sha in args['refs'])
                meta = self.seed(args['payload'], key[0], args['expected_revision'] + 1,
                                 args['payload_hash'], STAMP if args['remove_doc'] else None)
                self.requests[notify] = meta['revision']
                if self.lose_response:
                    self.lose_response = False
                    route.abort()
                else:
                    emit({'accepted': True, 'committed': meta['revision'], 'meta': meta})
            else:
                emit({'accepted': False, 'meta': prior})
        elif endpoint == 'atlas_publication_catalog':
            data = [{
                'id': identifier, 'title': deck['title'], 'slides': len(deck['slides']),
                'indexed': True, 'updated': STAMP, 'thumbnail': None,
            } for identifier, deck in self.publications.items()]
            self.catalog_requests.append(len(json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()))
            emit(data)
        elif endpoint in ('atlas_publication_record', 'atlas_working_resource_urls'):
            emit(True if endpoint == 'atlas_publication_record' else [])
        elif '/atlas-private-resources/' in path:
            key = path.split('/atlas-private-resources/', 1)[-1]
            if method == 'POST':
                file = request.post_data_buffer
                if request.headers['content-type'].startswith('multipart/form-data'):
                    header = request.headers['content-type']
                    message = BytesParser().parsebytes(('Content-Type: ' + header + '\r\n\r\n').encode() + file)
                    file = next(part.get_payload(decode=True) for part in message.get_payload() if part.get_filename())
                assert key == OWNER + '/' + hashlib.sha256(file).hexdigest()
                self.uploads.append(key)
                if key in self.assets:
                    emit({'message': 'duplicate'}, 409)
                else:
                    self.assets[key] = file
                    emit({'Key': key})
            elif method == 'GET' and key in self.assets:
                route.fulfill(body=self.assets[key], content_type='application/octet-stream',
                              headers={'Access-Control-Allow-Origin': '*'})
            else:
                emit({}, 404)
        else:
            return False
        return True
