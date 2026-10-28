"""Publish only legal pages and their storefront links; never enable intake."""
import argparse,hashlib,io,json,os,ssl,sys
from datetime import datetime,timezone
from ftplib import FTP_TLS,error_perm
from pathlib import Path
from urllib.request import urlopen,Request

ROOT=Path(__file__).resolve().parent.parent
NAMES=('legal.html','consent.html','returns.html','app.js','index.html')
ORIGIN='https://xn----ctbjb9aqim7a5cq.online'
def digest(raw):return hashlib.sha256(raw).hexdigest()
def validate(root=ROOT):
 for name in NAMES:
  p=root/name
  if not p.is_file() or p.is_symlink():raise ValueError('Missing public file: '+name)
  if name in ('legal.html','consent.html','returns.html'):
   text=p.read_text(encoding='utf-8')
   if 'Проект для согласования' in text or 'Условия публикации' in text:raise ValueError('Unreleased legal page: '+name)
 if 'href="returns.html"' not in (root/'index.html').read_text(encoding='utf-8'):raise ValueError('Missing return link')
 return {name:(root/name).read_bytes() for name in NAMES}
def fetch(name):
 with urlopen(Request(ORIGIN+'/'+name,headers={'User-Agent':'Za-tsvetkom-legal-publication/1.0','Cache-Control':'no-cache'}),timeout=30) as r:
  if r.status!=200:raise ValueError('Public page unavailable')
  return r.read(4000000)
def read_remote(ftp,name):
 b=io.BytesIO();ftp.retrbinary('RETR '+name,b.write);return b.getvalue()
def verified_root(ftp,public_index,target=None):
 # An isolated FTP account may map its root to the site. Never trust that by
 # assumption: compare its existing entry page with the actual HTTPS site.
 target=target or '/'
 if not target.startswith('/') or '..' in target.split('/') or '\\' in target or '//' in target:raise ValueError('Invalid FTP target')
 ftp.cwd(target)
 if digest(read_remote(ftp,'index.html'))!=digest(public_index):raise ValueError('FTP target does not match public site; no upload performed')
 return target
def publish(env=os.environ):
 if env.get('LEGAL_DEPLOY_APPROVED')!='true':raise ValueError('Explicit legal publication flag required')
 files=validate()
 for key in ('FTP_HOST','FTP_USERNAME','FTP_PASSWORD'):
  if not env.get(key):raise ValueError('Missing deployment configuration: '+key)
 before=fetch('index.html')
 backup=ROOT/'.release-backups'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ');backup.mkdir(parents=True,exist_ok=True)
 with FTP_TLS(context=ssl.create_default_context(),timeout=60) as ftp:
  ftp.connect(env['FTP_HOST'],21);ftp.login(env['FTP_USERNAME'],env['FTP_PASSWORD']);ftp.prot_p()
  target=verified_root(ftp,before,env.get('FTP_WEB_ROOT'))
  for name in NAMES:
   ftp.cwd(target)
   try:old=read_remote(ftp,name)
   except error_perm as e:
    if not str(e).startswith('550'):raise
    old=None
   if old is not None:(backup/name).write_bytes(old)
  # Recheck the entry page after backup: avoid writing over a concurrent deploy.
  if read_remote(ftp,'index.html')!=before:raise ValueError('Public entry changed during preflight')
  for name in NAMES:
   ftp.cwd(target);ftp.storbinary('STOR '+name,io.BytesIO(files[name]))
   if read_remote(ftp,name)!=files[name]:raise ValueError('Upload verification failed: '+name)
   print('Uploaded and verified:',name,flush=True)
 result={}
 for name in NAMES:
  result[name]={'expectedSha256':digest(files[name]),'publicSha256':digest(fetch(name))}
  if result[name]['expectedSha256']!=result[name]['publicSha256']:raise ValueError('HTTP content differs: '+name)
 report={'publishedAt':datetime.now(timezone.utc).isoformat(),'files':result,'intakeConfigurationChanged':False}
 (backup/'publication.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
 print('PUBLIC_LEGAL_PAGES_VERIFIED; intake configuration unchanged')

if __name__=='__main__':
 parser=argparse.ArgumentParser();mode=parser.add_mutually_exclusive_group(required=True);mode.add_argument('--dry-run',action='store_true');mode.add_argument('--apply',action='store_true');args=parser.parse_args()
 if args.dry_run:
  for name,raw in validate().items():print('Approved legal publication file:',name,digest(raw))
 else:
  try:publish()
  except Exception as e:
   print('LEGAL_PUBLICATION_FAILED:',type(e).__name__,file=sys.stderr);sys.exit(1)
