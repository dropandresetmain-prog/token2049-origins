import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
if(process.argv.length!==2)throw Error('Read-only release plan accepts no apply arguments');
const manifest=JSON.parse(readFileSync(new URL('../../deploy/consolidated-payer-release.json',import.meta.url),'utf8'));
if(git('branch','--show-current')!==manifest.candidateBranch)throw Error('wrong candidate branch');
if(git('remote','get-url','origin')!=='https://github.com/dropandresetmain-prog/token2049-origins.git')throw Error('wrong repository');
git('merge-base','--is-ancestor',manifest.baseSha,'HEAD');
if(git('status','--porcelain'))throw Error('commit reviewed exact files before generating final release fingerprint');
const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean).sort();
const digest=createHash('sha256');for(const path of files){digest.update(path+'\0');digest.update(readFileSync(new URL('../../'+path,import.meta.url)));digest.update('\0');}
console.log(JSON.stringify({noSpend:true,mode:'inspect-only',candidateSha:git('rev-parse','HEAD'),sourceFingerprintSha256:digest.digest('hex'),manifest},null,2));
