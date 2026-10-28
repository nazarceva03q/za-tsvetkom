"""Dispatch/poll the explicit legal-only workflow using the Git credential helper."""
import argparse,json,os,subprocess,sys,urllib.request,urllib.error
parser=argparse.ArgumentParser();parser.add_argument('action',choices=['dispatch','status']);parser.add_argument('--ref',default='simplify/requests-reg-yandex');parser.add_argument('--run-id');args=parser.parse_args()
env=dict(os.environ,GIT_TERMINAL_PROMPT='0',GCM_INTERACTIVE='Never')
r=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',capture_output=True,text=True,env=env,check=True)
credential=dict(line.split('=',1) for line in r.stdout.splitlines() if '=' in line)
token=credential.get('password')
if not token:raise SystemExit('Git credential unavailable; no workflow dispatched')
headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','User-Agent':'Za-tsvetkom-legal-release','X-GitHub-Api-Version':'2022-11-28'}
base='https://api.github.com/repos/nazarceva03q/za-tsvetkom/'
def request(endpoint,data=None):
 req=urllib.request.Request(base+endpoint,headers=headers,data=None if data is None else json.dumps(data).encode(),method='GET' if data is None else 'POST')
 try:
  with urllib.request.urlopen(req,timeout=30) as response:
   raw=response.read();return None if not raw else json.loads(raw)
 except urllib.error.HTTPError as e:
  body=json.loads(e.read());print('GitHub API status:',e.code,'message:',body.get('message',''));raise SystemExit(1)
if args.action=='dispatch':
 request('actions/workflows/deploy-reg.yml/dispatches',{'ref':args.ref,'inputs':{'dry_run':'false','legal_only':'true'}})
 print('Dispatched legal-only publication on',args.ref)
elif args.run_id:
 data=request('actions/runs/'+args.run_id)
 print(json.dumps({k:data.get(k) for k in ['id','status','conclusion','html_url','head_sha']},ensure_ascii=False))
 jobs=request('actions/runs/'+args.run_id+'/jobs')
 print(json.dumps([{'name':j['name'],'conclusion':j['conclusion'],'steps':[{'name':s['name'],'conclusion':s['conclusion']} for s in j['steps']]} for j in jobs['jobs']],ensure_ascii=False))
else:
 data=request('actions/workflows/deploy-reg.yml/runs?branch='+args.ref+'&per_page=5')
 print(json.dumps([{k:r.get(k) for k in ['id','event','status','conclusion','html_url','head_sha']} for r in data['workflow_runs']],ensure_ascii=False))
