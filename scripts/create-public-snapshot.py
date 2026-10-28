"""Create a reduced commit without publishing the local full-document history."""
from pathlib import Path
import os,subprocess
R=Path(__file__).resolve().parent.parent
def git(*args,env=None,input=None):
 r=subprocess.run(['git',*args],cwd=R,capture_output=True,text=True,env=env,input=input,check=True)
 return r.stdout.strip()
full=git('rev-parse','HEAD');base=git('rev-parse','HEAD^')
assert git('branch','--show-current')=='simplify/requests-reg-yandex'
assert full.startswith('f9e09ce') and base.startswith('0271a5a')
git('branch','local/full-project-2026-10-28',full)
index=Path(git('rev-parse','--git-path','public-release-index')).resolve()
env=dict(os.environ,GIT_INDEX_FILE=str(index))
git('read-tree',base,env=env)
changes=git('diff','--name-only',base,full).splitlines()+git('diff','--name-only').splitlines()
changes+=['scripts/create-public-snapshot.py','scripts/check-project-commit.py']
private=('docs/simplified/','docs/private/','docs/legal/','graphify-out/')
names=sorted(set(n for n in changes if n and not n.startswith(private) and (R/n).is_file() and Path(n).suffix not in ['.zip','.docx']))
for i in range(0,len(names),35):git('add','--',*names[i:i+35],env=env)
tree=git('write-tree',env=env)
message='Publish legal pages and maintain public project documentation\n\nKeep full legal, filing and infrastructure records local.\nPublish only code, intended public legal pages and reduced project guidance.\nDo not enable request intake or merge into main.\n'
commit=git('commit-tree',tree,'-p',base,input=message)
test=subprocess.run(['git','merge-base','--is-ancestor',full,commit],cwd=R,capture_output=True)
assert test.returncode==1,'Full private snapshot must not be an ancestor'
git('update-ref','refs/heads/simplify/requests-reg-yandex',commit,full)
git('read-tree',tree)
print('Local complete snapshot preserved:',full)
print('Reduced public commit:',commit)
print('Reviewed changed paths:',len(names))
print('Full local document commit is NOT in public commit ancestry.')
