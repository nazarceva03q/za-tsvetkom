import contextlib
import importlib.util
import io
from pathlib import Path
import ssl
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('publish_storefront', ROOT / 'scripts/publish-storefront.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for name in app.ROOT_FILES:
            (self.root / name).write_text('test', encoding='utf8')

    def tearDown(self):
        self.temp.cleanup()

    def test_allowlist_and_entry_last(self):
        for name in ['backend/config.php', 'bot/data/leads.json', 'api/orders.php',
                     'assets/leak.php', 'assets/leak.zip', 'assets/.env.png', 'owner/orders.php',
                     'assets/products/test.jpg', 'fonts/test.woff2']:
            p = self.root / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('test', encoding='utf8')
        files = app.public_files(self.root)
        self.assertEqual(files[-1], 'index.html')
        self.assertIn('assets/products/test.jpg', files)
        self.assertIn('fonts/test.woff2', files)
        self.assertEqual(set(files) - set(app.ROOT_FILES), {'assets/products/test.jpg', 'fonts/test.woff2'})

    def test_missing_entry_fails(self):
        (self.root / 'index.html').unlink()
        with self.assertRaises(ValueError):
            app.public_files(self.root)

    def test_optional_consent(self):
        (self.root / 'consent.html').write_text('draft', encoding='utf8')
        self.assertIn('consent.html', app.public_files(self.root))

    def test_reject_targets(self):
        for value in ['', 'relative', '/../private', '/site/../private', '/site\\other', '/site\n', '//other']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                app.checked_target(value)
        self.assertEqual(app.checked_target('/verified-site'), '/verified-site')

    def test_disabled_and_unconfigured_never_connect(self):
        def forbidden(**kwargs):
            raise AssertionError('network must not be touched')
        for env in [{}, {'SITE_DEPLOY_READY': 'true'},
                    {'SITE_DEPLOY_READY': 'true', 'FTP_WEB_ROOT': '/site'}]:
            with self.assertRaises(ValueError):
                app.publish(self.root, ['index.html'], env, factory=forbidden)

    def test_encrypted_transfer_exact_files(self):
        calls = []

        class FakeFTP:
            def __init__(self, **kwargs):
                assert kwargs['context'].verify_mode == ssl.CERT_REQUIRED
                assert kwargs['context'].check_hostname
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def connect(self, *args): calls.append(('connect', args))
            def login(self, *args): calls.append(('login',))
            def prot_p(self): calls.append(('encrypted-data',))
            def cwd(self, p): calls.append(('cwd', p))
            def mkd(self, p): raise AssertionError('not expected')
            def storbinary(self, command, source):
                self.assert_data = source.read()
                calls.append(('upload', command))

        env = {'SITE_DEPLOY_READY': 'true', 'FTP_WEB_ROOT': '/site',
               'FTP_HOST': 'test.invalid', 'FTP_USERNAME': 'test', 'FTP_PASSWORD': 'synthetic'}
        with contextlib.redirect_stdout(io.StringIO()):
            app.publish(self.root, ['legal.html', 'index.html'], env, factory=FakeFTP)
        self.assertEqual([c[1] for c in calls if c[0] == 'upload'], ['STOR legal.html', 'STOR index.html'])
        self.assertLess(calls.index(('encrypted-data',)), calls.index(('upload', 'STOR legal.html')))


if __name__ == '__main__':
    unittest.main()
