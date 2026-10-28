"""Synthetic staging-only ledger; never evidence of real customer erasure."""
import hashlib,json
from pathlib import Path
def sha(s):return hashlib.sha256(s.encode()).hexdigest()
def canonical(v):return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':'))
record_id='a72200000000000000000000000000ff'
number='ZT-A722000000000001'
payload={'format':'zt-restore-ledger-v1','exportedAt':'2026-10-22 00:00:00.000000','recordCount':1,'records':[{
    'id':record_id,'order_number':number,
    'replay_key_hash':sha(sha('restore-test-20261022-delete')),
    'review_version':1,'cleared_at':'2026-10-22 00:00:00.000000',
    'retain_until':'2029-10-23 00:00:00.000000','copy_state':'pending',
    'backup_review_at':None,'copies_confirmed_at':None,
    'evidence':{'recordId':record_id,'subjectReference':number,
        'status':'SYNTHETIC_RESTORE_DRILL_ONLY_NOT_REAL_ERASURE',
        'scope':'Fictional staging fixture only; not an act or real erasure proof.'}
}]}
body=json.dumps({'payload':payload,'checksum':sha(canonical(payload))},ensure_ascii=False,indent=2)+'\n'
folder=Path(__file__).resolve().parents[1]/'docs'/'simplified'/'restore-drill'
folder.mkdir(exist_ok=True)
file=folder/'restore-ledger-test.json'
file.write_bytes(body.encode())
(folder/'SHA-256-test.txt').write_text(sha(body)+'\n',encoding='ascii')
print('SYNTHETIC_ONLY sha256='+sha(body))
