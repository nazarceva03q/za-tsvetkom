import importlib.util,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('legal',ROOT/'scripts/publish-legal.py');app=importlib.util.module_from_spec(spec);spec.loader.exec_module(app)

class LegalPublicationTests(unittest.TestCase):
 def test_exact_scope(self):
  self.assertEqual(set(app.validate()),{'legal.html','consent.html','returns.html','app.js','index.html'})
 def test_explicit_authorization_required(self):
  with self.assertRaises(ValueError):app.publish({})
 def test_ftp_target_verified_before_write(self):
  class FTP:
   def cwd(self,p):self.path=p
   def retrbinary(self,cmd,callback):callback(b'other website')
  with self.assertRaises(ValueError):app.verified_root(FTP(),b'actual site')
 def test_isolated_root_accepted_only_after_match(self):
  class FTP:
   def cwd(self,p):self.path=p
   def retrbinary(self,cmd,callback):callback(b'actual site')
  self.assertEqual(app.verified_root(FTP(),b'actual site'),'/')
 def test_escape_paths_rejected(self):
  for target in ['/../private','relative','//host','/site\\other']:
   with self.subTest(target=target),self.assertRaises(ValueError):app.verified_root(None,b'site',target)

if __name__=='__main__':unittest.main()
