"""Review candidate paths/content before staging this public repository."""
from pathlib import Path
import re,subprocess,sys,zipfile
ROOT=Path(__file__).resolve().parent.parent
r=subprocess.run(['git','ls-files','-m','-o','--exclude-standard','-z'],cwd=ROOT,capture_output=True,check=True)
names=sorted(set(n.decode('utf-8') for n in r.stdout.split(b'\0') if n))
names=[n for n in names if not n.startswith(('docs/private/','docs/legal/','docs/simplified/'))]
patterns={
 'VK token':r'vk1\.a[A-Za-z0-9_-]{30,}',
 'Yandex OAuth':r'y0_[A-Za-z0-9_-]{25,}',
 'GitHub token':r'(?:ghp_|github_pat_)[A-Za-z0-9_]{25,}',
 'private key':r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
 'Yandex API key':r'AQVN[A-Za-z0-9_-]{25,}',
}
bad=[]
for name in names:
 p=ROOT/name
 if not p.is_file():continue
 if p.name in ['config.php','.env'] or 'restore-ledger' in p.name or p.suffix.lower()=='.zip':bad.append((name,'private artifact'));continue
 if p.suffix.lower()=='.sql' and not name.startswith('backend/orders/migrations/'):bad.append((name,'unexpected SQL export'));continue
 if p.suffix.lower() in ['.png','.jpg','.jpeg','.webp','.gif','.woff','.woff2','.ttf','.pdf']:continue
 try:
  if p.suffix.lower()=='.docx':
   with zipfile.ZipFile(p) as z:text=z.read('word/document.xml').decode('utf-8')
  else:text=p.read_text(encoding='utf-8')
 except (UnicodeError,KeyError,zipfile.BadZipFile):continue
 for label,pat in patterns.items():
  if re.search(pat,text):bad.append((name,label))
print('Candidate files:',len(names))
if bad:
 for name,label in bad:print('REVIEW REQUIRED:',name,'('+label+')')
 raise SystemExit(1)
print('No prohibited artifact paths or known credential formats detected.')
if '--stage' in sys.argv:
 # Each name is a structured argument, not interpolated shell text.
 for i in range(0,len(names),40):subprocess.run(['git','add','--',*names[i:i+40]],cwd=ROOT,check=True,capture_output=True)
 print('Staged reviewed project files.')
