"""Update public storefront only; private backend, bot and SQL are never selected."""
import argparse
import os
import ssl
from ftplib import FTP_TLS
from pathlib import Path, PurePosixPath

ROOT_FILES = '''index.html legal.html app.js refinement.js details.js
catalog-live.js catalog-polish.js compact-cards.js motion.js catalog-sync.js
checkout.js checkout-client.js products-data.js balloons-data.js daily-bouquets.js
styles.css refinement.css details.css catalog-live.css catalog-polish.css
compact-cards.css photo-update.css robots.txt branch.svg divider.png logo.png max-icon.svg'''.split()
STATIC_DIRS = {
    'assets': {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'},
    'images': {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'},
    'fonts': {'.woff', '.woff2', '.ttf', '.otf', '.css', '.txt'},
}


def public_files(root):
    root = Path(root).resolve()
    files = list(ROOT_FILES)
    for document in ('consent.html','returns.html'):
        if (root / document).exists():
            files.append(document)
    for directory, extensions in STATIC_DIRS.items():
        base = root / directory
        if base.is_symlink():
            raise ValueError('Static directory must not be a symlink')
        if base.exists():
            for p in sorted(base.rglob('*')):
                relative = p.relative_to(root)
                # Runtime photos belong to REG's catalogue API, never GitHub.
                if relative.parts[:2] == ('assets', 'catalog'):
                    continue
                if any(part.startswith('.') for part in relative.parts):
                    continue
                if p.suffix.lower() in extensions and p.is_file():
                    files.append(relative.as_posix())
    for name in files:
        p = root / name
        if not p.is_file() or not p.resolve().is_relative_to(root):
            raise ValueError('Missing or escaped public file: ' + name)
        if any(root.joinpath(*PurePosixPath(name).parts[:i]).is_symlink()
               for i in range(1, len(PurePosixPath(name).parts) + 1)):
            raise ValueError('Symlink in public path: ' + name)
    return sorted(files, key=lambda name: (name == 'index.html', name.endswith('.html'), name))


def checked_target(value):
    if (not value or not value.startswith('/') or '\\' in value
            or any(ord(c) < 32 for c in value)
            or '..' in value.split('/') or '//' in value):
        raise ValueError('Set the verified absolute FTP_WEB_ROOT')
    return value


def publish(root, names, env, factory=FTP_TLS):
    if env.get('SITE_DEPLOY_READY') != 'true':
        raise ValueError('Publication not enabled: finish server setup first')
    target = checked_target(env.get('FTP_WEB_ROOT', ''))
    for key in ('FTP_HOST', 'FTP_USERNAME', 'FTP_PASSWORD'):
        if not env.get(key):
            raise ValueError('Missing FTP configuration')
    with factory(context=ssl.create_default_context(), timeout=60) as ftp:
        ftp.connect(env['FTP_HOST'], 21)
        ftp.login(env['FTP_USERNAME'], env['FTP_PASSWORD'])
        ftp.prot_p()
        ftp.cwd(target)
        for name in names:
            ftp.cwd(target)
            for part in PurePosixPath(name).parts[:-1]:
                try:
                    ftp.cwd(part)
                except Exception:
                    ftp.mkd(part)
                    ftp.cwd(part)
            with (Path(root) / name).open('rb') as source:
                ftp.storbinary('STOR ' + PurePosixPath(name).name, source)
            print('Uploaded public file:', name)


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--dry-run', action='store_true')
    mode.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    names = public_files(root)
    for name in names:
        print('Approved public file:', name)
    if args.apply:
        publish(root, names, os.environ)
    else:
        print('DRY_RUN_ONLY: no network connection; files:', len(names))


if __name__ == '__main__':
    main()
